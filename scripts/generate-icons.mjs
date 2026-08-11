import sharp from 'sharp';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(__dirname, '..', 'public', 'icons');

const BG = '#15121C';
const AMBER = '#DCA84F';

function starPath(cx, scale) {
  const pts = [
    [12, 2], [14.9, 8.6], [22, 9.6], [16.5, 14.5],
    [18, 22], [12, 18], [6, 22], [7.5, 14.5], [2, 9.6], [9.1, 8.6],
  ];
  const s = scale / 24;
  const d = pts.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${(cx + (x - 12) * s).toFixed(2)},${(cx + (y - 12) * s).toFixed(2)}`).join(' ') + 'Z';
  return d;
}

function icon(size, starScale) {
  const cx = size / 2;
  return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg">
    <rect width="${size}" height="${size}" fill="${BG}"/>
    <path d="${starPath(cx, starScale)}" fill="${AMBER}"/>
  </svg>`;
}

await mkdir(outDir, { recursive: true });

const targets = [
  { name: 'icon-192.png', size: 192, starScale: 108 },
  { name: 'icon-512.png', size: 512, starScale: 288 },
  { name: 'icon-maskable-512.png', size: 512, starScale: 200 },
];

for (const t of targets) {
  const svg = icon(t.size, t.starScale);
  const buf = await sharp(Buffer.from(svg)).png().toBuffer();
  await writeFile(path.join(outDir, t.name), buf);
  console.log('wrote', t.name);
}
