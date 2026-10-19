// Generate a tiny original flower icon without runtime files or external image dependencies.
'use strict';
const zlib = require('node:zlib');
function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(kind, data) {
  const name = Buffer.from(kind);
  const size = Buffer.alloc(4); size.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([name, data])));
  return Buffer.concat([size, name, data, crc]);
}
function trayPng() {
  const pixels = Buffer.alloc(32 * (32 * 4 + 1));
  for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) {
    const dx = x - 15.5, dy = y - 15.5;
    const radius = Math.hypot(dx, dy);
    const flower = 7 + 3 * Math.cos(5 * Math.atan2(dy, dx));
    const offset = y * 129 + 1 + x * 4;
    const color = radius < 3 ? [246, 179, 214, 255] : radius < flower ? [255, 248, 255, 255] : radius < 15 ? [204, 103, 161, 255] : [0, 0, 0, 0];
    for (let c = 0; c < 4; c++) pixels[offset + c] = color[c];
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(32, 0); header.writeUInt32BE(32, 4); header[8] = 8; header[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', zlib.deflateSync(pixels)), chunk('IEND', Buffer.alloc(0))]);
}
module.exports = { trayPng };
