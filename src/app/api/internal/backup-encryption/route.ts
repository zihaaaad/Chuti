import { NextRequest, NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { authorizeInternal, readJson } from '@/lib/internal-request';
import {
  BackupKeyError,
  changeBackupPassword,
  disableEncryption,
  enableEncryption,
  loadStoredKey,
  unlockEncryption,
} from '@/lib/backup-keys';

// Backup encryption management, reachable only from the desktop app (see
// authorizeInternal). Keys cross this route only between the local server and
// the Electron main process, which stores them with Windows DPAPI.
//
//   load     { keyId, key }              → re-arm the key after a restart (no session needed)
//   enable   { password }                → { keyId, key, recoveryCode }
//   change   { current, password }       → { keyId, key }
//   unlock   { secret }                  → { keyId, key }
//   disable  {}                          → {}
export async function POST(request: NextRequest) {
  const body = await readJson(request);
  const action = typeof body?.action === 'string' ? body.action : '';

  const denied = await authorizeInternal(request, { sessionOptional: action === 'load' });
  if (denied) return denied;

  const str = (k: string) => (typeof body?.[k] === 'string' ? (body[k] as string) : '');
  const keyOut = (r: { keyId: string; key: Buffer }) => ({ keyId: r.keyId, key: r.key.toString('base64') });

  try {
    switch (action) {
      case 'load': {
        const key = Buffer.from(str('key'), 'base64');
        return NextResponse.json({ ok: await loadStoredKey(str('keyId'), key) });
      }
      case 'enable': {
        const result = await enableEncryption(str('password'));
        revalidatePath('/', 'layout');
        return NextResponse.json({ ok: true, ...keyOut(result), recoveryCode: result.recoveryCode });
      }
      case 'change': {
        const result = await changeBackupPassword(str('current'), str('password'));
        revalidatePath('/', 'layout');
        return NextResponse.json({ ok: true, ...keyOut(result) });
      }
      case 'unlock': {
        const result = await unlockEncryption(str('secret'));
        revalidatePath('/', 'layout');
        return NextResponse.json({ ok: true, ...keyOut(result) });
      }
      case 'disable': {
        await disableEncryption();
        revalidatePath('/', 'layout');
        return NextResponse.json({ ok: true });
      }
      default:
        return NextResponse.json({ error: 'Unknown action.' }, { status: 400 });
    }
  } catch (err) {
    if (err instanceof BackupKeyError) return NextResponse.json({ error: err.message }, { status: 422 });
    console.error('[backup-encryption]', err);
    return NextResponse.json({ error: 'The backup protection could not be changed.' }, { status: 500 });
  }
}
