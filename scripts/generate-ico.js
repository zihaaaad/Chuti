/**
 * generate-ico.js
 * Converts public/icon.png into a valid public/icon.ico file
 * by constructing a proper ICO binary (256×256 embedded PNG format).
 *
 * ICO format with embedded PNG (Vista+ style):
 *   - 6-byte ICONDIR header
 *   - 16-byte ICONDIRENTRY per image
 *   - raw PNG bytes appended
 *
 * No external dependencies needed — pure Node.js.
 */

const fs = require('fs');
const path = require('path');

const PNG_PATH = path.join(__dirname, 'public', 'icon.png');
const ICO_PATH = path.join(__dirname, 'public', 'icon.ico');

if (!fs.existsSync(PNG_PATH)) {
  console.error('ERROR: public/icon.png not found. Cannot generate ICO.');
  process.exit(1);
}

const pngData = fs.readFileSync(PNG_PATH);

// ── Build ICO binary with 1 image entry (256×256 embedded PNG) ──────────────
//
// ICONDIR (6 bytes):
//   WORD  idReserved  = 0
//   WORD  idType      = 1  (ICO)
//   WORD  idCount     = 1  (number of images)
const icondir = Buffer.alloc(6);
icondir.writeUInt16LE(0, 0);   // reserved
icondir.writeUInt16LE(1, 2);   // type = 1 (icon)
icondir.writeUInt16LE(1, 4);   // count = 1 image

// ICONDIRENTRY (16 bytes):
//   BYTE  bWidth        width  (0 = 256)
//   BYTE  bHeight       height (0 = 256)
//   BYTE  bColorCount   0 (no palette)
//   BYTE  bReserved     0
//   WORD  wPlanes       1
//   WORD  wBitCount     32 (RGBA)
//   DWORD dwBytesInRes  size of PNG data
//   DWORD dwImageOffset offset from start of file to image data = 6 + 16 = 22
const entry = Buffer.alloc(16);
entry.writeUInt8(0, 0);                       // width  (0 = 256)
entry.writeUInt8(0, 1);                       // height (0 = 256)
entry.writeUInt8(0, 2);                       // color count
entry.writeUInt8(0, 3);                       // reserved
entry.writeUInt16LE(1, 4);                    // planes
entry.writeUInt16LE(32, 6);                   // bit count
entry.writeUInt32LE(pngData.length, 8);       // size of PNG data
entry.writeUInt32LE(22, 12);                  // offset to image data (6 + 16)

const ico = Buffer.concat([icondir, entry, pngData]);
fs.writeFileSync(ICO_PATH, ico);

console.log(`✅ Generated ${ICO_PATH} (${ico.length} bytes) from ${PNG_PATH} (${pngData.length} bytes)`);
