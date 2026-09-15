'use strict';

// OAuth 2.0 for installed apps: the system browser signs in, and the provider
// redirects to a temporary listener on this computer's loopback interface
// (RFC 8252). PKCE (S256) binds the code to this app instance and `state`
// rejects callbacks this flow did not start. Nothing listens on the network.

const crypto = require('crypto');
const http = require('http');

const base64url = (buf) => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

function createPkce() {
  const verifier = base64url(crypto.randomBytes(48));
  const challenge = base64url(crypto.createHash('sha256').update(verifier).digest());
  return { verifier, challenge };
}

const PAGE = (title, message) => `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title>
<style>body{font-family:'Segoe UI',system-ui,sans-serif;background:#f5f8f6;color:#172219;display:grid;place-items:center;min-height:100vh;margin:0}
main{background:#fff;border:1px solid #dbe5de;border-radius:10px;padding:2rem 2.5rem;max-width:28rem;text-align:center}h1{font-size:1.25rem;margin:0 0 .5rem}p{margin:0;color:#52665a}</style>
</head><body><main><h1>${title}</h1><p>${message}</p></main></body></html>`;

/**
 * Starts a one-shot callback listener on 127.0.0.1 (and ::1 on the same port
 * when available, since "localhost" may resolve to either).
 * @returns {Promise<{ port: number, waitForCallback: (state: string) => Promise<string>, close: () => void }>}
 */
async function startLoopback({ timeoutMs = 5 * 60 * 1000 } = {}) {
  let settle = null;
  const handler = (req, res) => {
    const url = new URL(req.url || '/', 'http://127.0.0.1');
    const code = url.searchParams.get('code');
    const error = url.searchParams.get('error');
    if (!code && !error) {
      res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found');
      return;
    }
    const ok = settle ? settle(url.searchParams) : false;
    res.writeHead(ok ? 200 : 400, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(ok
      ? PAGE('Chuti is connected', 'You can close this tab and return to Chuti.')
      : PAGE('Sign-in was not completed', 'Return to Chuti and try again.'));
  };

  const v4 = http.createServer(handler);
  await new Promise((resolve, reject) => {
    v4.once('error', reject);
    v4.listen(0, '127.0.0.1', resolve);
  });
  const { port } = v4.address();
  const v6 = http.createServer(handler);
  await new Promise((resolve) => {
    v6.once('error', () => resolve()); // no IPv6 loopback: fine
    v6.listen(port, '::1', resolve);
  });

  let timer = null;
  const close = () => {
    clearTimeout(timer);
    v4.close();
    v6.close();
  };

  const waitForCallback = (expectedState) =>
    new Promise((resolve, reject) => {
      timer = setTimeout(() => {
        settle = null;
        reject(new Error('Sign-in timed out. Try connecting again.'));
      }, timeoutMs);
      settle = (params) => {
        const state = params.get('state') || '';
        const expected = Buffer.from(expectedState);
        const given = Buffer.from(state);
        if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) return false; // ignore stray requests
        settle = null;
        clearTimeout(timer);
        const error = params.get('error');
        if (error) {
          const described = params.get('error_description');
          reject(new Error(error === 'access_denied' ? 'Access was not granted.' : `Sign-in failed: ${described || error}`));
          return true;
        }
        resolve(params.get('code'));
        return true;
      };
    });

  return { port, waitForCallback, close };
}

async function postForm(fetchImpl, url, form) {
  const res = await fetchImpl(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams(Object.entries(form).filter(([, v]) => v !== undefined && v !== null && v !== '')).toString(),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error_description || data.error || `Token request failed (${res.status}).`);
    err.code = data.error || `http_${res.status}`;
    throw err;
  }
  return data;
}

/**
 * Runs the browser sign-in and returns the provider's token response.
 * @param {object} o
 * @param {object} o.provider   provider definition (authorizeUrl, tokenUrl, scopes, redirectHost)
 * @param {{clientId: string, clientSecret?: string}} o.client
 * @param {(url: string) => Promise<void>} o.openExternal
 * @param {typeof fetch} [o.fetch]
 */
async function authorize({ provider, client, openExternal, fetch: fetchImpl = fetch, timeoutMs }) {
  const loopback = await startLoopback({ timeoutMs });
  try {
    const { verifier, challenge } = createPkce();
    const state = base64url(crypto.randomBytes(24));
    const redirectUri = `http://${provider.redirectHost}:${loopback.port}`;
    const params = new URLSearchParams({
      client_id: client.clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: provider.scopes.join(' '),
      code_challenge: challenge,
      code_challenge_method: 'S256',
      state,
      ...provider.extraAuthParams,
    });
    const waiting = loopback.waitForCallback(state);
    // The callback can fail before openExternal returns; it is awaited below.
    waiting.catch(() => {});
    await openExternal(`${provider.authorizeUrl}?${params}`);
    const code = await waiting;
    return await postForm(fetchImpl, provider.tokenUrl, {
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      client_id: client.clientId,
      client_secret: client.clientSecret,
      code_verifier: verifier,
      scope: provider.tokenScope ? provider.scopes.join(' ') : undefined,
    });
  } finally {
    loopback.close();
  }
}

async function refresh({ provider, client, refreshToken, fetch: fetchImpl = fetch }) {
  return postForm(fetchImpl, provider.tokenUrl, {
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: client.clientId,
    client_secret: client.clientSecret,
    scope: provider.tokenScope ? provider.scopes.join(' ') : undefined,
  });
}

module.exports = { authorize, refresh, createPkce, startLoopback, base64url };
