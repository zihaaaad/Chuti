import { NextRequest, NextResponse } from 'next/server';
import path from 'path';
import fs from 'fs';
import { verifySession } from '@/lib/auth';
import { ATTACHMENT_TYPES, uploadsDir } from '@/lib/attachments';

// Serves leave attachments (sick notes, application scans) from the data
// folder. They are personal documents: admin session required, never cached
// by shared caches, and never sniffed into a different content type.
export async function GET(request: NextRequest, { params }: { params: Promise<{ filename: string }> }) {
  if (!(await verifySession())) {
    return new NextResponse('Unauthorized', { status: 401 });
  }

  const { filename } = await params;
  const safeName = path.basename(filename);
  if (!safeName || safeName !== filename || safeName.startsWith('.')) {
    return new NextResponse('Bad Request', { status: 400 });
  }

  const dir = uploadsDir();
  const filePath = path.join(dir, safeName);
  if (!filePath.startsWith(dir + path.sep)) {
    return new NextResponse('Forbidden', { status: 403 });
  }

  const contentType = ATTACHMENT_TYPES[path.extname(safeName).toLowerCase()];
  if (!contentType) {
    return new NextResponse('Not Found', { status: 404 });
  }

  let fileBuffer: Buffer;
  try {
    fileBuffer = await fs.promises.readFile(filePath);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return new NextResponse('Not Found', { status: 404 });
    console.error('Failed to serve upload:', err);
    return new NextResponse('Internal Server Error', { status: 500 });
  }

  const inline = contentType.startsWith('image/') || contentType === 'application/pdf';
  const download = request.nextUrl.searchParams.get('download') === '1';
  return new NextResponse(new Uint8Array(fileBuffer), {
    status: 200,
    headers: {
      'Content-Type': contentType,
      'Content-Length': String(fileBuffer.length),
      'Content-Disposition': `${inline && !download ? 'inline' : 'attachment'}; filename="${safeName}"`,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
