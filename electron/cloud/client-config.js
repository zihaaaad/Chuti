'use strict';

// OAuth client registrations (public clients: safe to ship in the app).
// Resolved in this order, per provider:
//   1. environment: CHUTI_GOOGLE_CLIENT_ID + CHUTI_GOOGLE_CLIENT_SECRET, CHUTI_ONEDRIVE_CLIENT_ID
//   2. cloud-config.json bundled with the build (written by CI from repository secrets)
//   3. a registration the admin entered on this computer (Settings → Cloud backup → Use your own app)
// Forks and self-hosters therefore never depend on the maintainer's registrations.

const fs = require('fs');

function clean(value, max = 300) {
  return typeof value === 'string' && value.trim() && value.trim().length <= max ? value.trim() : null;
}

function fromObject(obj) {
  const g = obj && obj.google;
  const o = obj && obj.onedrive;
  return {
    google: g && clean(g.clientId) && clean(g.clientSecret) ? { clientId: clean(g.clientId), clientSecret: clean(g.clientSecret) } : null,
    onedrive: o && clean(o.clientId) ? { clientId: clean(o.clientId) } : null,
  };
}

/**
 * @param {{ env?: NodeJS.ProcessEnv, bundledFile?: string, userClients?: object }} o
 * @returns {{ google: null | { clientId: string, clientSecret: string, source: string }, onedrive: null | { clientId: string, source: string } }}
 */
function resolveClients({ env = process.env, bundledFile, userClients } = {}) {
  const fromEnv = fromObject({
    google: { clientId: env.CHUTI_GOOGLE_CLIENT_ID, clientSecret: env.CHUTI_GOOGLE_CLIENT_SECRET },
    onedrive: { clientId: env.CHUTI_ONEDRIVE_CLIENT_ID },
  });
  let bundled = { google: null, onedrive: null };
  try {
    if (bundledFile && fs.existsSync(bundledFile)) bundled = fromObject(JSON.parse(fs.readFileSync(bundledFile, 'utf8')));
  } catch (_) {}
  const user = fromObject(userClients || {});

  const pick = (key) => {
    if (fromEnv[key]) return { ...fromEnv[key], source: 'environment' };
    if (bundled[key]) return { ...bundled[key], source: 'bundled' };
    if (user[key]) return { ...user[key], source: 'custom' };
    return null;
  };
  return { google: pick('google'), onedrive: pick('onedrive') };
}

/** Validates a registration typed by the admin. Returns the cleaned value or throws. */
function validateUserClient(provider, input) {
  if (provider === 'google') {
    const clientId = clean(input && input.clientId);
    const clientSecret = clean(input && input.clientSecret);
    if (!clientId || !/\.apps\.googleusercontent\.com$/.test(clientId)) throw new Error('Enter the Google client ID (it ends in .apps.googleusercontent.com).');
    if (!clientSecret) throw new Error('Enter the Google client secret shown for the Desktop app client.');
    return { clientId, clientSecret };
  }
  if (provider === 'onedrive') {
    const clientId = clean(input && input.clientId);
    if (!clientId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(clientId)) {
      throw new Error('Enter the Application (client) ID from the Microsoft app registration.');
    }
    return { clientId };
  }
  throw new Error('Unknown provider.');
}

module.exports = { resolveClients, validateUserClient };
