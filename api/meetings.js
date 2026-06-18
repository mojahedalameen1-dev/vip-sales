const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const https = require('https');

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
  if (emails.includes(MUJAHID_EMAIL)) return 'م.اشرف';
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

// ════════════════ Summary Parser ════════════════
function parseMeetingSummary(summary) {
  if (!summary) {
    return { clientName: 'عميل جديد', projectName: '', meetingTitle: 'اجتماع Google Meet', needsReview: true, slackCode: null, meetingType: 'أون لاين' };
  }

  const meetingTitle = summary;
  let clientName = '', projectName = '', needsReview = false;

  const parts = summary.split(/\s*-\s*/);
  let slackCode = null, slackCodeIndex = -1;
  for (let i = 0; i < parts.length; i++) {
    if (/^(AA|SLK|SLK-)\d+$/i.test(parts[i])) {
      slackCode = parts[i].trim();
      slackCodeIndex = i;
      break;
    }
  }

  let meetingType = 'أون لاين';
  if (slackCodeIndex !== -1 && slackCodeIndex + 1 < parts.length) {
    meetingType = parts[slackCodeIndex + 1].trim();
  } else if (parts.length >= 2 && slackCodeIndex === -1) {
    meetingType = parts[parts.length - 1].trim();
  }

  let cleanSummary = summary;
  if (slackCode) cleanSummary = summary.replace(new RegExp(`\\s*-\\s*${slackCode}`, 'i'), '');
  if (meetingType && meetingType !== 'أون لاين' && meetingType !== 'حضوري') {
    cleanSummary = cleanSummary.replace(new RegExp(`\\s*-\\s*${meetingType}`, 'i'), '');
  }

  const prefixMatch = cleanSummary.match(/^(?:اجتماع\s+أ\s*-\s*|أ\s*-\s*|اجتماع\s*-\s*)(.+)$/i);
  if (prefixMatch) {
    const remaining = prefixMatch[1].trim();
    const dashIndex = remaining.indexOf(' - ');
    if (dashIndex !== -1) {
      clientName  = remaining.substring(0, dashIndex).trim();
      projectName = remaining.substring(dashIndex + 3).trim();
    } else {
      clientName  = cleanSummary.trim();
      needsReview = true;
    }
  } else {
    const subParts = cleanSummary.split(/\s+-\s+/);
    if (subParts.length >= 2) {
      clientName  = subParts[0].trim();
      projectName = subParts.slice(1).join(' - ').trim();
    } else {
      clientName  = cleanSummary.trim();
      needsReview = true;
    }
  }

  return { clientName: clientName || cleanSummary || summary, projectName: projectName || '', meetingTitle, needsReview, slackCode, meetingType };
}

// ════════════════ Main Handler ════════════════
module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const dateParam = req.query?.date || parsedUrl.searchParams.get('date'); // YYYY-MM-DD

  // Determine the target day (default = today in +03:00)
  let targetDate;
  if (dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam)) {
    targetDate = new Date(`${dateParam}T00:00:00+03:00`);
  } else {
    // Today in Arabia Standard Time (UTC+3)
    const now = new Date();
    const offsetMs = 3 * 60 * 60 * 1000;
    const localNow = new Date(now.getTime() + offsetMs);
    const yyyy = localNow.getUTCFullYear();
    const mm   = String(localNow.getUTCMonth() + 1).padStart(2, '0');
    const dd   = String(localNow.getUTCDate()).padStart(2, '0');
    targetDate = new Date(`${yyyy}-${mm}-${dd}T00:00:00+03:00`);
  }

  const dayStart = targetDate.toISOString();
  const dayEnd   = new Date(targetDate.getTime() + 24 * 60 * 60 * 1000).toISOString();

  try {
    let keyJson;
    if (process.env.GOOGLE_SERVICE_ACCOUNT_JSON) {
      keyJson = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
    } else {
      if (!fs.existsSync(KEY_PATH)) {
        res.writeHead(500);
        return res.end(JSON.stringify({ error: 'Service account JSON key file not found' }));
      }
      keyJson = JSON.parse(fs.readFileSync(KEY_PATH, 'utf8'));
    }

    const accessToken = await getAccessTokenFromServiceAccount(keyJson);
    const calendarId  = 'sales@aait.sa';

    const apiPath = `/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?singleEvents=true&orderBy=startTime&maxResults=500&timeMin=${encodeURIComponent(dayStart)}&timeMax=${encodeURIComponent(dayEnd)}`;

    https.get({
      hostname: 'www.googleapis.com',
      path: apiPath,
      headers: { 'Authorization': `Bearer ${accessToken}` }
    }, (apiRes) => {
      const chunks = [];
      apiRes.on('data', chunk => chunks.push(chunk));
      apiRes.on('end', () => {
        try {
          const body = Buffer.concat(chunks).toString('utf8');
          const data = JSON.parse(body);

          if (data.error) {
            let errMsg = data.error.message;
            if (apiRes.statusCode === 404) errMsg = 'التقويم غير موجود. الرجاء مشاركة تقويم sales@aait.sa مع: ' + keyJson.client_email;
            else if (apiRes.statusCode === 403) errMsg = 'صلاحية مرفوضة. الرجاء مشاركة تقويم sales@aait.sa مع: ' + keyJson.client_email;
            res.writeHead(apiRes.statusCode || 500);
            return res.end(JSON.stringify({ error: errMsg }));
          }

          const events = data.items || [];
          const result = events.map(event => {
            const meetLink = event.hangoutLink ||
              (event.conferenceData?.entryPoints?.[0]?.uri) || '';
            const parsed    = parseMeetingSummary(event.summary || '');
            const attendees = event.attendees || [];
            const salesRep  = determineSalesRep(attendees);

            return {
              id:          event.id,
              summary:     event.summary || 'اجتماع',
              startTime:   event.start?.dateTime || event.start?.date || '',
              endTime:     event.end?.dateTime   || event.end?.date   || '',
              meetLink,
              organizer:   event.organizer?.email || event.organizer?.displayName || '',
              attendees,
              clientName:  parsed.clientName,
              projectName: parsed.projectName,
              meetingTitle: parsed.meetingTitle,
              needsReview: parsed.needsReview,
              slackCode:   parsed.slackCode,
              meetingType: parsed.meetingType,
              salesRep
            };
          });

          res.writeHead(200);
          res.end(JSON.stringify(result));
        } catch (err) {
          res.writeHead(500);
          res.end(JSON.stringify({ error: err.message }));
        }
      });
    }).on('error', (err) => {
      res.writeHead(500);
      res.end(JSON.stringify({ error: err.message }));
    });

  } catch (err) {
    res.writeHead(500);
    res.end(JSON.stringify({ error: err.message }));
  }
};
