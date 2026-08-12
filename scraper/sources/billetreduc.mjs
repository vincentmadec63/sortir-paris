// Source : billetreduc.com — pages de catégorie publiques (autorisées par
// robots.txt : seules les URLs avec certains paramètres de filtre/recherche
// sont interdites, pas les pages de catégorie ni /humour?page=N ni les
// fiches /spectacle/*). Données lues depuis le JSON-LD intégré dans chaque
// page (schema.org Event), prévu par le site pour être repris par des tiers.
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchText, sleep, mapLimit } from '../lib/http.mjs';
import { extractJsonLd, findByType } from '../lib/jsonld.mjs';
import { zoneForPostalCode } from '../lib/zones.mjs';
import { centroidForPostalCode } from '../lib/geocode.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_FILE = path.join(__dirname, '..', '.cache', 'billetreduc.json');

const BASE = 'https://www.billetreduc.com';
const CATEGORY_PAGES = [
  { slug: 'theatre', category: 'theatre' },
  { slug: 'humour', category: 'standup' },
  { slug: 'comedy-clubs', category: 'standup' },
  { slug: 'concerts', category: 'concert' },
];
const MAX_PAGES_PER_CATEGORY = 8; // ~160 fiches/catégorie max, pour rester raisonnable et courtois
const PAGE_DELAY_MS = 300;
const DETAIL_CONCURRENCY = 5;

async function listCategoryPage(slug, page) {
  const url = page === 1 ? `${BASE}/${slug}` : `${BASE}/${slug}?page=${page}`;
  const html = await fetchText(url);
  const blocks = extractJsonLd(html);
  const itemList = findByType(blocks, 'ItemList');
  return (itemList?.itemListElement ?? []).map((it) => ({ url: it.url, name: it.name }));
}

async function collectListingUrls() {
  const bySlug = new Map(); // url -> category (premier match gagne)
  for (const { slug, category } of CATEGORY_PAGES) {
    let page = 1;
    let total = 0;
    while (page <= MAX_PAGES_PER_CATEGORY) {
      const items = await listCategoryPage(slug, page);
      if (items.length === 0) break;
      for (const it of items) {
        if (!bySlug.has(it.url)) bySlug.set(it.url, category);
      }
      total += items.length;
      page += 1;
      await sleep(PAGE_DELAY_MS);
    }
    console.log(`  ${slug}: ${total} fiches listées sur ${page - 1} page(s)`);
  }
  return bySlug;
}

function extractId(url) {
  const seg = url.replace(/\/+$/, '').split('/').pop();
  return seg || url;
}

function priceFromOffers(offers) {
  const list = Array.isArray(offers) ? offers : offers ? [offers] : [];
  const prices = list.map((o) => Number(o.price)).filter((p) => Number.isFinite(p));
  if (prices.length === 0) return { price: null, priceLabel: 'Tarif à vérifier' };
  const min = Math.min(...prices);
  const prefix = prices.length > 1 && min !== Math.max(...prices) ? 'à partir de ' : '';
  return { price: min, priceLabel: `${prefix}${min}€` };
}

async function fetchEventDetail(url, category) {
  const html = await fetchText(url);
  const blocks = extractJsonLd(html);
  const ev = findByType(blocks, 'Event');
  if (!ev) return null;

  const postalCode = ev.location?.address?.postalCode;
  const zone = zoneForPostalCode(postalCode);
  if (!zone) return null;
  // Le stand-up est explicitement demandé "à Paris" uniquement.
  if (category === 'standup' && zone !== 'paris') return null;

  const imageUrl = Array.isArray(ev.image) ? ev.image[0] : ev.image;
  if (!imageUrl) return null; // pas de photo => pas de fiche, comme demandé

  const coords = centroidForPostalCode(postalCode);
  if (!coords) return null;

  const { price, priceLabel } = priceFromOffers(ev.offers);
  const rating = ev.aggregateRating
    ? (Number(ev.aggregateRating.ratingValue) / Number(ev.aggregateRating.bestRating || 10)) * 5
    : undefined;

  return {
    id: `billetreduc:${extractId(url)}`,
    title: ev.name ?? 'Sans titre',
    category,
    venue: ev.location?.name || 'Lieu à confirmer',
    address: ev.location?.address?.streetAddress ?? undefined,
    zone,
    lat: coords.lat,
    lng: coords.lng,
    price,
    priceLabel,
    dateStart: ev.startDate,
    dateEnd: ev.endDate ?? undefined,
    description: ev.description ?? undefined,
    imageUrl,
    rating,
    reviewsCount: ev.aggregateRating?.ratingCount ?? undefined,
    reviewsSource: rating ? 'Billetreduc' : undefined,
    sourceUrl: ev.url || url,
    sourceName: 'Billetreduc',
    fetchedAt: new Date().toISOString(),
    isNew: false,
    verified: false,
    verifiedVia: undefined,
    highlighted: false,
  };
}

async function main() {
  console.log('Listing des catégories Billetreduc…');
  const urlToCategory = await collectListingUrls();
  const urls = [...urlToCategory.keys()];
  console.log(`${urls.length} fiches uniques à détailler…`);

  const results = await mapLimit(urls, DETAIL_CONCURRENCY, (url) => fetchEventDetail(url, urlToCategory.get(url)));
  const events = results.filter(Boolean);

  await mkdir(path.dirname(OUT_FILE), { recursive: true });
  await writeFile(OUT_FILE, JSON.stringify({ source: 'Billetreduc', events }, null, 2));

  const counts = events.reduce((acc, e) => {
    acc[e.category] = (acc[e.category] ?? 0) + 1;
    return acc;
  }, {});
  console.log(`Billetreduc: ${events.length} événements retenus sur ${urls.length} fiches visitées.`);
  console.log('Par catégorie:', counts);
  console.log(`Écrit dans ${OUT_FILE}`);
}

main().catch((err) => {
  console.error('Échec du connecteur Billetreduc:', err);
  process.exitCode = 1;
});
