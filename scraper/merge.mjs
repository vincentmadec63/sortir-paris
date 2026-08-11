// Fusionne les sorties des différents connecteurs (scraper/.cache/*.json)
// en un seul public/data/events.json, en calculant les nouveautés par
// rapport au run précédent.
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = path.join(__dirname, '.cache');
const OUT_FILE = path.join(__dirname, '..', 'public', 'data', 'events.json');

async function loadPreviousIds() {
  try {
    const raw = await readFile(OUT_FILE, 'utf-8');
    const prev = JSON.parse(raw);
    return new Set((prev.events ?? []).map((e) => e.id));
  } catch {
    return new Set();
  }
}

async function main() {
  let files;
  try {
    files = (await readdir(CACHE_DIR)).filter((f) => f.endsWith('.json'));
  } catch {
    throw new Error(`Aucun cache trouvé dans ${CACHE_DIR} — lance d'abord les connecteurs (npm run fetch:*).`);
  }
  if (files.length === 0) {
    throw new Error(`${CACHE_DIR} est vide — lance d'abord les connecteurs (npm run fetch:*).`);
  }

  const byId = new Map();
  const sources = new Set();
  for (const file of files) {
    const raw = JSON.parse(await readFile(path.join(CACHE_DIR, file), 'utf-8'));
    sources.add(raw.source);
    for (const event of raw.events ?? []) byId.set(event.id, event);
  }

  const previousIds = await loadPreviousIds();
  const events = [...byId.values()]
    .map((e) => ({ ...e, isNew: !previousIds.has(e.id) }))
    .sort((a, b) => a.dateStart.localeCompare(b.dateStart));

  await mkdir(path.dirname(OUT_FILE), { recursive: true });
  await writeFile(
    OUT_FILE,
    JSON.stringify({ generatedAt: new Date().toISOString(), sources: [...sources], events }, null, 2)
  );

  const bySource = events.reduce((acc, e) => {
    acc[e.sourceName] = (acc[e.sourceName] ?? 0) + 1;
    return acc;
  }, {});
  console.log(`Fusion: ${events.length} événements au total.`);
  console.log('Par source:', bySource);
  console.log(`Écrit dans ${OUT_FILE}`);
}

main().catch((err) => {
  console.error('Échec de la fusion:', err);
  process.exitCode = 1;
});
