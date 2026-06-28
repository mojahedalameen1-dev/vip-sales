const https = require('https');
const url = require('url');

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
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
  const match = text.match(/https?:\/\/[^\s>]*e\.aait\.sa[^\s>]*/i) || text.match(/https?:\/\/[^\s>]*odoo[^\s>]*/i);
  if (match) {
    return match[0].replace(/&amp;/g, '&').replace(/[>\|]/g, '').trim();
  }
  return '';
}

function slackGet(path, token) {
  return new Promise((resolve) => {
    const options = {
      hostname: 'slack.com',
      path,
      method: 'GET',
      headers: { 'Authorization': `Bearer ${token}` }
    };
    const req = https.request(options, (r) => {
      let data = '';
      r.on('data', c => data += c);
      r.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { resolve({ ok: false, error: 'JSON parse error' }); }
      });
    });
    req.on('error', e => resolve({ ok: false, error: e.message }));
    req.end();
  });
}

module.exports = async (req, res) => {
  setCors(res);

  if (req.method === 'OPTIONS') {
    res.writeHead(200); res.end(); return;
  }

  const token = process.env.SLACK_USER_TOKEN;
  const channelId = process.env.SLACK_CHANNEL_ID;

  if (!token || !channelId) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Missing env vars' }));
    return;
  }

  // Parse the target slackCode from query string
  const parsedUrl = url.parse(req.url, true);
  const targetCode = (parsedUrl.query.code || '').toUpperCase().trim();

  if (!targetCode) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Missing ?code= parameter' }));
    return;
  }

  try {
    // Paginate through history to find the target message
    let foundMsg = null;
    let cursor = null;

    while (!foundMsg) {
      let apiPath = `/api/conversations.history?channel=${encodeURIComponent(channelId)}&limit=200`;
      if (cursor) apiPath += `&cursor=${encodeURIComponent(cursor)}`;

      const pageData = await slackGet(apiPath, token);

      if (!pageData.ok) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: pageData.error || 'Slack history error' }));
        return;
      }

      const msgs = pageData.messages || [];
      for (const msg of msgs) {
        const text = msg.text || '';
        const codeMatch = text.match(/(?:AA|SLK|SLK-|CS)\d+/i);
        if (codeMatch && codeMatch[0].toUpperCase() === targetCode) {
          foundMsg = msg;
          break;
        }
      }

      cursor = pageData.response_metadata && pageData.response_metadata.next_cursor;
      if (!cursor || msgs.length === 0) break;
    }

    if (!foundMsg) {
      // Not found in Slack history - return empty result
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ thread: [], phone: '', crmLink: '' }));
      return;
    }

    // Extract phone and CRM link from the parent message
    const phone = extractAndFormatPhones(foundMsg.text);
    let crmLink = extractCrmLink(foundMsg.text);

    const USER_MAP = {
      'U090T02NUET': 'م. روان محمد',
      'U097P6M4B18': 'م. شادي العربي',
      'U098ZR2PESW': 'م. مجاهد الأمين',
      'U097PK072H2': 'م. محمد القحطاني',
      'U0917H5R0HH': 'م. حسام حمد',
      'U0918BRF4RL': 'م. احمد النجار',
      'U097MKTQVCM': 'م. اشرف عصمت',
      'U0918T4HBNF': 'م.مصطفي ابراهيم',
      'U091X9BAG8G': 'م.سلمى الملاح',
      'U0AM55APV27': 'نظام n8n الآلي',
      'U09C3NQ7E05': 'منسق المواعيد'
    };

    // Fetch thread replies if any
    let thread = [];
    if (foundMsg.reply_count && foundMsg.reply_count > 0) {
      const repliesData = await slackGet(
        `/api/conversations.replies?channel=${encodeURIComponent(channelId)}&ts=${foundMsg.ts}&limit=200`,
        token
      );

      if (repliesData.ok && repliesData.messages) {
        // Also look for CRM Link in replies if not found in parent
        if (!crmLink) {
          for (const r of repliesData.messages) {
            const link = extractCrmLink(r.text);
            if (link) {
              crmLink = link;
              break;
            }
          }
        }

        thread = repliesData.messages
          .filter(r => r.ts !== foundMsg.ts) // Exclude parent message
          .map(r => {
            const mappedUser = USER_MAP[r.user] || r.user || 'Unknown';
            return {
              text: cleanSlackText(r.text),
              ts: r.ts,
              user: mappedUser,
              timestamp: parseFloat(r.ts) * 1000
            };
          });
      }
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ phone, crmLink, thread }));

  } catch (err) {
    console.error('slack-thread error:', err);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: err.message }));
  }
};
