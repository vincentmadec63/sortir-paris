// Source : theatreonline.com — pas de robots.txt publié (donc pas de règle
// à respecter au-delà des bonnes pratiques usuelles), microdonnées
// schema.org lisibles directement dans le HTML des fiches spectacle.
// Les listes par genre sont déjà scopées "Paris et Île-de-France" par le site.
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchText, sleep, mapLimit } from '../lib/http.mjs';
import { load, findScopes, propValue, propScope } from '../lib/microdata.mjs';
import { zoneForPostalCode } from '../lib/zones.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_FILE = path.join(__dirname, '..', '.cache', 'theatreonline.json');

const BASE = 'https://www.theatreonline.com';
const GENRE_PAGES = [
  { slug: 'genre/comedie-boulevard/1', category: 'theatre' },
  { slug: 'genre/contemporain/2', category: 'theatre' },
  { slug: 'genre/classique/3', category: 'theatre' },
  { slug: 'genre/musique-danse/4', category: 'concert' },
  { slug: 'genre/humour-cafe-theatre/5', category: 'standup' },
];
const MAX_PAGES_PER_GENRE = 4; // ~120 fiches/genre max
const PAGE_DELAY_MS = 300;
const DETAIL_CONCURRENCY = 5;

async function listGenrePage(slug, page) {
  const url = page === 1 ? `${BASE}/Spectacles/Liste/${slug}` : `${BASE}/Spectacles/Liste/${slug}?page=${page}`;
  const html = await fetchText(url);
  const $ = load(html);
  const links = new Set();
  $('a[href^="/Spectacle/"]').each((_, el) => links.add($(el).attr('href')));
  return [...links];
}

async function collectListingUrls() {
  const urlToCategory = new Map();
  for (const { slug, category } of GENRE_PAGES) {
    let page = 1;
    let total = 0;
    while (page <= MAX_PAGES_PER_GENRE) {
      const links = await listGenrePage(slug, page);
      if (links.length === 0) break;
      for (const href of links) {
        const url = `${BASE}${href}`;
        if (!urlToCategory.has(url)) urlToCategory.set(url, category);
      }
      total += links.length;
      page += 1;
      await sleep(PAGE_DELAY_MS);
    }
    console.log(`  ${slug}: ${total} fiches listées sur ${page - 1} page(s)`);
  }
  return urlToCategory;
}

function extractId(url) {
  const seg = url.replace(/\/+$/, '').split('/').pop();
  return seg || url;
}

async function fetchEventDetail(url, category) {
  const html = await fetchText(url);
  const $ = load(html);
  const ev = findScopes($, $.root(), 'Event').first();
  if (ev.length === 0) return null;

  const postalCode = (() => {
    const location = propScope($, ev, 'location');
    const address = location && propScope($, location, 'address');
    return address ? propValue($, address, 'postalCode') : undefined;
  })();
  const zone = zoneForPostalCode(postalCode);
  if (!zone) return null;
  if (category === 'standup' && zone !== 'paris') return null;

  const rawImage = propValue($, ev, 'image');
  const imageUrl = rawImage ? new URL(rawImage, BASE).toString() : null;
  if (!imageUrl) return null;

  const location = propScope($, ev, 'location');
  const address = location && propScope($, location, 'address');
  const offers = propScope($, ev, 'offers');
  const agg = propScope($, ev, 'aggregateRating');

  const lowPrice = offers ? parseFloat(propValue($, offers, 'lowPrice')) : NaN;
  const price = Number.isFinite(lowPrice) ? lowPrice : null;
  const priceLabel = price === null ? 'Tarif à vérifier' : `à partir de ${price}€`;

  const ratingValue = agg ? parseFloat(propValue($, agg, 'ratingValue')) : NaN;
  const bestRating = agg ? parseFloat(propValue($, agg, 'bestRating')) : NaN;
  const rating = Number.isFinite(ratingValue) && Number.isFinite(bestRating) && bestRating > 0
    ? (ratingValue / bestRating) * 5
    : undefined;
  const reviewsCount = agg ? parseInt(propValue($, agg, 'reviewCount'), 10) : undefined;

  return {
    id: `theatreonline:${extractId(url)}`,
    title: propValue($, ev, 'name') ?? 'Sans titre',
    category,
    venue: (location && propValue($, location, 'name')) || 'Lieu à confirmer',
    address: address ? propValue($, address, 'streetAddress') : undefined,
    zone,
    price,
    priceLabel,
    dateStart: propValue($, ev, 'startDate'),
    dateEnd: propValue($, ev, 'endDate') || undefined,
    description: propValue($, ev, 'description') || undefined,
    imageUrl,
    rating,
    reviewsCount: Number.isFinite(reviewsCount) ? reviewsCount : undefined,
    reviewsSource: rating ? 'TheaterOnline' : undefined,
    sourceUrl: url,
    sourceName: 'TheaterOnline',
    fetchedAt: new Date().toISOString(),
    isNew: false,
    verified: false,
    verifiedVia: undefined,
  };
}

async function main() {
  console.log('Listing des genres TheaterOnline…');
  const urlToCategory = await collectListingUrls();
  const urls = [...urlToCategory.keys()];
  console.log(`${urls.length} fiches uniques à détailler…`);

  const results = await mapLimit(urls, DETAIL_CONCURRENCY, (url) => fetchEventDetail(url, urlToCategory.get(url)));
  const events = results.filter(Boolean);

  await mkdir(path.dirname(OUT_FILE), { recursive: true });
  await writeFile(OUT_FILE, JSON.stringify({ source: 'TheaterOnline', events }, null, 2));

  const counts = events.reduce((acc, e) => {
    acc[e.category] = (acc[e.category] ?? 0) + 1;
    return acc;
  }, {});
  console.log(`TheaterOnline: ${events.length} événements retenus sur ${urls.length} fiches visitées.`);
  console.log('Par catégorie:', counts);
  console.log(`Écrit dans ${OUT_FILE}`);
}

main().catch((err) => {
  console.error('Échec du connecteur TheaterOnline:', err);
  process.exitCode = 1;
});
