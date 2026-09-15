import fs from 'fs';
import { NextRequest, NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { authorizeInternal, readJson } from '@/lib/internal-request';
import { ActionError, getDb } from '@/lib/db';
import {
  cloudStagingDir,
  clearCloudStaging,
  isCloudBackupDue,
  isCloudProvider,
  prepareCloudUpload,
  readCloudConfig,
  recordCloudConnection,
  recordCloudResult,
  stagedArchivePath,
} from '@/lib/cloud-backup';
import { restoreArchiveFile } from '@/lib/restore';

// Cloud backup coordination with the Electron main process, which holds the
// account tokens and does the uploads and downloads. Reachable only with the
// per-launch secret (see authorizeInternal).
//
//   status                                   → { provider, account, due, stagingDir }   (no session: scheduler)
//   prepare                                  → { name, path, size }                     (no session: scheduler)
//   report   { ok, trigger, name, size, pruned, error }                                 (no session: scheduler)
//   connected { provider, account } / disconnected                                     (signed-in admin)
//   staging                                  → { dir }  empty folder for a download      (signed-in admin)
//   restore  { name, secret? }               → { attachments }                          (signed-in admin)
const SCHEDULER_ACTIONS = new Set(['status', 'prepare', 'report']);

export async function POST(request: NextRequest) {
  const body = await readJson(request);
  const action = typeof body?.action === 'string' ? body.action : '';

  const denied = await authorizeInternal(request, { sessionOptional: SCHEDULER_ACTIONS.has(action) });
  if (denied) return denied;

  const str = (k: string) => (typeof body?.[k] === 'string' ? (body[k] as string) : undefined);

  try {
    switch (action) {
      case 'status': {
        const config = await readCloudConfig(await getDb());
        return NextResponse.json({ ok: true, provider: config.provider, account: config.account, keep: config.keep, due: isCloudBackupDue(config) });
      }
      case 'prepare': {
        try {
          const archive = await prepareCloudUpload();
          return NextResponse.json({ ok: true, ...archive });
        } catch (err) {
          // Expected refusals (no password yet, locked, already running) are not server errors.
          const message = err instanceof Error ? err.message : 'The backup could not be prepared.';
          if (!/encrypted|locked|already|protected/i.test(message)) console.error('[cloud-backup] prepare failed:', err);
          return NextResponse.json({ error: message }, { status: 422 });
        }
      }
      case 'report': {
        await recordCloudResult({
          ok: body?.ok === true,
          trigger: body?.trigger === 'manual' ? 'manual' : 'scheduled',
          name: str('name'),
          size: typeof body?.size === 'number' ? body.size : undefined,
          pruned: typeof body?.pruned === 'number' ? body.pruned : undefined,
          error: str('error'),
        });
        revalidatePath('/', 'layout');
        return NextResponse.json({ ok: true });
      }
      case 'connected': {
        const provider = body?.provider;
        if (!isCloudProvider(provider)) return NextResponse.json({ error: 'Unknown provider.' }, { status: 400 });
        await recordCloudConnection(provider, str('account') ?? null);
        revalidatePath('/', 'layout');
        return NextResponse.json({ ok: true });
      }
      case 'disconnected': {
        await recordCloudConnection(null, null);
        clearCloudStaging();
        revalidatePath('/', 'layout');
        return NextResponse.json({ ok: true });
      }
      case 'staging': {
        clearCloudStaging();
        fs.mkdirSync(cloudStagingDir(), { recursive: true });
        return NextResponse.json({ ok: true, dir: cloudStagingDir() });
      }
      case 'restore': {
        const name = str('name');
        const file = stagedArchivePath(name);
        if (!file || !name) return NextResponse.json({ error: 'The downloaded backup was not found.' }, { status: 400 });
        const secret = str('secret');
        if (secret !== undefined && secret.length > 200) return NextResponse.json({ error: 'Invalid password.' }, { status: 400 });
        try {
          const result = await restoreArchiveFile(file, name, secret || undefined, 'cloud backup');
          clearCloudStaging();
          revalidatePath('/', 'layout');
          return NextResponse.json({ ok: true, ...result });
        } catch (err) {
          // Keep the download while a password is still needed, so it isn't fetched twice.
          if (!(err instanceof ActionError && err.code === 'SECRET_REQUIRED')) clearCloudStaging();
          throw err;
        }
      }
      default:
        return NextResponse.json({ error: 'Unknown action.' }, { status: 400 });
    }
  } catch (err) {
    if (err instanceof ActionError) return NextResponse.json({ error: err.message, code: err.code }, { status: 422 });
    const message = err instanceof Error ? err.message : 'The cloud backup request failed.';
    console.error('[cloud-backup]', err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
