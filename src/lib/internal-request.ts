import 'server-only';
import crypto from 'crypto';
import { NextResponse, type NextRequest } from 'next/server';
import { verifySession } from './auth';

// Internal routes are called only by the Electron main process. They require:
//  1. the per-launch secret the main process passes to the server at start-up
//     (so browsers elsewhere on the LAN can never call them), and
//  2. unless `sessionOptional`, a signed-in admin session, forwarded from the
//     app window's cookies (so someone at the host computer who opens DevTools
//     on the sign-in page still can't change backup security).

export async function authorizeInternal(request: NextRequest, options: { sessionOptional?: boolean } = {}): Promise<NextResponse | null> {
  const expected = process.env.CHUTI_INTERNAL_TOKEN;
  const given = request.headers.get('x-chuti-internal') ?? '';
  if (!expected || given.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(given), Buffer.from(expected))) {
    return new NextResponse('Not Found', { status: 404 });
  }
  if (!options.sessionOptional) {
    const session = await verifySession();
    if (!session) return NextResponse.json({ error: 'Sign in to Chuti first.' }, { status: 401 });
    if (session.mustChangePassword) return NextResponse.json({ error: 'Set a new admin password first.' }, { status: 403 });
  }
  return null;
}

export async function readJson(request: NextRequest): Promise<Record<string, unknown> | null> {
  try {
    const body = await request.json();
    return body && typeof body === 'object' ? (body as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}
