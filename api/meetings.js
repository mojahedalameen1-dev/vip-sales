const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const https = require('https');

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


// ════════════════ Slack Channel Parser Helper ════════════════
function fetchSlackReplies(token, channelId, ts) {
  return new Promise((resolve) => {
    const options = {
      hostname: 'slack.com',
      path: `/api/conversations.replies?channel=${channelId}&ts=${ts}`,
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try {
          const parsedRes = JSON.parse(data);
          if (parsedRes.ok && parsedRes.messages) {
            resolve(parsedRes.messages);
          } else {
            resolve([]);
          }
        } catch (e) {
          resolve([]);
        }
      });
    });

    req.on('error', () => resolve([]));
    req.end();
  });
}

function cleanSlackText(text) {
  if (!text) return '';
  return text
    .replace(/<@U[A-Z0-9]+>/g, '') // remove user mentions
    .replace(/<!subteam\^[A-Z0-9|a-z-_\s]+>/g, '') // remove subteam mentions
    .replace(/<tel:[^|]+\|([^>]+)>/g, '$1') // format tel links
    .replace(/<http[^|]+\|([^>]+)>/g, '$1') // format http links
    .replace(/\s+/g, ' ') // normalize whitespace
    .trim();
}

function extractAndFormatPhones(text) {
  if (!text) return '';
  
  const cleanedText = text.replace(/[<>|]/g, ' ');
  const digitSeqRegex = /\+?\d+/g;
  const matches = [];
  let match;
  
  while ((match = digitSeqRegex.exec(cleanedText)) !== null) {
    let num = match[0];
    
    if (num.startsWith('+966')) {
      num = num.substring(4);
    } else if (num.startsWith('966')) {
      num = num.substring(3);
    }
    
    if (num.startsWith('05') && num.length === 10) {
      if (!matches.includes(num)) {
        matches.push(num);
      }
    } else if (num.startsWith('5') && num.length === 9) {
      const formatted = '0' + num;
      if (!matches.includes(formatted)) {
        matches.push(formatted);
      }
    }
  }
  
  return matches.join(' - ');
}

function extractCrmLink(text) {
  if (!text) return '';
  const match = text.match(/https?:\/\/[^\s>|]*e\.aait\.sa[^\s>|]*/i) || text.match(/https?:\/\/[^\s>|]*odoo[^\s>|]*/i);
  if (match) {
    return match[0].replace(/&amp;/g, '&').trim();
  }
  return '';
}

function fetchSlackLeadInfo(targetCodes) {
  if (!targetCodes || targetCodes.length === 0) return Promise.resolve({});
  return new Promise(async (resolve) => {
    const token = process.env.SLACK_USER_TOKEN;
    const channelId = process.env.SLACK_CHANNEL_ID;

    if (!token || !channelId) {
      console.warn("Slack configuration (SLACK_USER_TOKEN or SLACK_CHANNEL_ID) is missing.");
      return resolve({});
    }

    const lookupMap = {};
    const missingCodes = new Set(targetCodes);
    
    try {
      const historyOptions = {
        hostname: 'slack.com',
        path: `/api/conversations.history?channel=${encodeURIComponent(channelId)}&limit=1000`,
        method: 'GET',
        headers: { 'Authorization': `Bearer ${token}` }
      };
      const historyData = await new Promise((reqRes) => {
        const req = https.request(historyOptions, (httpRes) => {
          let data = ''; 
          httpRes.on('data', c => data += c);
          httpRes.on('end', () => {
            try { reqRes(JSON.parse(data)); } catch (e) { reqRes({}); }
          });
        });
        req.on('error', () => reqRes({}));
        req.end();
      });
      
      if (historyData.ok && historyData.messages) {
        const historyMatches = [];
        for (const msg of historyData.messages) {
          const text = msg.text || '';
          const codeMatch = text.match(/(?:AA|SLK|SLK-|CS)\d+/i);
          if (codeMatch) {
            const slackCode = codeMatch[0].toUpperCase();
            if (missingCodes.has(slackCode)) {
              historyMatches.push({ msg, slackCode });
              missingCodes.delete(slackCode);
            }
          }
        }
        
        await Promise.all(historyMatches.map(async ({ msg, slackCode }) => {
           const phone = extractAndFormatPhones(msg.text);
           let crmLink = extractCrmLink(msg.text);
           
           if (msg.reply_count && msg.reply_count > 0) {
             const replies = await fetchSlackReplies(token, channelId, msg.ts);
             if (!crmLink) {
               for (const r of replies) {
                 const link = extractCrmLink(r.text);
                 if (link) { crmLink = link; break; }
               }
             }
           }
           lookupMap[slackCode] = { phone, crmLink, thread: [] };
        }));
      }
    } catch (e) {
      console.warn("Error fetching recent history", e);
    }

    await Promise.all([...missingCodes].map(targetCode => {
      return new Promise(async (res) => {
        let foundMsg = null;
        try {
          const searchOptions = {
            hostname: 'slack.com',
            path: `/api/search.messages?query=${encodeURIComponent(targetCode)}&count=20`,
            method: 'GET',
            headers: { 'Authorization': `Bearer ${token}` }
          };
          const searchData = await new Promise((reqRes) => {
            const req = https.request(searchOptions, (httpRes) => {
              let data = ''; 
              httpRes.on('data', c => data += c);
              httpRes.on('end', () => {
                try { reqRes(JSON.parse(data)); } catch (e) { reqRes({}); }
              });
            });
            req.on('error', () => reqRes({}));
            req.end();
          });
          
          if (searchData.ok && searchData.messages && searchData.messages.matches) {
            const match = searchData.messages.matches.find(m => m.channel && m.channel.id === channelId);
            if (match) {
              foundMsg = match;
              foundMsg.is_search_result = true;
            }
          }
        } catch (e) {
          console.warn("Slack search failed for", targetCode);
        }

        if (foundMsg) {
           const phone = extractAndFormatPhones(foundMsg.text);
           let crmLink = extractCrmLink(foundMsg.text);
           
           const correctTs = foundMsg.thread_ts || foundMsg.ts;
           if (foundMsg.reply_count > 0 || foundMsg.is_search_result) {
             const replies = await fetchSlackReplies(token, channelId, correctTs);
             if (!crmLink) {
               for (const r of replies) {
                 const link = extractCrmLink(r.text);
                 if (link) { crmLink = link; break; }
               }
             }
           }
           lookupMap[targetCode] = { phone, crmLink, thread: [] };
        }
        res();
      });
    }));
    
    resolve(lookupMap);
  });
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
  let cleanSummary = summary;

  // 1. Extract Slack Code dynamically anywhere in the text
  let slackCode = null;
  const slackMatch = cleanSummary.match(/(?:AA|SLK|SLK-)\d+/i);
  if (slackMatch) {
    slackCode = slackMatch[0].toUpperCase();
    cleanSummary = cleanSummary.replace(slackMatch[0], '').trim();
  }

  // 2. Extract Meeting Type
  let meetingType = 'أون لاين';
  if (/حضوري/i.test(cleanSummary)) {
    meetingType = 'حضوري';
    cleanSummary = cleanSummary.replace(/حضوري/gi, '').trim();
  } else if (/خارجي|خارج/i.test(cleanSummary)) {
    meetingType = 'خارجي';
    cleanSummary = cleanSummary.replace(/خارجي|خارج/gi, '').trim();
  } else if (/أون\s*لاين|اون\s*لاين|اونلاين|أونلاين/i.test(cleanSummary)) {
    meetingType = 'أون لاين';
    cleanSummary = cleanSummary.replace(/أون\s*لاين|اون\s*لاين|اونلاين|أونلاين/gi, '').trim();
  }

  // Clean up extra characters
  cleanSummary = cleanSummary.replace(/[\(\)\[\]]/g, '');
  cleanSummary = cleanSummary.replace(/^[\s\-\—\_]+|[\s\-\—\_]+$/g, '');

  // 3. Extract Client and Project Name
  // Remove common meeting prefixes
  cleanSummary = cleanSummary.replace(/^(اجتماع|إجتماع)(\s+(أ|لـ|مع|لمناقشة))?\s*/i, '').trim();

  // Split by dashes to separate client and project
  const parts = cleanSummary.split(/\s*[-—]\s*/).filter(p => p.trim() !== '');

  if (parts.length >= 2) {
    clientName = parts[0].trim();
    projectName = parts.slice(1).join(' - ').trim();
  } else {
    clientName = cleanSummary || summary;
    projectName = '';
    needsReview = true;
  }

  return { clientName, projectName, meetingTitle, needsReview, slackCode, meetingType };
}

// ════════════════ Main Handler ════════════════
module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const dateParam = req.query?.date || parsedUrl.searchParams.get('date'); // YYYY-MM-DD
  const monthParam = req.query?.month || parsedUrl.searchParams.get('month'); // YYYY-MM
  const emailParam = req.query?.email || parsedUrl.searchParams.get('email');

  const cacheKey = `${dateParam || ''}_${monthParam || ''}_${emailParam || ''}`;
  const cached = meetingsCache.get(cacheKey);
  if (cached && (Date.now() - cached.timestamp < MEETINGS_CACHE_TTL)) {
    res.writeHead(200);
    res.end(JSON.stringify(cached.data));
    return;
  }

  let dayStart, dayEnd;

  if (monthParam && /^\d{4}-\d{2}$/.test(monthParam)) {
    const [yyyy, mm] = monthParam.split('-');
    dayStart = new Date(`${yyyy}-${mm}-01T00:00:00+03:00`).toISOString();
    
    let nextYear = parseInt(yyyy, 10);
    let nextMonth = parseInt(mm, 10) + 1;
    if (nextMonth > 12) {
      nextMonth = 1;
      nextYear += 1;
    }
    const nextMonthStr = String(nextMonth).padStart(2, '0');
    dayEnd = new Date(`${nextYear}-${nextMonthStr}-01T00:00:00+03:00`).toISOString();
  } else {
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
    dayStart = targetDate.toISOString();
    dayEnd   = new Date(targetDate.getTime() + 24 * 60 * 60 * 1000).toISOString();
  }

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
      apiRes.on('end', async () => {
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
          
          // Pre-parse to find all unique Slack codes
          const parsedEvents = events.map(event => ({
            event,
            parsed: parseMeetingSummary(event.summary || '')
          }));
          
          const targetCodes = [...new Set(parsedEvents.map(e => e.parsed.slackCode).filter(Boolean))];
          
          // Fetch Slack Info ONLY for target codes (Fast & handles old Slack messages)
          const slackLookupMap = await fetchSlackLeadInfo(targetCodes);

          let result = parsedEvents.map(({ event, parsed }) => {
            const meetLink = event.hangoutLink ||
              (event.conferenceData?.entryPoints?.[0]?.uri) || '';
            const attendees = event.attendees || [];
            const salesRep  = determineSalesRep(attendees);

            const slackInfo = (parsed.slackCode && slackLookupMap[parsed.slackCode]) || {};

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
              salesRep,
              phone:       slackInfo.phone || "",
              crmLink:     slackInfo.crmLink || ""
            };
          });

          if (emailParam) {
            const emailLower = emailParam.toLowerCase();
            result = result.filter(r => {
              const isAttendee = r.attendees && r.attendees.some(a => a.email && a.email.toLowerCase() === emailLower);
              return isAttendee;
            });
          }

          meetingsCache.set(cacheKey, {
            timestamp: Date.now(),
            data: result
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
