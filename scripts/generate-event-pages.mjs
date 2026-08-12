// Génère une page statique par événement (dist/spectacle/<slug>/index.html)
// pour le SEO et les aperçus de liens (iMessage/Slack/WhatsApp...), qui
// n'exécutent pas le JS de l'app : ces crawlers ne verront que le HTML
// buildé, donc les balises <title>/meta doivent être présentes ici. Google
// (qui exécute le JS) chargera ensuite l'app normalement, laquelle ouvrira
// la bonne fiche via le routing client (routeFromLocation dans src/main.ts).
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const DIST_INDEX = path.join(ROOT, 'dist', 'index.html');
const DATA_FILE = path.join(ROOT, 'public', 'data', 'events.json');
const OUT_DIR = path.join(ROOT, 'dist', 'spectacle');

const SITE_URL = 'https://vincentmadec63.github.io/sortir-paris';
// Chemin racine absolu du site (ex. "/sortir-paris/") — injecté dans chaque
// page statique pour que le JS de l'app (computeBasePath dans src/main.ts)
// sache retrouver la racine même si le document est servi 2 niveaux plus
// bas (dist/spectacle/<slug>/), où document.baseURI ne suffit plus.
const SITE_BASE_PATH = new URL(`${SITE_URL}/`).pathname;

function slugFromId(id) {
  return id.replace(':', '-');
}

function escapeHtml(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function truncate(text, max) {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1).trimEnd()}…`;
}

function descriptionFor(e) {
  const base = e.description ? e.description : `${e.venue} — ${e.priceLabel}`;
  return truncate(base.replace(/\s+/g, ' ').trim(), 200);
}

async function main() {
  const template = await readFile(DIST_INDEX, 'utf-8');
  // Les pages statiques vivent deux niveaux plus bas (dist/spectacle/<slug>/),
  // les chemins relatifs "./" du build racine doivent donc pointer deux
  // niveaux plus haut.
  const rebased = template.replace(/(src|href)="\.\//g, '$1="../../');

  const raw = JSON.parse(await readFile(DATA_FILE, 'utf-8'));
  const events = raw.events ?? [];

  let count = 0;
  for (const e of events) {
    const slug = slugFromId(e.id);
    const url = `${SITE_URL}/spectacle/${slug}/`;
    const title = `${e.title} — Sortir Paris`;
    const description = descriptionFor(e);

    const metaBlock = [
      `<title>${escapeHtml(title)}</title>`,
      `<meta name="description" content="${escapeHtml(description)}" />`,
      `<link rel="canonical" href="${url}" />`,
      `<meta property="og:type" content="website" />`,
      `<meta property="og:title" content="${escapeHtml(title)}" />`,
      `<meta property="og:description" content="${escapeHtml(description)}" />`,
      `<meta property="og:image" content="${escapeHtml(e.imageUrl)}" />`,
      `<meta property="og:url" content="${url}" />`,
      `<meta name="twitter:card" content="summary_large_image" />`,
      `<script>window.__APP_BASE__=${JSON.stringify(SITE_BASE_PATH)};</script>`,
    ].join('\n  ');

    const html = rebased.replace('<title>Sortir Paris</title>', metaBlock);

    const outDir = path.join(OUT_DIR, slug);
    await mkdir(outDir, { recursive: true });
    await writeFile(path.join(outDir, 'index.html'), html);
    count += 1;
  }

  console.log(`Pages statiques générées : ${count} (dans ${OUT_DIR})`);
}

main().catch((err) => {
  console.error('Échec de la génération des pages statiques:', err);
  process.exitCode = 1;
});
