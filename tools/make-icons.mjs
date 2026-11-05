/**
 * Draws the app icons as PNGs without any dependency: the Questline mark (a honey hexagon with a check, as in
 * icons/favicon.svg) on a warm dark ground, rasterised with 4 × 4 supersampling and written by a minimal PNG encoder.
 * Run with `npm run icons`.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const GROUND = [0x24, 0x1f, 0x19];
const HONEY = [0xf0, 0xa9, 0x3a];
const INK = [0x2b, 0x1a, 0x03];
const SAMPLES = 4;

/* ───────── PNG ───────── */

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(bytes) {
  let c = 0xffffffff;
  for (const byte of bytes) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

function encodePng(size, rgba) {
  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y += 1) rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/* ───────── Shapes, in pixels ───────── */

const hexagon = (cx, cy, r) => [-90, -30, 30, 90, 150, 210].map((deg) => [cx + r * Math.cos((deg * Math.PI) / 180), cy + r * Math.sin((deg * Math.PI) / 180)]);

function distanceToSegment([px, py], [ax, ay], [bx, by]) {
  const dx = bx - ax;
  const dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function insideConvex([px, py], polygon) {
  let sign = 0;
  for (let i = 0; i < polygon.length; i += 1) {
    const [ax, ay] = polygon[i];
    const [bx, by] = polygon[(i + 1) % polygon.length];
    const cross = (bx - ax) * (py - ay) - (by - ay) * (px - ax);
    if (cross !== 0) {
      if (sign === 0) sign = Math.sign(cross);
      else if (Math.sign(cross) !== sign) return false;
    }
  }
  return true;
}

/** A hexagon with round corners: the core polygon grown by `rounding` (like the SVG's round stroke joins). */
function roundedHexagon(cx, cy, r, rounding) {
  const core = hexagon(cx, cy, r - rounding);
  return (p) => insideConvex(p, core) || core.some((a, i) => distanceToSegment(p, a, core[(i + 1) % core.length]) <= rounding);
}

/** The check of the favicon (M34 56 l11 11 22-24, stroke 9) relative to its hexagon (centre 50,54, radius 46). */
function checkMark(cx, cy, r) {
  const point = (x, y) => [cx + ((x - 50) / 46) * r, cy + ((y - 54) / 46) * r];
  const [a, b, c] = [point(34, 56), point(45, 67), point(67, 43)];
  const half = (4.5 / 46) * r;
  return (p) => distanceToSegment(p, a, b) <= half || distanceToSegment(p, b, c) <= half;
}

function roundedSquare(size, radius) {
  return ([x, y]) => {
    const nx = Math.min(Math.max(x, radius), size - radius);
    const ny = Math.min(Math.max(y, radius), size - radius);
    return Math.hypot(x - nx, y - ny) <= radius;
  };
}

/* ───────── Icons ───────── */

/** `ground`: 'full' (opaque square; iOS and maskable icons) or 'rounded' (transparent corners). */
function drawIcon(size, { mark, ground }) {
  const r = size * mark;
  const centre = size / 2;
  const layers = [
    [GROUND, ground === 'full' ? () => true : roundedSquare(size, size * 0.22)],
    [HONEY, roundedHexagon(centre, centre, r, r * 0.11)],
    [INK, checkMark(centre, centre, r)],
  ];
  const rgba = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let [red, green, blue, alpha] = [0, 0, 0, 0];
      for (const [colour, inside] of layers) {
        let hits = 0;
        for (let sy = 0; sy < SAMPLES; sy += 1) {
          for (let sx = 0; sx < SAMPLES; sx += 1) if (inside([x + (sx + 0.5) / SAMPLES, y + (sy + 0.5) / SAMPLES])) hits += 1;
        }
        const cover = hits / SAMPLES ** 2;
        // Premultiplied "over" compositing of each layer's coverage.
        red = colour[0] * cover + red * (1 - cover);
        green = colour[1] * cover + green * (1 - cover);
        blue = colour[2] * cover + blue * (1 - cover);
        alpha = cover + alpha * (1 - cover);
      }
      const offset = (y * size + x) * 4;
      if (alpha > 0) {
        rgba[offset] = Math.round(red / alpha);
        rgba[offset + 1] = Math.round(green / alpha);
        rgba[offset + 2] = Math.round(blue / alpha);
        rgba[offset + 3] = Math.round(alpha * 255);
      }
    }
  }
  return encodePng(size, rgba);
}

const ICONS = [
  ['icons/apple-touch-icon.png', 180, { mark: 0.33, ground: 'full' }],
  ['icons/icon-192.png', 192, { mark: 0.3, ground: 'rounded' }],
  ['icons/icon-512.png', 512, { mark: 0.3, ground: 'rounded' }],
  // Maskable: the mark stays inside the safe circle (40 % of the size) whatever shape the launcher cuts.
  ['icons/icon-maskable-512.png', 512, { mark: 0.26, ground: 'full' }],
];

const root = new URL('../', import.meta.url);
mkdirSync(new URL('icons/', root), { recursive: true });
for (const [path, size, options] of ICONS) {
  writeFileSync(new URL(path, root), drawIcon(size, options));
  process.stdout.write(`${path} (${size} × ${size})\n`);
}
