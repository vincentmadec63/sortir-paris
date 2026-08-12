// Fusionne les sorties des différents connecteurs (scraper/.cache/*.json)
// en un seul public/data/events.json, en calculant les nouveautés par
// rapport au run précédent.
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = path.join(__dirname, '.cache');
const OUT_FILE = path.join(__dirname, '..', 'public', 'data', 'events.json');

function normalize(text) {
  return (text ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

// Même titre normalisé = même spectacle, quelle que soit la billetterie qui
// le liste (le lieu et la date de la prochaine séance affichée peuvent
// varier légèrement d'une source à l'autre, donc on ne s'appuie que sur le
// titre — l'utilisateur préfère explicitement zéro doublon à une dédup plus
// prudente mais imparfaite).
function dedupeKey(event) {
  return normalize(event.title);
}

// Score pour choisir quelle fiche garder en cas de doublon : celle qui a le
// plus d'informations utiles (avis, prix connu, description).
function richness(event) {
  let score = 0;
  if (event.rating) score += 4;
  if (event.price !== null && event.price !== undefined) score += 2;
  if (event.description) score += 1;
  if (event.highlighted) score += 1;
  return score;
}

function dedupeEvents(events) {
  const byKey = new Map();
  for (const event of events) {
    const key = dedupeKey(event);
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, event);
      continue;
    }
    // Le "coup de cœur" est un signal éditorial propre à sa source — s'il
    // n'apparaît que sur le doublon écarté, on le reporte quand même sur la
    // fiche gardée plutôt que de le perdre silencieusement.
    const winner = richness(event) > richness(existing) ? event : existing;
    const loser = winner === event ? existing : event;
    if (loser.highlighted && !winner.highlighted) {
      winner.highlighted = true;
      winner.highlightedVia = loser.highlightedVia;
    }
    byKey.set(key, winner);
  }
  return [...byKey.values()];
}

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

  const deduped = dedupeEvents([...byId.values()]);
  const previousIds = await loadPreviousIds();
  const events = deduped
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
  console.log(`Fusion: ${byId.size} événements collectés, ${byId.size - deduped.length} doublons retirés, ${events.length} au total.`);
  console.log('Par source:', bySource);
  console.log(`Écrit dans ${OUT_FILE}`);
}

main().catch((err) => {
  console.error('Échec de la fusion:', err);
  process.exitCode = 1;
});
