/**
 * 生成托盘图标 PNG 文件（32x32 RGBA）。
 * 蓝色圆圈 + 白色内圆，简洁风格，代表 Roxy 蓝色主题。
 *
 * 运行：node scripts/generate-tray-icon.js
 * 输出：app/assets/tray-icon.png
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const size = 32;
const cx = 16, cy = 16;
const outerRadius = 14;
const innerRadius = 6;

// RGBA pixel data: each row = 1 filter byte + size*4 bytes
const stride = size * 4 + 1;
const rawData = Buffer.alloc(stride * size);

for (let y = 0; y < size; y++) {
  const rowOff = y * stride;
  rawData[rowOff] = 0; // filter: none
  for (let x = 0; x < size; x++) {
    const px = rowOff + 1 + x * 4;
    const dist = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2);

    if (dist <= innerRadius) {
      // 白色内圆
      rawData[px] = 0xFF;
      rawData[px + 1] = 0xFF;
      rawData[px + 2] = 0xFF;
      rawData[px + 3] = 0xFF;
    } else if (dist <= outerRadius) {
      // 蓝色外圈 (#4A90E2)
      rawData[px] = 0x4A;
      rawData[px + 1] = 0x90;
      rawData[px + 2] = 0xE2;
      rawData[px + 3] = 0xFF;
    } else {
      // 透明
      rawData[px + 3] = 0;
    }
  }
}

// PNG 编码
const signature = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(size, 0);
ihdr.writeUInt32BE(size, 4);
ihdr[8] = 8;  // bit depth
ihdr[9] = 6;  // color type: RGBA
ihdr[10] = 0; // compression
ihdr[11] = 0; // filter
ihdr[12] = 0; // interlace

const compressed = zlib.deflateSync(rawData);

// CRC32 查找表
const crcTable = [];
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) {
    c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
  }
  crcTable[n] = c;
}

function crc32(buf) {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) {
    crc = crcTable[(crc ^ buf[i]) & 0xFF] ^ (crc >>> 8);
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function makeChunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii');
  const lengthBuf = Buffer.alloc(4);
  lengthBuf.writeUInt32BE(data.length, 0);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([lengthBuf, typeBuf, data, crcBuf]);
}

const png = Buffer.concat([
  signature,
  makeChunk('IHDR', ihdr),
  makeChunk('IDAT', compressed),
  makeChunk('IEND', Buffer.alloc(0))
]);

const outDir = path.join(__dirname, '..', 'app', 'assets');
fs.mkdirSync(outDir, { recursive: true });
const outPath = path.join(outDir, 'tray-icon.png');
fs.writeFileSync(outPath, png);
console.log('Tray icon generated:', outPath, '(' + png.length + ' bytes)');
