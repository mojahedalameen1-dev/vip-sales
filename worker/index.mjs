import { createServer } from 'node:http';
import { handleAsNodeRequest } from 'cloudflare:node';
import meetings from '../api/meetings.js';
import slackSync from '../api/slack-sync.js';
import slackThread from '../api/slack-thread.js';

const firebaseWebApiKey = 'AIzaSyA7Ttn8e6aMSoqf1sDKJE1evjmLGf95JDE';
const staffEmails = [
  'hosammohammed528@gmail.com',
  'ashrafesmat1@gmail.com',
  'shady.alaraby22@gmail.com',
  'mojahedalameen1@gmail.com',
];

const handlers = new Map([
  ['/api/meetings', meetings],
  ['/api/slack-sync', slackSync],
  ['/api/slack-thread', slackThread],
]);

const port = 8080;
createServer(async (req, res) => {
  res.setHeader('Cache-Control', 'private, no-store');
  try {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    await handlers.get(pathname)(req, res);
  } catch (error) {
    console.error('VIP Sales API request failed', error.name);
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
    }
    res.end(JSON.stringify({ error: 'Internal server error' }));
  }
}).listen(port);

function apiError(status, error, headers = {}) {
  return Response.json({ error }, {
    status,
    headers: { 'Cache-Control': 'private, no-store', ...headers },
  });
}

async function getVerifiedEmail(token) {
  const response = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${firebaseWebApiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken: token }),
      signal: AbortSignal.timeout(5000),
    },
  );
  if ([400, 401, 403].includes(response.status)) return null;
  if (!response.ok) throw new Error('Firebase account lookup failed');
  const { users } = await response.json();
  const user = users?.[0];
  return user?.emailVerified && !user.disabled ? user.email?.toLowerCase() : null;
}

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);
    if (pathname !== '/api' && !pathname.startsWith('/api/')) {
      return env.ASSETS.fetch(request);
    }
    if (!handlers.has(pathname)) return apiError(404, 'Not found');
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: { Allow: 'GET, OPTIONS' } });
    }
    if (request.method !== 'GET') {
      return apiError(405, 'Method not allowed', { Allow: 'GET, OPTIONS' });
    }

    const token = /^Bearer (\S+)$/i.exec(request.headers.get('Authorization') || '')?.[1];
    if (!token) return apiError(401, 'Firebase sign-in required');

    let email;
    try {
      email = await getVerifiedEmail(token);
    } catch {
      return apiError(503, 'Unable to verify Firebase sign-in');
    }
    if (!email) return apiError(401, 'Invalid Firebase sign-in');
    const extraEmails = (env.VIP_SALES_ALLOWED_EMAILS || '').toLowerCase().split(',').map(value => value.trim());
    if (!staffEmails.includes(email) && !extraEmails.includes(email)) {
      return apiError(403, 'This account does not have access to VIP Sales integrations');
    }

    const slackConfigured = env.SLACK_USER_TOKEN && env.SLACK_CHANNEL_ID;
    const configured = pathname === '/api/meetings' ? env.GOOGLE_SERVICE_ACCOUNT_JSON : slackConfigured;
    if (!configured) return apiError(503, 'This integration is not configured');

    return handleAsNodeRequest(port, request);
  },
};
