import { NextRequest, NextResponse } from 'next/server';
import { setBackupCopyFolder } from '@/lib/backup-copies';
import { authorizeInternal, readJson } from '@/lib/internal-request';

// Called only by the Electron main process after the admin picks a folder in a
// native dialog on the host computer (see authorizeInternal for why a LAN
// browser, even one signed in as admin, cannot choose where copies go).
export async function POST(request: NextRequest) {
  const denied = await authorizeInternal(request);
  if (denied) return denied;

  const body = await readJson(request);
  const folder = body?.folder;
  if (!body || (folder !== null && (typeof folder !== 'string' || folder.length > 1024))) {
    return NextResponse.json({ error: 'Invalid folder.' }, { status: 400 });
  }

  const problem = await setBackupCopyFolder(folder as string | null);
  return problem ? NextResponse.json({ error: problem }, { status: 422 }) : NextResponse.json({ ok: true });
}
