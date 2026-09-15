import { afterAll, describe, expect, it, vi } from 'vitest';
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const oauth = require('./oauth.js');
const { PROVIDERS, chutiBackups, GOOGLE_CHUNK } = require('./providers.js');
const { createTokenStore } = require('./token-store.js');
const { resolveClients, validateUserClient } = require('./client-config.js');
const { createCloudService } = require('./service.js');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'chuti-cloud-'));
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

type Call = { url: string; init: RequestInit & { headers?: Record<string, string> } };
function mockFetch(handler: (url: string, init: Call['init']) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const fn = vi.fn(async (url: string, init: Call['init'] = {}) => {
    calls.push({ url, init });
    return handler(url, init);
  });
  return { fn: fn as unknown as typeof fetch, calls };
}
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });

describe('oauth', () => {
  it('creates an S256 PKCE pair', () => {
    const { verifier, challenge } = oauth.createPkce();
    expect(verifier.length).toBeGreaterThanOrEqual(43);
    expect(challenge).toBe(oauth.base64url(crypto.createHash('sha256').update(verifier).digest()));
  });

  const provider = {
    authorizeUrl: 'https://auth.example/authorize',
    tokenUrl: 'https://auth.example/token',
    scopes: ['files'],
    redirectHost: '127.0.0.1',
    extraAuthParams: { access_type: 'offline' },
  };

  it('completes the loopback flow, ignoring callbacks with the wrong state', async () => {
    let challenge = '';
    const { fn, calls } = mockFetch(() => json({ access_token: 'at', refresh_token: 'rt', expires_in: 3600 }));
    const openExternal = async (url: string) => {
      const u = new URL(url);
      challenge = u.searchParams.get('code_challenge')!;
      expect(u.searchParams.get('code_challenge_method')).toBe('S256');
      expect(u.searchParams.get('access_type')).toBe('offline');
      const redirect = u.searchParams.get('redirect_uri')!;
      // A stray request with a forged state is refused and does not end the flow.
      const forged = await globalThis.fetch(`${redirect}/?code=evil&state=nope`);
      expect(forged.status).toBe(400);
      const ok = await globalThis.fetch(`${redirect}/?code=good&state=${u.searchParams.get('state')}`);
      expect(ok.status).toBe(200);
    };
    const tokens = await oauth.authorize({ provider, client: { clientId: 'cid', clientSecret: 'sec' }, openExternal, fetch: fn });
    expect(tokens.refresh_token).toBe('rt');
    const form = new URLSearchParams(String(calls[0].init.body));
    expect(form.get('code')).toBe('good');
    expect(form.get('client_secret')).toBe('sec');
    expect(oauth.base64url(crypto.createHash('sha256').update(form.get('code_verifier')!).digest())).toBe(challenge);
  });

  it('reports a denied consent', async () => {
    const openExternal = async (url: string) => {
      const u = new URL(url);
      await globalThis.fetch(`${u.searchParams.get('redirect_uri')}/?error=access_denied&state=${u.searchParams.get('state')}`);
    };
    await expect(oauth.authorize({ provider, client: { clientId: 'cid' }, openExternal, fetch: mockFetch(() => json({})).fn })).rejects.toThrow(/not granted/);
  });

  it('surfaces token errors with their OAuth code', async () => {
    const { fn } = mockFetch(() => json({ error: 'invalid_grant', error_description: 'Token has been expired or revoked.' }, 400));
    await expect(oauth.refresh({ provider, client: { clientId: 'cid' }, refreshToken: 'x', fetch: fn })).rejects.toMatchObject({ code: 'invalid_grant' });
  });
});

describe('providers', () => {
  it('uploads to Google Drive in chunks and resumes from the stored range', async () => {
    const file = path.join(tmp, 'Chuti-Backup_2026-09-15_101500.chuti');
    const size = GOOGLE_CHUNK + 1234;
    fs.writeFileSync(file, crypto.randomBytes(size));
    let puts = 0;
    const { fn: api, calls } = mockFetch((url, init) => {
      if (url.includes('/files?spaces=drive')) return json({ files: [{ id: 'folder1' }] });
      if (url.includes('uploadType=resumable')) return new Response(null, { status: 200, headers: { Location: 'https://upload.example/session' } });
      if (url === 'https://upload.example/session') {
        puts++;
        if (puts === 1) {
          expect(init.headers!['Content-Range']).toBe(`bytes 0-${GOOGLE_CHUNK - 1}/${size}`);
          return new Response(null, { status: 308, headers: { Range: `bytes=0-${GOOGLE_CHUNK - 1}` } });
        }
        expect(init.headers!['Content-Range']).toBe(`bytes ${GOOGLE_CHUNK}-${size - 1}/${size}`);
        return json({ id: 'file1' });
      }
      throw new Error(`unexpected ${url}`);
    });
    const state: { folderId?: string } = {};
    const id = await PROVIDERS.google.upload(api, state, file, path.basename(file));
    expect(id).toBe('file1');
    expect(state.folderId).toBe('folder1');
    const start = calls.find((c) => c.url.includes('uploadType=resumable'))!;
    expect(JSON.parse(String(start.init.body))).toMatchObject({ parents: ['folder1'] });
  });

  it('uploads to OneDrive without sending the bearer token to the upload URL', async () => {
    const file = path.join(tmp, 'Chuti-Backup_2026-09-15_101501.chuti');
    fs.writeFileSync(file, crypto.randomBytes(5000));
    const { fn: api } = mockFetch((url) => {
      expect(url).toContain('/me/drive/special/approot:/Chuti-Backup_2026-09-15_101501.chuti:/createUploadSession');
      return json({ uploadUrl: 'https://onedrive.example/up' });
    });
    const { fn: raw, calls } = mockFetch(() => json({ id: 'od1' }, 201));
    const id = await PROVIDERS.onedrive.upload(api, { fetch: raw }, file, path.basename(file));
    expect(id).toBe('od1');
    expect(calls[0].init.headers).not.toHaveProperty('Authorization');
    expect(calls[0].init.headers!['Content-Range']).toBe('bytes 0-4999/5000');
  });

  it('keeps only Chuti backups, newest first', () => {
    const files = [
      { id: '1', name: 'Chuti-Backup_2026-09-01_180000.chuti' },
      { id: '2', name: 'holiday photos.zip' },
      { id: '3', name: 'Chuti-Backup_2026-09-03_180000.chuti' },
      { id: '4', name: 'Chuti-Backup_2026-09-02_180000.zip' },
    ];
    expect(chutiBackups(files).map((f: { id: string }) => f.id)).toEqual(['3', '1']);
  });
});

describe('token store and client config', () => {
  const fakeCrypto = (available = true) => ({
    available: () => available,
    encrypt: (s: string) => Buffer.from(s).reverse(),
    decrypt: (b: Buffer) => Buffer.from(b).reverse().toString(),
  });

  it('round-trips an encrypted connection and refuses to store without OS protection', () => {
    const file = path.join(tmp, 'cloud.dat');
    const store = createTokenStore({ file, crypto: fakeCrypto() });
    store.write({ provider: 'google', account: 'a@b.c', refreshToken: 'rt' });
    expect(fs.readFileSync(file, 'utf8')).not.toContain('rt"');
    expect(store.read()).toMatchObject({ provider: 'google', refreshToken: 'rt' });
    store.clear();
    expect(store.read()).toBeNull();
    expect(() => createTokenStore({ file, crypto: fakeCrypto(false) }).write({ provider: 'google', refreshToken: 'x' })).toThrow(/protect/);
  });

  it('prefers environment, then bundled, then custom registrations', () => {
    const bundledFile = path.join(tmp, 'cloud-config.json');
    fs.writeFileSync(bundledFile, JSON.stringify({ onedrive: { clientId: 'bundled-od' } }));
    const clients = resolveClients({
      env: { CHUTI_GOOGLE_CLIENT_ID: 'env-g', CHUTI_GOOGLE_CLIENT_SECRET: 'env-s' },
      bundledFile,
      userClients: { google: { clientId: 'user-g', clientSecret: 'user-s' }, onedrive: { clientId: 'user-od' } },
    });
    expect(clients.google).toMatchObject({ clientId: 'env-g', source: 'environment' });
    expect(clients.onedrive).toMatchObject({ clientId: 'bundled-od', source: 'bundled' });
    expect(resolveClients({ env: {} }).google).toBeNull();
  });

  it('validates registrations typed by the admin', () => {
    expect(() => validateUserClient('google', { clientId: 'abc', clientSecret: 'x' })).toThrow(/googleusercontent/);
    expect(validateUserClient('google', { clientId: ' 1-a.apps.googleusercontent.com ', clientSecret: 's ' })).toEqual({ clientId: '1-a.apps.googleusercontent.com', clientSecret: 's' });
    expect(() => validateUserClient('onedrive', { clientId: 'nope' })).toThrow(/client\) ID/);
  });
});

describe('cloud service', () => {
  function setup(overrides: { upload?: () => Promise<string>; list?: () => Promise<{ id: string; name: string }[]>; refresh?: () => Promise<unknown> } = {}) {
    let saved: Record<string, unknown> | null = { provider: 'fake', account: 'me@example.com', refreshToken: 'rt1' };
    const tokenStore = {
      available: () => true,
      read: () => (saved ? { ...saved } : null),
      write: (d: Record<string, unknown>) => { saved = { ...d }; },
      clear: () => { saved = null; },
    };
    const internalCalls: { action: string; body?: Record<string, unknown> }[] = [];
    const internal = vi.fn(async (action: string, body?: Record<string, unknown>) => {
      internalCalls.push({ action, body });
      if (action === 'status') return { ok: true, provider: 'fake', keep: 2, due: true };
      if (action === 'prepare') return { ok: true, name: 'Chuti-Backup_2026-09-15_190000.chuti', path: path.join(tmp, 'Chuti-Backup_2026-09-15_190000.chuti'), size: 10 };
      return { ok: true };
    });
    const removed: string[] = [];
    const provider = {
      label: 'Fake Drive',
      account: async () => 'me@example.com',
      upload: overrides.upload ?? (async () => 'new'),
      list: overrides.list ?? (async () => [
        { id: 'a', name: 'Chuti-Backup_2026-09-15_190000.chuti' },
        { id: 'b', name: 'Chuti-Backup_2026-09-14_190000.chuti' },
        { id: 'c', name: 'Chuti-Backup_2026-09-13_190000.chuti' },
        { id: 'd', name: 'Chuti-Backup_2026-09-12_190000.chuti' },
        { id: 'x', name: 'notes.txt' },
      ]),
      remove: async (_api: unknown, _state: unknown, id: string) => { removed.push(id); },
      download: async () => {},
      revoke: async () => {},
    };
    const oauthImpl = {
      refresh: overrides.refresh ?? (async () => ({ access_token: 'at', refresh_token: 'rt2', expires_in: 3600 })),
      authorize: async () => ({ access_token: 'at', refresh_token: 'rt', expires_in: 3600 }),
    };
    const service = createCloudService({
      internal,
      openExternal: async () => {},
      tokenStore,
      clients: () => ({ fake: { clientId: 'cid', source: 'custom' } }),
      providers: { fake: provider },
      oauthImpl,
    });
    return { service, internalCalls, removed, saved: () => saved };
  }

  it('uploads, prunes beyond the kept count, reports success and keeps a rotated refresh token', async () => {
    const t = setup({
      upload: async function (this: unknown, ...args: unknown[]) {
        const api = args[0] as (url: string) => Promise<Response>;
        await api('https://fake.example/touch').catch(() => {}); // forces a token refresh
        return 'new';
      },
    });
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => new Response('{}')) as typeof fetch;
    try {
      const result = await t.service.backupNow('manual');
      expect(result).toMatchObject({ ok: true, pruned: 2 });
    } finally {
      globalThis.fetch = originalFetch;
    }
    expect(t.removed).toEqual(['c', 'd']);
    expect(t.internalCalls.at(-1)).toMatchObject({ action: 'report', body: { ok: true, trigger: 'manual', pruned: 2 } });
    expect(t.saved()).toMatchObject({ refreshToken: 'rt2' });
  });

  it('reports an expired connection in plain words', async () => {
    const t = setup({
      refresh: async () => { throw Object.assign(new Error('Token has been expired or revoked.'), { code: 'invalid_grant' }); },
      upload: async function (...args: unknown[]) {
        await (args[0] as (url: string) => Promise<Response>)('https://fake.example/x');
        return 'never';
      },
    });
    await expect(t.service.backupNow('scheduled')).rejects.toThrow(/expired or was removed/);
    expect(t.internalCalls.at(-1)).toMatchObject({ action: 'report', body: { ok: false, trigger: 'scheduled' } });
  });

  it('refuses overlapping operations and only ticks when due', async () => {
    let release!: () => void;
    const t = setup({ upload: () => new Promise((r) => { release = () => r('new'); }) });
    const first = t.service.backupNow('manual');
    await new Promise((r) => setTimeout(r, 10));
    await expect(t.service.backupNow('manual')).rejects.toThrow(/already busy/);
    expect(await t.service.tick()).toBe(false);
    release();
    await first;
  });
});
