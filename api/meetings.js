import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import https from 'node:https';

const meetingsCache = new Map();
const MEETINGS_CACHE_TTL = 30000; // 30 seconds

const KEY_PATH = path.join(process.cwd(), 'node_modules', 'sales-491201-b6d22a6beded.json');

// ════════════════ Sales Rep Assignment Logic ════════════════
// Priority rules (order matters):
//   1. hosammohammed528@gmail.com → م.حسام  (overrides everyone)
//   2. ashrafesmat1@gmail.com     → م.أشرف  (only if حسام is absent)
//   3. shady.alaraby22@gmail.com  → م.شادي  (independent)
//   4. mojahedalameen1@gmail.com  → م.اشرف  (independent)
//   5. none match                 → null (بدون تابع)

const HOSAM_EMAIL   = 'hosammohammed528@gmail.com';
const ASHRAF_EMAIL  = 'ashrafesmat1@gmail.com';
const SHADY_EMAIL   = 'shady.alaraby22@gmail.com';
const MUJAHID_EMAIL = 'mojahedalameen1@gmail.com';

function determineSalesRep(attendees) {
  if (!attendees || attendees.length === 0) return null;
  const emails = attendees.map(a => (a.email || '').toLowerCase());

  if (emails.includes(HOSAM_EMAIL))   return 'م.حسام';
  if (emails.includes(ASHRAF_EMAIL))  return 'م.أشرف';
  if (emails.includes(SHADY_EMAIL))   return 'م.شادي';
  if (emails.includes(MUJAHID_EMAIL)) return 'م.مجاهد';
  return null;
}



// ════════════════ JWT / Auth helpers ════════════════
function base64url(stringOrBuffer) {
  const buf = Buffer.isBuffer(stringOrBuffer) ? stringOrBuffer : Buffer.from(stringOrBuffer);
  return buf.toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function getAccessTokenFromServiceAccount(keyJson) {
  return new Promise((resolve, reject) => {
    try {
      const now = Math.floor(Date.now() / 1000);
      const header = { alg: 'RS256', typ: 'JWT', kid: keyJson.private_key_id };
      const claimSet = {
        iss: keyJson.client_email,
        scope: 'https://www.googleapis.com/auth/calendar.readonly',
        aud: 'https://oauth2.googleapis.com/token',
        exp: now + 3600,
        iat: now
      };

      const encodedHeader   = base64url(JSON.stringify(header));
      const encodedClaimSet = base64url(JSON.stringify(claimSet));
      const signatureInput  = `${encodedHeader}.${encodedClaimSet}`;

      const sign = crypto.createSign('RSA-SHA256');
      sign.update(signatureInput);
      const signature = base64url(sign.sign(keyJson.private_key));
      const jwt = `${signatureInput}.${signature}`;

      const postData = `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`;

      const req = https.request({
        hostname: 'oauth2.googleapis.com',
        path: '/token',
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': postData.length
        }
      }, (res) => {
        const chunks = [];
        res.on('data', chunk => chunks.push(chunk));
        res.on('end', () => {
          try {
            const body = Buffer.concat(chunks).toString('utf8');
            const data = JSON.parse(body);
            if (data.error) {
              console.error('Google Token Endpoint Error:', body);
              reject(new Error(data.error_description || data.error));
            } else {
              resolve(data.access_token);
            }
          } catch (e) { reject(e); }
        });
      });

      req.on('error', (err) => { console.error('Google Token HTTP Error:', err); reject(err); });
      req.write(postData);
      req.end();
    } catch (e) { reject(e); }
  });
}


function calendarBounds(date, month) {
  const day = date || new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Riyadh' }).format(new Date());
  const startDay = month ? month + '-01' : day;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDay)) return null;
  const midnight = new Date(startDay + 'T00:00:00Z');
  if (!Number.isFinite(midnight.getTime()) || midnight.toISOString().slice(0, 10) !== startDay) return null;

  const end = new Date(midnight);
  if (month) end.setUTCMonth(end.getUTCMonth() + 1);
  else end.setUTCDate(end.getUTCDate() + 1);
  const offset = 3 * 60 * 60 * 1000;
  return [
    new Date(midnight.getTime() - offset).toISOString(),
    new Date(end.getTime() - offset).toISOString(),
  ];
}

function toMeeting(event) {
  const summary = String(event.summary || '')
    .replace(/\b(?:AA|SLK-?|CS)\d+\b/gi, '')
    .replace(/\(\s*\)|\[\s*\]/g, '')
    .replace(/^[\s:—_-]+|[\s:—_-]+$/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim() || 'اجتماع';
  const meetingType = /حضوري/.test(summary) ? 'حضوري'
    : /خارجي|خارج/.test(summary) ? 'خارجي' : 'أون لاين';
  const attendees = event.attendees || [];
  return {
    id: event.id,
    summary,
    startTime: event.start?.dateTime || event.start?.date || '',
    endTime: event.end?.dateTime || event.end?.date || '',
    allDay: Boolean(event.start?.date),
    meetLink: event.hangoutLink || event.conferenceData?.entryPoints?.find(entry => entry.entryPointType === 'video')?.uri || '',
    organizer: event.organizer?.email || '',
    attendees,
    meetingType,
    salesRep: determineSalesRep(attendees),
  };
}

export default async function meetings(req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  const { searchParams } = new URL(req.url, 'http://localhost');
  const date = searchParams.get('date');
  const month = searchParams.get('month');
  const email = searchParams.get('email')?.toLowerCase();
  const bounds = calendarBounds(date, month);
  if (!bounds) {
    res.writeHead(400);
    return res.end(JSON.stringify({ error: 'تاريخ الاجتماع غير صالح' }));
  }

  const cacheKey = JSON.stringify([bounds[0], bounds[1], email]);
  const cached = meetingsCache.get(cacheKey);
  if (cached?.expiresAt > Date.now()) {
    res.writeHead(200);
    return res.end(JSON.stringify(cached.data));
  }

  try {
    const rawKey = process.env.GOOGLE_SERVICE_ACCOUNT_JSON ||
      (fs.existsSync(KEY_PATH) ? fs.readFileSync(KEY_PATH, 'utf8') : '');
    const accessToken = await getAccessTokenFromServiceAccount(JSON.parse(rawKey));
    const calendarId = 'sales@aait.sa';
    const endpoint = new URL('/calendar/v3/calendars/' + encodeURIComponent(calendarId) + '/events', 'https://www.googleapis.com');
    endpoint.search = new URLSearchParams({
      singleEvents: 'true',
      orderBy: 'startTime',
      maxResults: '500',
      timeMin: bounds[0],
      timeMax: bounds[1],
    });

    const result = [];
    do {
      const response = await fetch(endpoint, {
        headers: { Authorization: 'Bearer ' + accessToken },
        signal: AbortSignal.timeout(10000),
      });
      if (!response.ok) {
        console.error('Calendar event list failed', response.status);
        res.writeHead(502);
        return res.end(JSON.stringify({ error: 'تعذر جلب المواعيد من تقويم Google' }));
      }
      const page = await response.json();
      for (const event of page.items || []) {
        const meeting = toMeeting(event);
        if (!email || meeting.attendees.some(person => person.email?.toLowerCase() === email)) result.push(meeting);
      }
      if (!page.nextPageToken) break;
      endpoint.searchParams.set('pageToken', page.nextPageToken);
    } while (true);

    if (meetingsCache.size >= 100) meetingsCache.delete(meetingsCache.keys().next().value);
    meetingsCache.set(cacheKey, { expiresAt: Date.now() + MEETINGS_CACHE_TTL, data: result });
    res.writeHead(200);
    res.end(JSON.stringify(result));
  } catch (error) {
    console.error('Meeting request failed', error.name);
    res.writeHead(502);
    res.end(JSON.stringify({ error: 'تعذر الاتصال بتقويم Google' }));
  }
}
