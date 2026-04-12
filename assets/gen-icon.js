// Generates a minimal valid .ico file (16x16 + 32x32 + 48x48, warm amber clipboard icon)
// Run once: node assets/gen-icon.js
const fs = require('fs');
const path = require('path');

// ── Draw a tiny clipboard icon into a raw RGBA buffer ─────────────────────────
function drawIcon(size) {
  const buf = Buffer.alloc(size * size * 4, 0); // RGBA, fully transparent

  const set = (x, y, r, g, b, a = 255) => {
    if (x < 0 || y < 0 || x >= size || y >= size) return;
    const i = (y * size + x) * 4;
    buf[i] = r; buf[i+1] = g; buf[i+2] = b; buf[i+3] = a;
  };

  const fill = (x1, y1, x2, y2, r, g, b, a = 255) => {
    for (let y = y1; y <= y2; y++)
      for (let x = x1; x <= x2; x++)
        set(x, y, r, g, b, a);
  };

  const s = size / 16; // scale factor

  // Body of clipboard (warm dark brown)
  fill(Math.round(2*s), Math.round(3*s), Math.round(13*s), Math.round(14*s), 50, 36, 24);

  // Body outline (amber)
  for (let x = Math.round(2*s); x <= Math.round(13*s); x++) {
    set(x, Math.round(3*s),  200, 149, 108);
    set(x, Math.round(14*s), 200, 149, 108);
  }
  for (let y = Math.round(3*s); y <= Math.round(14*s); y++) {
    set(Math.round(2*s),  y, 200, 149, 108);
    set(Math.round(13*s), y, 200, 149, 108);
  }

  // Clip at top (amber)
  fill(Math.round(5*s), Math.round(1*s), Math.round(10*s), Math.round(4*s), 200, 149, 108);
  fill(Math.round(6*s), Math.round(2*s), Math.round(9*s),  Math.round(3*s), 50, 36, 24);

  // Lines on paper (light)
  const lineY = [6, 8, 10, 12];
  lineY.forEach(ly => {
    fill(Math.round(4*s), Math.round(ly*s), Math.round(11*s), Math.round(ly*s), 200, 149, 108, 180);
  });

  return buf;
}

// ── Build .ico file ───────────────────────────────────────────────────────────
function buildIco(sizes) {
  const images = sizes.map(size => {
    const rgba = drawIcon(size);
    // Convert RGBA → BGRA (BMP format)
    const bmp = Buffer.from(rgba);
    for (let i = 0; i < bmp.length; i += 4) {
      [bmp[i], bmp[i+2]] = [bmp[i+2], bmp[i]]; // swap R and B
    }

    // DIB header (BITMAPINFOHEADER) — 40 bytes
    const header = Buffer.alloc(40);
    header.writeUInt32LE(40, 0);           // header size
    header.writeInt32LE(size, 4);          // width
    header.writeInt32LE(size * 2, 8);      // height * 2 (XOR + AND mask)
    header.writeUInt16LE(1, 12);           // color planes
    header.writeUInt16LE(32, 14);          // bits per pixel
    header.writeUInt32LE(0, 16);           // compression (none)
    header.writeUInt32LE(bmp.length, 20);  // image size

    // AND mask — all zeros (fully opaque alpha channel handles transparency)
    const andMask = Buffer.alloc(Math.ceil(size * size / 8));

    return Buffer.concat([header, bmp, andMask]);
  });

  // ICO header: 6 bytes
  const icoHeader = Buffer.alloc(6);
  icoHeader.writeUInt16LE(0, 0);  // reserved
  icoHeader.writeUInt16LE(1, 2);  // type: 1 = ICO
  icoHeader.writeUInt16LE(sizes.length, 4);

  // Directory entries: 16 bytes each
  let dataOffset = 6 + sizes.length * 16;
  const dir = Buffer.concat(sizes.map((size, i) => {
    const entry = Buffer.alloc(16);
    entry.writeUInt8(size === 256 ? 0 : size, 0); // width (0 = 256)
    entry.writeUInt8(size === 256 ? 0 : size, 1); // height
    entry.writeUInt8(0, 2);   // color count
    entry.writeUInt8(0, 3);   // reserved
    entry.writeUInt16LE(1, 4); // color planes
    entry.writeUInt16LE(32, 6); // bit count
    entry.writeUInt32LE(images[i].length, 8);  // size
    entry.writeUInt32LE(dataOffset, 12);        // offset
    dataOffset += images[i].length;
    return entry;
  }));

  return Buffer.concat([icoHeader, dir, ...images]);
}

const ico = buildIco([16, 32, 48, 256]);
const outPath = path.join(__dirname, 'icon.ico');
fs.writeFileSync(outPath, ico);
console.log('Icon written to', outPath, '—', ico.length, 'bytes');
