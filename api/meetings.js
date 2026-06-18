const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const https = require('https');

const KEY_PATH = path.join(process.cwd(), 'node_modules', 'sales-491201-b6d22a6beded.json');

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
      const header = {
        alg: 'RS256',
        typ: 'JWT',
        kid: keyJson.private_key_id
      };
      
      const claimSet = {
        iss: keyJson.client_email,
        scope: 'https://www.googleapis.com/auth/calendar.readonly',
        aud: 'https://oauth2.googleapis.com/token',
        exp: now + 3600,
        iat: now
      };

      const encodedHeader = base64url(JSON.stringify(header));
      const encodedClaimSet = base64url(JSON.stringify(claimSet));
      const signatureInput = `${encodedHeader}.${encodedClaimSet}`;

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
              console.error("Google Token Endpoint Error Response:", body);
              reject(new Error(data.error_description || data.error));
            } else {
              resolve(data.access_token);
            }
          } catch (e) {
            reject(e);
          }
        });
      });

      req.on('error', (err) => {
        console.error("Google Token HTTP Request Error:", err);
        reject(err);
      });
      req.write(postData);
      req.end();
    } catch (e) {
      reject(e);
    }
  });
}

function parseMeetingSummary(summary) {
  if (!summary) {
    return {
      clientName: "عميل جديد",
      projectName: "",
      meetingTitle: "اجتماع Google Meet",
      needsReview: true
    };
  }

  const meetingTitle = summary;
  let clientName = "";
  let projectName = "";
  let needsReview = false;

  const prefixMatch = summary.match(/^(?:اجتماع\s+أ\s*-\s*|أ\s*-\s*|اجتماع\s*-\s*)(.+)$/i);
  if (prefixMatch) {
    const remaining = prefixMatch[1].trim();
    const dashIndex = remaining.indexOf(" - ");
    if (dashIndex !== -1) {
      clientName = remaining.substring(0, dashIndex).trim();
      projectName = remaining.substring(dashIndex + 3).trim();
    } else {
      clientName = summary;
      projectName = "";
      needsReview = true;
    }
  } else {
    const parts = summary.split(/\s+-\s+/);
    if (parts.length >= 2) {
      clientName = parts[0].trim();
      projectName = parts.slice(1).join(" - ").trim();
    } else {
      clientName = summary;
      projectName = "";
      needsReview = true;
    }
  }

  return {
    clientName: clientName || summary,
    projectName: projectName || "",
    meetingTitle,
    needsReview
  };
}

module.exports = async (req, res) => {
  const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  // In Vercel, req.query is available, but locally we use parsedUrl.
  const userEmail = req.query?.userEmail || parsedUrl.searchParams.get('userEmail');
  
  if (!userEmail) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: 'userEmail parameter is required' }));
  }

  try {
    let keyJson;
    if (process.env.GOOGLE_SERVICE_ACCOUNT_JSON) {
      keyJson = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
    } else {
      if (!fs.existsSync(KEY_PATH)) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: 'Service account JSON key file not found' }));
      }
      keyJson = JSON.parse(fs.readFileSync(KEY_PATH, 'utf8'));
    }

    const accessToken = await getAccessTokenFromServiceAccount(keyJson);

    const calendarId = 'sales@aait.sa';
    const now = new Date();
    const timeMin = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
    const timeMax = new Date(now.getFullYear(), now.getMonth() + 6, 1).toISOString();

    const apiPath = `/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?singleEvents=true&orderBy=startTime&maxResults=2500&timeMin=${encodeURIComponent(timeMin)}&timeMax=${encodeURIComponent(timeMax)}`;

    https.get({
      hostname: 'www.googleapis.com',
      path: apiPath,
      headers: {
        'Authorization': `Bearer ${accessToken}`
      }
    }, (apiRes) => {
      const chunks = [];
      apiRes.on('data', chunk => chunks.push(chunk));
      apiRes.on('end', () => {
        try {
          const body = Buffer.concat(chunks).toString('utf8');
          const data = JSON.parse(body);
          if (data.error) {
            let errMsg = data.error.message;
            if (apiRes.statusCode === 404) {
              errMsg = "التقويم غير موجود. الرجاء التأكد من مشاركة تقويم sales@aait.sa مع بريد الـ Service Account التالي وإعطائه صلاحية عرض التفاصيل: " + keyJson.client_email;
            } else if (apiRes.statusCode === 403) {
              errMsg = "صلاحية مرفوضة. الرجاء مشاركة تقويم sales@aait.sa مع بريد الـ Service Account: " + keyJson.client_email;
            }
            res.writeHead(apiRes.statusCode || 500, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ error: errMsg }));
          }

          const events = data.items || [];
          const userEmailLower = userEmail.toLowerCase();
          const isAdmin = ['mohammadalqahtani@aait.sa', 'sales@aait.sa'].includes(userEmailLower);

          const filteredEvents = isAdmin ? events : events.filter(event => {
            const organizerEmail = (event.organizer?.email || event.organizer?.displayName || '').toLowerCase();
            if (organizerEmail === userEmailLower) return true;

            const attendees = event.attendees || [];
            return attendees.some(att => (att.email || '').toLowerCase() === userEmailLower);
          });

          const result = filteredEvents.map(event => {
            const meetLink = event.hangoutLink || 
              (event.conferenceData && event.conferenceData.entryPoints && event.conferenceData.entryPoints[0]?.uri) || 
              '';
            const parsed = parseMeetingSummary(event.summary || '');

            return {
              id: event.id,
              summary: event.summary || 'اجتماع',
              startTime: event.start?.dateTime || event.start?.date || '',
              meetLink: meetLink,
              organizer: event.organizer?.email || event.organizer?.displayName || '',
              attendees: event.attendees || [],
              clientName: parsed.clientName,
              projectName: parsed.projectName,
              meetingTitle: parsed.meetingTitle,
              needsReview: parsed.needsReview
            };
          });

          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify(result));
        } catch (err) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: err.message }));
        }
      });
    }).on('error', (err) => {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    });

  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: err.message }));
  }
};
