'use strict';

// Cloud backup service in the Electron main process: connects an account,
// uploads the encrypted archives the local server prepares, keeps the newest N,
// lists and downloads backups for restore, and runs the daily schedule.
// It talks to the server only through `internal(action, body)`.

const path = require('path');
const oauth = require('./oauth');
const { PROVIDERS, chutiBackups, BACKUP_NAME_RE } = require('./providers');

const TEN_MINUTES = 10 * 60 * 1000;

/**
 * @param {object} deps
 * @param {(action: string, body?: object) => Promise<any>} deps.internal  POST /api/internal/cloud-backup
 * @param {(url: string) => Promise<void>} deps.openExternal
 * @param {ReturnType<import('./token-store').createTokenStore>} deps.tokenStore
 * @param {() => ReturnType<import('./client-config').resolveClients>} deps.clients
 * @param {typeof fetch} [deps.fetch]
 * @param {(msg: string) => void} [deps.log]
 * @param {object} [deps.providers]  provider implementations (tests)
 * @param {object} [deps.oauthImpl]  OAuth helpers (tests)
 */
function createCloudService({ internal, openExternal, tokenStore, clients, fetch: fetchImpl = fetch, log = () => {}, providers = PROVIDERS, oauthImpl = oauth }) {
  let busy = null; // label of the running operation
  let access = null; // { token, expiresAt, refreshToken }
  let timers = [];

  const providerOf = (id) => {
    const p = providers[id];
    if (!p) throw new Error('Unknown cloud service.');
    return p;
  };

  const clientFor = (id) => {
    const c = clients()[id];
    if (!c) throw new Error(`${providerOf(id).label} is not set up in this copy of Chuti. Use “Use your own app registration” first.`);
    return c;
  };

  function friendly(err, provider) {
    if (err && (err.code === 'invalid_grant' || err.code === 'interaction_required')) {
      return `The connection to ${provider ? provider.label : 'the cloud account'} has expired or was removed. Disconnect and connect it again.`;
    }
    if (err && (err.cause?.code === 'ENOTFOUND' || err.cause?.code === 'ECONNREFUSED' || err.cause?.code === 'ETIMEDOUT' || err.message === 'fetch failed')) {
      return 'This computer could not reach the internet. The backup will be retried.';
    }
    return (err && err.message) || 'The cloud backup failed.';
  }

  async function accessToken(stored, force = false) {
    if (!force && access && access.refreshToken === stored.refreshToken && access.expiresAt > Date.now() + 60_000) return access.token;
    const provider = providerOf(stored.provider);
    const tokens = await oauthImpl.refresh({ provider, client: clientFor(stored.provider), refreshToken: stored.refreshToken, fetch: fetchImpl });
    if (tokens.refresh_token && tokens.refresh_token !== stored.refreshToken) {
      // Microsoft rotates refresh tokens: keep the newest one.
      stored.refreshToken = tokens.refresh_token;
      tokenStore.write(stored);
    }
    access = { token: tokens.access_token, expiresAt: Date.now() + (Number(tokens.expires_in) || 3000) * 1000, refreshToken: stored.refreshToken };
    return access.token;
  }

  /** Authorized fetch for provider APIs; refreshes the token once on 401. */
  function apiFor(stored) {
    return async (url, init = {}) => {
      const call = async (token) => fetchImpl(url, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${token}` } });
      let res = await call(await accessToken(stored));
      if (res.status === 401) res = await call(await accessToken(stored, true));
      return res;
    };
  }

  function connection() {
    const stored = tokenStore.read();
    if (!stored || !providers[stored.provider]) return null;
    return stored;
  }

  /** Providers use `state` for cached ids; the raw fetch goes along for pre-authorized upload URLs. */
  const stateFor = (stored) => ({
    get folderId() { return stored.folderId; },
    set folderId(v) {
      if (stored.folderId !== v) {
        stored.folderId = v;
        tokenStore.write(stored);
      }
    },
    fetch: fetchImpl,
  });

  async function exclusive(label, fn) {
    if (busy) throw new Error(`Chuti is already busy with the cloud (${busy}). Try again in a moment.`);
    busy = label;
    try {
      return await fn();
    } finally {
      busy = null;
    }
  }

  const service = {
    status() {
      const stored = connection();
      const c = clients();
      return {
        available: tokenStore.available(),
        provider: stored ? stored.provider : null,
        account: stored ? stored.account : null,
        busy,
        configured: {
          google: c.google ? c.google.source : null,
          onedrive: c.onedrive ? c.onedrive.source : null,
        },
      };
    },

    connect(providerId) {
      return exclusive('connecting', async () => {
        const provider = providerOf(providerId);
        const client = clientFor(providerId);
        if (!tokenStore.available()) throw new Error('Windows could not protect the sign-in token on this computer, so cloud backup is unavailable.');
        const tokens = await oauthImpl.authorize({ provider, client, openExternal, fetch: fetchImpl });
        if (!tokens.refresh_token) throw new Error(`${provider.label} did not allow offline access. Try again and approve all requested permissions.`);

        const previous = connection();
        const stored = { provider: providerId, account: '', refreshToken: tokens.refresh_token };
        access = { token: tokens.access_token, expiresAt: Date.now() + (Number(tokens.expires_in) || 3000) * 1000, refreshToken: stored.refreshToken };
        stored.account = await provider.account(apiFor(stored));
        if (previous && previous.refreshToken !== stored.refreshToken) {
          await providerOf(previous.provider).revoke(fetchImpl, previous.refreshToken).catch(() => {});
        }
        tokenStore.write(stored);
        const recorded = await internal('connected', { provider: providerId, account: stored.account });
        if (!recorded.ok) log(`Cloud connection saved, but the server did not record it: ${recorded.error}`);
        log(`Cloud backup connected: ${provider.label}`);
        return { provider: providerId, account: stored.account };
      });
    },

    disconnect() {
      return exclusive('disconnecting', async () => {
        const stored = connection();
        if (stored) await providerOf(stored.provider).revoke(fetchImpl, stored.refreshToken).catch(() => {});
        tokenStore.clear();
        access = null;
        await internal('disconnected');
        log('Cloud backup disconnected');
        return { ok: true };
      });
    },

    backupNow(trigger = 'manual') {
      return exclusive('backing up', async () => {
        const stored = connection();
        if (!stored) throw new Error('No cloud account is connected.');
        const provider = providerOf(stored.provider);
        let prepared = null;
        try {
          const status = await internal('status');
          if (!status.ok) throw new Error(status.error);
          prepared = await internal('prepare');
          if (!prepared.ok) throw new Error(prepared.error);
          if (!BACKUP_NAME_RE.test(prepared.name) || path.basename(prepared.path) !== prepared.name) throw new Error('The server prepared an unexpected file.');

          const api = apiFor(stored);
          const state = stateFor(stored);
          await provider.upload(api, state, prepared.path, prepared.name);

          // Keep the newest N Chuti backups; only after a successful upload.
          const keep = Math.max(1, Number(status.keep) || 30);
          const backups = chutiBackups(await provider.list(api, state));
          let pruned = 0;
          for (const old of backups.slice(keep)) {
            try {
              await provider.remove(api, state, old.id);
              pruned++;
            } catch (err) {
              log(`Could not delete old cloud backup ${old.name}: ${err.message}`);
            }
          }
          await internal('report', { ok: true, trigger, name: prepared.name, size: prepared.size, pruned });
          log(`Cloud backup uploaded to ${provider.label}: ${prepared.name}`);
          return { ok: true, name: prepared.name, size: prepared.size, pruned };
        } catch (err) {
          const message = friendly(err, provider);
          log(`Cloud backup failed: ${err && err.message}`);
          await internal('report', { ok: false, trigger, error: message }).catch(() => {});
          throw new Error(message);
        }
      });
    },

    async list() {
      const stored = connection();
      if (!stored) throw new Error('No cloud account is connected.');
      const provider = providerOf(stored.provider);
      try {
        return chutiBackups(await provider.list(apiFor(stored), stateFor(stored)));
      } catch (err) {
        throw new Error(friendly(err, provider));
      }
    },

    /** Downloads (unless already staged by a previous attempt) and restores one backup. */
    restore(id, name, secret, staged = false) {
      return exclusive('restoring', async () => {
        const stored = connection();
        if (!stored) throw new Error('No cloud account is connected.');
        if (!BACKUP_NAME_RE.test(name)) throw new Error('That is not a Chuti backup.');
        const provider = providerOf(stored.provider);
        if (!staged) {
          const staging = await internal('staging');
          if (!staging.ok) throw new Error(staging.error);
          try {
            await provider.download(apiFor(stored), stateFor(stored), id, path.join(staging.dir, name));
          } catch (err) {
            throw new Error(friendly(err, provider));
          }
        }
        const result = await internal('restore', { name, ...(secret ? { secret } : {}) });
        log(`Cloud restore of ${name}: ${result.ok ? 'done' : result.error}`);
        return result;
      });
    },

    /** One scheduler step: back up when connected and the server says it's due. */
    async tick() {
      if (busy || !connection()) return false;
      const status = await internal('status').catch(() => null);
      if (!status || !status.ok || !status.due || !status.provider) return false;
      await service.backupNow('scheduled').catch(() => {});
      return true;
    },

    start() {
      if (timers.length) return;
      timers.push(setTimeout(() => void service.tick(), 2 * 60 * 1000));
      timers.push(setInterval(() => void service.tick(), TEN_MINUTES));
      for (const t of timers) t.unref?.();
    },

    stop() {
      for (const t of timers) clearTimeout(t);
      timers = [];
    },
  };
  return service;
}

module.exports = { createCloudService };
