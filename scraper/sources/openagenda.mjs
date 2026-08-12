// Source : mirroir public (ODbL) des événements OpenAgenda hébergé par
// Opendatasoft. Accès anonyme, sans clé API ni compte à créer.
// https://public.opendatasoft.com/explore/dataset/evenements-publics-openagenda/
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ALL_DEPARTMENTS, zoneForDepartment } from '../lib/zones.mjs';
import { classify, isExcluded } from '../lib/classify.mjs';
import { parsePrice } from '../lib/price.mjs';
import { centroidForPostalCode } from '../lib/geocode.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_FILE = path.join(__dirname, '..', '.cache', 'openagenda.json');

const API_BASE = 'https://public.opendatasoft.com/api/explore/v2.1/catalog/datasets/evenements-publics-openagenda/records';
const PAGE_SIZE = 100;
// Pas de quota total : un arrêt anticipé dès qu'assez d'"événements"
// génériques sont trouvés empêchait le scan d'aller assez loin pour
// dénicher les rares mentions de pop-up. On va au bout du budget de pages.
const MAX_PAGES = 60;

function buildWhereClause() {
  const inList = ALL_DEPARTMENTS.map((d) => JSON.stringify(d)).join(',');
  const today = new Date().toISOString().slice(0, 10);
  return `location_department in (${inList}) and firstdate_begin >= date'${today}'`;
}

async function fetchPage(offset) {
  const url = new URL(API_BASE);
  url.searchParams.set('limit', String(PAGE_SIZE));
  url.searchParams.set('offset', String(offset));
  url.searchParams.set('order_by', 'updatedat desc');
  url.searchParams.set('where', buildWhereClause());

  const res = await fetch(url, { headers: { 'User-Agent': 'sortir-paris-mvp/0.1 (usage personnel)' } });
  if (!res.ok) throw new Error(`OpenAgenda API HTTP ${res.status}`);
  return res.json();
}

function toEventItem(record) {
  const zone = zoneForDepartment(record.location_department);
  if (!zone) return null;

  const searchableText = [record.title_fr, record.description_fr, record.keywords_fr?.join(' ')]
    .filter(Boolean)
    .join(' ');
  if (isExcluded(searchableText)) return null;
  const category = classify(searchableText);
  if (!category) return null;

  // Théâtre / stand-up / concert viennent désormais de Billetreduc (billetterie
  // dédiée, meilleures données). OpenAgenda ne sert plus que pour les concepts
  // éphémères et les événements génériques, qu'il couvre mieux.
  if (category === 'theatre' || category === 'standup' || category === 'concert') return null;

  // Une vignette sans photo n'a pas d'intérêt : on écarte l'événement plutôt
  // que d'afficher un visuel générique.
  const imageUrl = record.image || record.thumbnail || null;
  if (!imageUrl) return null;

  const { price, priceLabel } = parsePrice(record.conditions_fr);

  const coords = record.location_coordinates ?? centroidForPostalCode(record.location_postalcode);
  if (!coords) return null; // pas de position exploitable pour la carte

  return {
    id: `openagenda:${record.uid}`,
    title: record.title_fr ?? 'Sans titre',
    category,
    venue: record.location_name || record.location_city || 'Lieu à confirmer',
    address: record.location_address ?? undefined,
    zone,
    lat: coords.lat,
    lng: coords.lng ?? coords.lon,
    price,
    priceLabel,
    dateStart: record.firstdate_begin,
    dateEnd: record.lastdate_end ?? record.firstdate_end ?? undefined,
    description: record.description_fr ? record.description_fr.slice(0, 400) : undefined,
    imageUrl,
    sourceUrl: record.canonicalurl || record.location_website || 'https://openagenda.com',
    sourceName: 'OpenAgenda',
    fetchedAt: new Date().toISOString(),
    isNew: false, // recalculé plus bas par diff avec le run précédent
    verified: category === 'ephemere',
    verifiedVia: category === 'ephemere' ? 'OpenAgenda (données publiques)' : undefined,
    highlighted: false,
    tags: [],
  };
}

async function main() {
  const byId = new Map();
  let offset = 0;
  let page = 0;
  let totalCount = Infinity;

  while (page < MAX_PAGES && offset < totalCount) {
    const data = await fetchPage(offset);
    totalCount = data.total_count;
    for (const record of data.results ?? []) {
      const item = toEventItem(record);
      if (item) byId.set(item.id, item);
    }
    offset += PAGE_SIZE;
    page += 1;
  }

  const events = [...byId.values()].sort((a, b) => a.dateStart.localeCompare(b.dateStart));

  await mkdir(path.dirname(OUT_FILE), { recursive: true });
  await writeFile(OUT_FILE, JSON.stringify({ source: 'OpenAgenda', events }, null, 2));

  const counts = events.reduce((acc, e) => {
    acc[e.category] = (acc[e.category] ?? 0) + 1;
    return acc;
  }, {});
  console.log(`OpenAgenda: ${events.length} événements retenus sur ${page} page(s) scannée(s) (${offset} enregistrements vus).`);
  console.log('Par catégorie:', counts);
  console.log(`Écrit dans ${OUT_FILE}`);
}

main().catch((err) => {
  console.error('Échec du connecteur OpenAgenda:', err);
  process.exitCode = 1;
});
