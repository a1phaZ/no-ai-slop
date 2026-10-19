import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = resolve(root, 'src/icons');

const CRC_TABLE = new Int32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  CRC_TABLE[n] = c;
}

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const out = Buffer.alloc(data.length + 12);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

/** Минимальный PNG-энкодер: 8-bit RGBA, без интерлейса. */
function encodePng(width, height, rgba) {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type: RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const BG = [31, 41, 55, 255];
const SHIELD = [249, 250, 251, 255];
const SLASH = [239, 68, 68, 255];
const TRANSPARENT = [0, 0, 0, 0];
const SS = 4; // supersampling для сглаживания

function inRoundedRect(x, y, r) {
  const rx = Math.min(Math.max(x, r), 1 - r);
  const ry = Math.min(Math.max(y, r), 1 - r);
  const dx = x - rx;
  const dy = y - ry;
  return dx * dx + dy * dy <= r * r;
}

function inShield(x, y) {
  const cx = 0.5;
  const half = 0.235;
  const top = 0.185;
  const bottom = 0.83;
  const shoulder = 0.52;
  const r = 0.085;
  if (y < top || y > bottom) return false;
  const nx = Math.abs(x - cx);
  const hw = y <= shoulder ? half : (half * (bottom - y)) / (bottom - shoulder);
  if (y < top + r && nx > half - r) {
    const dx = nx - (half - r);
    const dy = top + r - y;
    if (dx * dx + dy * dy > r * r) return false;
  }
  return nx <= hw;
}

function distToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function sample(x, y) {
  if (!inRoundedRect(x, y, 0.22)) return TRANSPARENT;
  if (distToSegment(x, y, 0.18, 0.82, 0.82, 0.18) < 0.075) return SLASH;
  if (inShield(x, y)) return SHIELD;
  return BG;
}

function render(size) {
  const big = size * SS;
  const out = Buffer.alloc(size * size * 4);
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let sr = 0;
      let sg = 0;
      let sb = 0;
      let sa = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const x = (px * SS + sx + 0.5) / big;
          const y = (py * SS + sy + 0.5) / big;
          const [r, g, b, a] = sample(x, y);
          sr += r * a;
          sg += g * a;
          sb += b * a;
          sa += a;
        }
      }
      const i = (py * size + px) * 4;
      if (sa > 0) {
        out[i] = Math.round(sr / sa);
        out[i + 1] = Math.round(sg / sa);
        out[i + 2] = Math.round(sb / sa);
        out[i + 3] = Math.round(sa / (SS * SS));
      }
    }
  }
  return encodePng(size, size, out);
}

const SIZES = [16, 32, 48, 128];

await mkdir(outDir, { recursive: true });
for (const size of SIZES) {
  const png = render(size);
  const file = resolve(outDir, `icon-${size}.png`);
  await writeFile(file, png);
  console.log(`icon -> src/icons/icon-${size}.png (${png.length} B)`);
}
