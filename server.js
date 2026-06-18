const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');
const crypto = require('crypto');
const https = require('https');

const PORT = 8080;
const KEY_PATH = path.join(__dirname, 'node_modules', 'sales-491201-b6d22a6beded.json');

// Mime types helper
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

const server = http.createServer(async (req, res) => {
  const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = parsedUrl.pathname;

  // API Route
  if (pathname === '/api/meetings') {
    const userEmail = parsedUrl.searchParams.get('userEmail');
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

      // Get Google OAuth Token via JWT
      const accessToken = await getAccessTokenFromServiceAccount(keyJson);

      // Fetch from Google Calendar API
      const calendarId = 'sales@aait.sa';
      const now = new Date();
      const timeMin = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
      const timeMax = new Date(now.getFullYear(), now.getMonth() + 6, 1).toISOString();

      console.log(`[DEBUG] Fetching events for userEmail: ${userEmail}`);
      console.log(`[DEBUG] Calendar ID: ${calendarId}`);
      console.log(`[DEBUG] Time range: ${timeMin} -> ${timeMax}`);

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
              console.error("Google Calendar API Error Response:", body);
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
            const filteredEvents = events.filter(event => {
              const organizerEmail = (event.organizer?.email || event.organizer?.displayName || '').toLowerCase();
              if (organizerEmail === userEmailLower) return true;

              const attendees = event.attendees || [];
              return attendees.some(att => (att.email || '').toLowerCase() === userEmailLower);
            });

            console.log(`[DEBUG] Filtered events for user: ${userEmail}, count: ${filteredEvents.length}`);

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

            console.log(`[DEBUG] Returning ${result.length} events to frontend`);
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
      console.error('Error fetching calendar events:', err);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // Static File Serving
  let filePath = path.join(__dirname, pathname === '/' ? 'index.html' : pathname);
  const extname = path.extname(filePath);
  let contentType = MIME_TYPES[extname] || 'application/octet-stream';

  fs.readFile(filePath, (error, content) => {
    if (error) {
      if (error.code === 'ENOENT') {
        fs.readFile(path.join(__dirname, 'index.html'), (err, htmlContent) => {
          if (err) {
            res.writeHead(500);
            res.end('Error loading index.html');
          } else {
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(htmlContent, 'utf-8');
          }
        });
      } else {
        res.writeHead(500);
        res.end(`Server Error: ${error.code}`);
      }
    } else {
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(content, 'utf-8');
    }
  });
});

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

  // Pattern matching:
  // 1. "اجتماع أ - [الاسم] - [المشروع]"
  // 2. "اجتماع أ - [الاسم] [المشروع]"
  // 3. "أ - [الاسم] - [المشروع]"
  // 4. "[الاسم] - [المشروع]"

  // Check for prefix "اجتماع أ -" or "أ -" or "اجتماع -"
  const prefixMatch = summary.match(/^(?:اجتماع\s+أ\s*-\s*|أ\s*-\s*|اجتماع\s*-\s*)(.+)$/i);
  if (prefixMatch) {
    const remaining = prefixMatch[1].trim();
    // Look for first " - " dash separator
    const dashIndex = remaining.indexOf(" - ");
    if (dashIndex !== -1) {
      clientName = remaining.substring(0, dashIndex).trim();
      projectName = remaining.substring(dashIndex + 3).trim();
    } else {
      // Failure (Pattern 2 or no second dash)
      clientName = summary;
      projectName = "";
      needsReview = true;
    }
  } else {
    // Pattern 4: "[الاسم] - [المشروع]"
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

if (process.env.VERCEL) {
  module.exports = server;
} else {
  server.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
  });
}
