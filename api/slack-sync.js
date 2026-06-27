const https = require('https');

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
        } catch { resolve([]); }
      });
    });
    req.on('error', () => resolve([]));
    req.end();
  });
}

function cleanSlackText(text) {
  if (!text) return '';
  return text
    .replace(/<@U[A-Z0-9]+>/g, '')
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

// ════════════════ Main handler ════════════════
module.exports = async (req, res) => {
  setCors(res);

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  const token = process.env.SLACK_USER_TOKEN;
  const channelId = process.env.SLACK_CHANNEL_ID;

  if (!token || !channelId) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Missing SLACK_USER_TOKEN or SLACK_CHANNEL_ID env vars' }));
    return;
  }

  // Fetch full channel history (up to 1000 messages)
  const historyData = await new Promise((resolve) => {
    const options = {
      hostname: 'slack.com',
      path: `/api/conversations.history?channel=${encodeURIComponent(channelId)}&limit=1000`,
      method: 'GET',
      headers: { 'Authorization': `Bearer ${token}` }
    };
    const req = https.request(options, (r) => {
      let data = '';
      r.on('data', (c) => data += c);
      r.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch { resolve({ ok: false }); }
      });
    });
    req.on('error', () => resolve({ ok: false }));
    req.end();
  });

  if (!historyData.ok) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: historyData.error || 'Slack API failed' }));
    return;
  }

  const messages = historyData.messages || [];
  const lookupMap = {};

  // Find all messages with a slack code
  const toProcess = [];
  for (const msg of messages) {
    const text = msg.text || '';
    const codeMatch = text.match(/(?:AA|SLK|SLK-|CS)\d+/i);
    if (codeMatch) {
      const slackCode = codeMatch[0].toUpperCase();
      if (!lookupMap[slackCode]) { // first match wins (newest first)
        toProcess.push({ msg, slackCode });
      }
    }
  }

  // Fetch threads in parallel for messages that have replies
  await Promise.all(toProcess.map(async ({ msg, slackCode }) => {
    let threadReplies = [];
    if (msg.reply_count && msg.reply_count > 0) {
      const replies = await fetchSlackReplies(token, channelId, msg.ts);
      threadReplies = replies
        .filter(r => r.ts !== msg.ts)
        .map(r => ({
          text: cleanSlackText(r.text),
          ts: r.ts,
          user: r.user || 'Unknown',
          timestamp: parseFloat(r.ts) * 1000
        }));
    }

    const phone = extractAndFormatPhones(msg.text);
    let crmLink = '';
    const linkMatch = (msg.text || '').match(/https:\/\/e\.aait\.sa\/web#[^\s>]+/i);
    if (linkMatch) crmLink = linkMatch[0].replace(/&amp;/g, '&');

    lookupMap[slackCode] = { phone, crmLink, thread: threadReplies };
  }));

  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(lookupMap));
};
