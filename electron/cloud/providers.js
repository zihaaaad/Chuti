'use strict';

// Google Drive and OneDrive over their REST APIs with plain fetch (no SDKs).
// Each provider only touches its own app area:
//   Google Drive: the `drive.file` scope, which sees only files Chuti created,
//                 kept in a "Chuti Backups" folder.
//   OneDrive:     the `Files.ReadWrite.AppFolder` scope, i.e. Apps/Chuti.
// `api` is an authorized client: api(url, init) → Response, adding the bearer
// token and refreshing it once on 401.

const fs = require('fs');
const { Readable } = require('stream');
const { pipeline } = require('stream/promises');

const BACKUP_NAME_RE = /^Chuti-Backup_\d{4}-\d{2}-\d{2}_\d{6}\.chuti$/;

async function ensureOk(res, what) {
  if (res.ok) return res;
  let detail = '';
  try {
    const data = await res.json();
    detail = data?.error?.message || data?.error_description || data?.error || '';
    if (typeof detail !== 'string') detail = JSON.stringify(detail);
  } catch (_) {}
  const err = new Error(`${what} failed (${res.status})${detail ? `: ${detail}` : ''}.`);
  err.status = res.status;
  throw err;
}

async function readChunk(handle, start, length) {
  const buf = Buffer.alloc(length);
  let offset = 0;
  while (offset < length) {
    const { bytesRead } = await handle.read(buf, offset, length - offset, start + offset);
    if (bytesRead === 0) break;
    offset += bytesRead;
  }
  return offset === length ? buf : buf.subarray(0, offset);
}

async function saveBody(res, destPath) {
  const partial = `${destPath}.partial`;
  try {
    await pipeline(Readable.fromWeb(res.body), fs.createWriteStream(partial));
    fs.renameSync(partial, destPath);
  } catch (err) {
    fs.rmSync(partial, { force: true });
    throw err;
  }
}

// ─── Google Drive ─────────────────────────────────────────────────────────────

const DRIVE = 'https://www.googleapis.com/drive/v3';
const FOLDER_NAME = 'Chuti Backups';
const FOLDER_MIME = 'application/vnd.google-apps.folder';
const GOOGLE_CHUNK = 8 * 1024 * 1024; // multiple of 256 KiB

const google = {
  id: 'google',
  label: 'Google Drive',
  authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
  tokenUrl: 'https://oauth2.googleapis.com/token',
  scopes: ['https://www.googleapis.com/auth/drive.file'],
  redirectHost: '127.0.0.1',
  // offline + consent: always return a refresh token, even on reconnect.
  extraAuthParams: { access_type: 'offline', prompt: 'consent' },
  tokenScope: false,
  needsSecret: true,

  async account(api) {
    const res = await ensureOk(await api(`${DRIVE}/about?fields=user(emailAddress,displayName)`), 'Reading the Google account');
    const { user } = await res.json();
    return user?.emailAddress || user?.displayName || 'Google account';
  },

  async folderId(api, state) {
    if (state.folderId) {
      const res = await api(`${DRIVE}/files/${encodeURIComponent(state.folderId)}?fields=id,trashed`);
      if (res.ok && !(await res.json()).trashed) return state.folderId;
    }
    const q = `name = '${FOLDER_NAME}' and mimeType = '${FOLDER_MIME}' and trashed = false`;
    const found = await ensureOk(await api(`${DRIVE}/files?spaces=drive&fields=files(id)&q=${encodeURIComponent(q)}`), 'Finding the backup folder');
    const existing = (await found.json()).files?.[0]?.id;
    if (existing) {
      state.folderId = existing;
      return existing;
    }
    const created = await ensureOk(await api(`${DRIVE}/files?fields=id`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: FOLDER_NAME, mimeType: FOLDER_MIME }),
    }), 'Creating the backup folder');
    state.folderId = (await created.json()).id;
    return state.folderId;
  },

  async upload(api, state, filePath, name, onProgress) {
    const size = fs.statSync(filePath).size;
    const parent = await this.folderId(api, state);
    const start = await ensureOk(await api('https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=UTF-8',
        'X-Upload-Content-Type': 'application/octet-stream',
        'X-Upload-Content-Length': String(size),
      },
      body: JSON.stringify({ name, parents: [parent], mimeType: 'application/octet-stream' }),
    }), 'Starting the upload');
    const sessionUrl = start.headers.get('location');
    if (!sessionUrl) throw new Error('Google Drive did not start the upload.');

    const handle = await fs.promises.open(filePath, 'r');
    try {
      let offset = 0;
      for (;;) {
        const chunk = await readChunk(handle, offset, Math.min(GOOGLE_CHUNK, size - offset));
        const end = offset + chunk.length - 1;
        const res = await api(sessionUrl, {
          method: 'PUT',
          headers: { 'Content-Length': String(chunk.length), 'Content-Range': size === 0 ? 'bytes */0' : `bytes ${offset}-${end}/${size}` },
          body: chunk,
        });
        if (res.status === 308) {
          // Resume Incomplete: continue from what Google actually stored.
          const range = res.headers.get('range');
          offset = range ? Number(range.split('-')[1]) + 1 : 0;
          onProgress?.(offset, size);
          continue;
        }
        await ensureOk(res, 'Uploading the backup');
        onProgress?.(size, size);
        return (await res.json()).id;
      }
    } finally {
      await handle.close();
    }
  },

  async list(api, state) {
    const parent = await this.folderId(api, state);
    const out = [];
    let pageToken = '';
    do {
      const q = `'${parent}' in parents and trashed = false`;
      const res = await ensureOk(await api(`${DRIVE}/files?spaces=drive&pageSize=1000&fields=nextPageToken,files(id,name,size,createdTime)&q=${encodeURIComponent(q)}${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''}`), 'Listing backups');
      const data = await res.json();
      for (const f of data.files || []) out.push({ id: f.id, name: f.name, size: Number(f.size || 0), createdAt: f.createdTime });
      pageToken = data.nextPageToken || '';
    } while (pageToken);
    return out;
  },

  async download(api, _state, id, destPath) {
    const res = await ensureOk(await api(`${DRIVE}/files/${encodeURIComponent(id)}?alt=media`), 'Downloading the backup');
    await saveBody(res, destPath);
  },

  async remove(api, _state, id) {
    const res = await api(`${DRIVE}/files/${encodeURIComponent(id)}`, { method: 'DELETE' });
    if (res.status !== 404) await ensureOk(res, 'Deleting an old backup');
  },

  async revoke(fetchImpl, refreshToken) {
    await fetchImpl('https://oauth2.googleapis.com/revoke', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token: refreshToken }).toString(),
    });
  },
};

// ─── OneDrive (Microsoft Graph) ───────────────────────────────────────────────

const GRAPH = 'https://graph.microsoft.com/v1.0';
const ONEDRIVE_CHUNK = 320 * 1024 * 32; // 10 MiB, a multiple of 320 KiB as Graph requires

const onedrive = {
  id: 'onedrive',
  label: 'OneDrive',
  authorizeUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
  tokenUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
  scopes: ['Files.ReadWrite.AppFolder', 'User.Read', 'offline_access'],
  // Microsoft matches http://localhost redirects on any port.
  redirectHost: 'localhost',
  extraAuthParams: { response_mode: 'query', prompt: 'select_account' },
  tokenScope: true,
  needsSecret: false,

  async account(api) {
    const res = await ensureOk(await api(`${GRAPH}/me?$select=userPrincipalName,mail,displayName`), 'Reading the Microsoft account');
    const me = await res.json();
    return me.mail || me.userPrincipalName || me.displayName || 'Microsoft account';
  },

  async upload(api, state, filePath, name, onProgress) {
    const rawFetch = state.fetch || fetch;
    const size = fs.statSync(filePath).size;
    const session = await ensureOk(await api(`${GRAPH}/me/drive/special/approot:/${encodeURIComponent(name)}:/createUploadSession`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ item: { '@microsoft.graph.conflictBehavior': 'replace', name } }),
    }), 'Starting the upload');
    const { uploadUrl } = await session.json();
    if (!uploadUrl) throw new Error('OneDrive did not start the upload.');

    const handle = await fs.promises.open(filePath, 'r');
    try {
      let offset = 0;
      for (;;) {
        const chunk = await readChunk(handle, offset, Math.min(ONEDRIVE_CHUNK, size - offset));
        // The upload URL is pre-authorized: sending the bearer token to it is refused.
        const res = await rawFetch(uploadUrl, {
          method: 'PUT',
          headers: { 'Content-Length': String(chunk.length), 'Content-Range': `bytes ${offset}-${offset + chunk.length - 1}/${size}` },
          body: chunk,
        });
        if (res.status === 202) {
          const data = await res.json();
          const next = data.nextExpectedRanges?.[0];
          offset = next ? Number(String(next).split('-')[0]) : offset + chunk.length;
          onProgress?.(offset, size);
          continue;
        }
        await ensureOk(res, 'Uploading the backup');
        onProgress?.(size, size);
        return (await res.json()).id;
      }
    } catch (err) {
      rawFetch(uploadUrl, { method: 'DELETE' }).catch(() => {});
      throw err;
    } finally {
      await handle.close();
    }
  },

  async list(api) {
    const out = [];
    let url = `${GRAPH}/me/drive/special/approot/children?$select=id,name,size,createdDateTime,file&$top=999`;
    while (url) {
      const res = await ensureOk(await api(url), 'Listing backups');
      const data = await res.json();
      for (const f of data.value || []) if (f.file) out.push({ id: f.id, name: f.name, size: Number(f.size || 0), createdAt: f.createdDateTime });
      url = data['@odata.nextLink'] || '';
    }
    return out;
  },

  async download(api, _state, id, destPath) {
    // Graph answers with a redirect to a pre-authorized URL; fetch drops the
    // Authorization header when following it to another origin.
    const res = await ensureOk(await api(`${GRAPH}/me/drive/items/${encodeURIComponent(id)}/content`), 'Downloading the backup');
    await saveBody(res, destPath);
  },

  async remove(api, _state, id) {
    const res = await api(`${GRAPH}/me/drive/items/${encodeURIComponent(id)}`, { method: 'DELETE' });
    if (res.status !== 404) await ensureOk(res, 'Deleting an old backup');
  },

  async revoke() {
    // Microsoft has no per-token revocation endpoint for public clients; the
    // token is deleted locally and the user can remove access at account.live.com/consent.
  },
};

const PROVIDERS = { google, onedrive };

/** Backups Chuti made, newest first. Other files in the folder are ignored and never deleted. */
function chutiBackups(files) {
  return files.filter((f) => BACKUP_NAME_RE.test(f.name)).sort((a, b) => (a.name < b.name ? 1 : a.name > b.name ? -1 : 0));
}

module.exports = { PROVIDERS, chutiBackups, BACKUP_NAME_RE, GOOGLE_CHUNK, ONEDRIVE_CHUNK };
