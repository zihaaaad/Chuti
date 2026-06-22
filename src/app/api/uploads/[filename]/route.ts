import { NextRequest, NextResponse } from 'next/server';
import path from 'path';
import fs from 'fs';

// This API route serves uploaded files from the user-selected APP_DATA_DIR.
// It replaces the old approach of storing files in /public/uploads, which
// would be read-only in a packaged Electron installation.
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ filename: string }> }
) {
  const { filename } = await params;

  // Sanitize filename to prevent directory traversal attacks
  const safeName = path.basename(filename);
  if (!safeName || safeName !== filename) {
    return new NextResponse('Bad Request', { status: 400 });
  }

  // Resolve the uploads directory from the environment variable or fall back to cwd
  const dataDir = process.env.APP_DATA_DIR || process.cwd();
  const uploadsDir = process.env.APP_DATA_DIR
    ? path.join(dataDir, 'uploads')
    : path.join(dataDir, 'public', 'uploads');

  const filePath = path.join(uploadsDir, safeName);

  // Verify the resolved path is still inside the uploads directory (belt-and-suspenders check)
  if (!filePath.startsWith(uploadsDir)) {
    return new NextResponse('Forbidden', { status: 403 });
  }

  if (!fs.existsSync(filePath)) {
    return new NextResponse('Not Found', { status: 404 });
  }

  try {
    const fileBuffer = await fs.promises.readFile(filePath);
    const ext = path.extname(safeName).toLowerCase();

    const mimeTypes: Record<string, string> = {
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.png': 'image/png',
      '.gif': 'image/gif',
      '.webp': 'image/webp',
      '.pdf': 'application/pdf',
      '.doc': 'application/msword',
      '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    };

    const contentType = mimeTypes[ext] || 'application/octet-stream';

    return new NextResponse(fileBuffer, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Content-Length': String(fileBuffer.length),
        // Allow inline display for images/pdf, force download for others
        'Content-Disposition': contentType.startsWith('image/') || contentType === 'application/pdf'
          ? `inline; filename="${safeName}"`
          : `attachment; filename="${safeName}"`,
        // Cache for 1 hour — files are immutable once uploaded
        'Cache-Control': 'public, max-age=3600',
      },
    });
  } catch (err) {
    console.error('Failed to serve upload:', err);
    return new NextResponse('Internal Server Error', { status: 500 });
  }
}
