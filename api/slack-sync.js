const https = require('https');

const slackSyncCache = new Map();
const SLACK_SYNC_CACHE_TTL = 30000; // 30 seconds

// ════════════════ CORS helper ════════════════
function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

// ════════════════ Slack helpers ════════════════
function fetchSlackReplies(token, channelId, ts) {
  return new Promise((resolve) => {
    const options = {
      hostname: 'slack.com',
      path: `/api/conversations.replies?channel=${channelId}&ts=${ts}`,
      method: 'GET',
      headers: { 'Authorization': `Bearer ${token}` }
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (c) => data += c);
      res.on('end', () => {
        try {
          const p = JSON.parse(data);
          resolve(p.ok && p.messages ? p.messages : []);
        } catch (e) { resolve([]); }
      });
    });
    req.on('error', () => resolve([]));
    req.end();
  });
}

function cleanSlackText(text) {
  if (!text) return '';
  const USER_MAP = {
    'U090T02NUET': 'م. روان محمد',
    'U097P6M4B18': 'م. شادي العربي',
    'U098ZR2PESW': 'م. مجاهد الأمين',
    'U097PK072H2': 'م. محمد القحطاني',
    'U0917H5R0HH': 'م. حسام حمد',
    'U0918BRF4RL': 'م. احمد النجار',
    'U097MKTQVCM': 'م. اشرف عصمت',
    'U0918T4HBNF': 'م.مصطفي ابراهيم',
    'U091X9BAG8G': 'م.مستشار مبيعات (سلمى الملاح)',
    'U0AM55APV27': 'نظام n8n الآلي',
    'U09C3NQ7E05': 'منسق المواعيد'
  };

  let cleaned = text;
  const mentionRegex = /<@(U[A-Z0-9]+)>/g;
  cleaned = cleaned.replace(mentionRegex, (match, userId) => {
    return '@' + (USER_MAP[userId] || userId);
  });

  return cleaned
    .replace(/<!subteam\^[A-Z0-9|a-z\-_\s]+>/g, '')
    .replace(/<tel:[^|]+\|([^>]+)>/g, '$1')
    .replace(/<http[^|]+\|([^>]+)>/g, '$1')
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
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
    if (num.startsWith('+966')) num = num.substring(4);
    else if (num.startsWith('966')) num = num.substring(3);
    if (num.startsWith('05') && num.length === 10) {
      if (!matches.includes(num)) matches.push(num);
    } else if (num.startsWith('5') && num.length === 9) {
      const f = '0' + num;
      if (!matches.includes(f)) matches.push(f);
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

// ════════════════ Main handler ════════════════
module.exports = async (req, res) => {
  setCors(res);

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const targetCodesStr = req.query?.codes || parsedUrl.searchParams.get('codes') || '';
  const cacheKey = targetCodesStr || 'all';

  const cached = slackSyncCache.get(cacheKey);
  if (cached && (Date.now() - cached.timestamp < SLACK_SYNC_CACHE_TTL)) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(cached.data));
    return;
  }

  req.targetCodesStr = targetCodesStr; // save it to avoid parsing again

  try {
    const token = process.env.SLACK_USER_TOKEN;
    const channelId = process.env.SLACK_CHANNEL_ID;

    if (!token || !channelId) {
      console.error('slack-sync: Missing env vars. SLACK_USER_TOKEN:', !!token, 'SLACK_CHANNEL_ID:', !!channelId);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Missing SLACK_USER_TOKEN or SLACK_CHANNEL_ID env vars' }));
      return;
    }

    // Fetch full channel history (up to 3000 messages via pagination)
    let messages = [];
    let cursor = null;
    let pagesFetched = 0;
    const maxPages = 3;

    while (pagesFetched < maxPages) {
      const pageData = await new Promise((resolve) => {
        let apiPath = `/api/conversations.history?channel=${encodeURIComponent(channelId)}&limit=1000`;
        if (cursor) {
          apiPath += `&cursor=${encodeURIComponent(cursor)}`;
        }
        const options = {
          hostname: 'slack.com',
          path: apiPath,
          method: 'GET',
          headers: { 'Authorization': `Bearer ${token}` }
        };
        const httpReq = https.request(options, (r) => {
          let data = '';
          r.on('data', (c) => data += c);
          r.on('end', () => {
            try { resolve(JSON.parse(data)); }
            catch (e) { resolve({ ok: false, error: 'JSON parse error' }); }
          });
        });
        httpReq.on('error', (e) => resolve({ ok: false, error: e.message }));
        httpReq.end();
      });

      if (!pageData.ok) {
        console.error('slack-sync: Slack API page fetch failed:', pageData.error);
        if (messages.length === 0) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: pageData.error || 'Slack API failed' }));
          return;
        }
        break;
      }

      const pageMsgs = pageData.messages || [];
      messages = messages.concat(pageMsgs);
      
      cursor = pageData.response_metadata && pageData.response_metadata.next_cursor;
      if (!cursor || pageMsgs.length === 0) {
        break;
      }
      pagesFetched++;
    }
    const lookupMap = {};

    // Parse target codes from query to avoid rate limiting Slack API
    const targetCodesStr = req.targetCodesStr || '';
    const targetCodes = new Set(
      targetCodesStr.split(',')
        .map(c => c.trim().toUpperCase())
        .filter(Boolean)
    );

    // Group messages by slackCode
    const groupedMessages = {};
    for (const msg of messages) {
      const text = msg.text || '';
      const codeMatch = text.match(/(?:AA|SLK|SLK-|CS)\d+/i);
      if (codeMatch) {
        const slackCode = codeMatch[0].toUpperCase();
        
        // If target codes are specified, only process those
        if (targetCodes.size > 0 && !targetCodes.has(slackCode)) {
          continue;
        }

        if (!groupedMessages[slackCode]) {
          groupedMessages[slackCode] = [];
        }
        groupedMessages[slackCode].push(msg);
      }
    }

    // Process each group in parallel
    const slackCodes = Object.keys(groupedMessages);
    await Promise.all(slackCodes.map(async (slackCode) => {
      const msgs = groupedMessages[slackCode];
      let phone = '';
      let crmLink = '';
      const allReplies = [];

      for (const msg of msgs) {
        // Extract phone if not already found
        const msgPhone = extractAndFormatPhones(msg.text);
        if (msgPhone) {
          if (!phone) {
            phone = msgPhone;
          } else {
            const existing = phone.split(' - ');
            const newNums = msgPhone.split(' - ');
            newNums.forEach(n => {
              if (!existing.includes(n)) existing.push(n);
            });
            phone = existing.join(' - ');
          }
        }

        // Extract CRM Link if not already found
        if (!crmLink) {
          crmLink = extractCrmLink(msg.text);
        }

        // Fetch thread replies if any
        if (msg.reply_count && msg.reply_count > 0) {
          const replies = await fetchSlackReplies(token, channelId, msg.ts);
          
          // Also look for CRM Link in replies if not found in parent
          if (!crmLink) {
            for (const r of replies) {
              const link = extractCrmLink(r.text);
              if (link) {
                crmLink = link;
                break;
              }
            }
          }

          const threadReplies = replies
            .filter(r => r.ts !== msg.ts)
            .map(r => ({
              text: cleanSlackText(r.text),
              ts: r.ts,
              user: r.user || 'Unknown',
              timestamp: parseFloat(r.ts) * 1000
            }));
          
          threadReplies.forEach(reply => {
            if (!allReplies.some(r => r.ts === reply.ts)) {
              allReplies.push(reply);
            }
          });
        }
      }

      // Sort replies chronologically
      allReplies.sort((a, b) => a.timestamp - b.timestamp);

      lookupMap[slackCode] = { phone, crmLink, thread: allReplies };
    }));

    slackSyncCache.set(cacheKey, {
      timestamp: Date.now(),
      data: lookupMap
    });

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(lookupMap));
  } catch (err) {
    console.error('slack-sync: Unhandled error:', err);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: err.message || 'Internal server error' }));
  }
};
