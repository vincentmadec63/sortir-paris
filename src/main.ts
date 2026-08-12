import './style.css';
import { registerSW } from 'virtual:pwa-register';
import type { EventItem, EventsFile, Category, Zone } from './types';
import { CATEGORY_LABELS } from './types';
import { setupMap, type MapController } from './map';

registerSW({ immediate: true });

const CATS: { v: Category | 'all'; l: string }[] = [
  { v: 'all', l: 'Tout' },
  { v: 'theatre', l: 'Théâtre' },
  { v: 'standup', l: 'Stand-up' },
  { v: 'concert', l: 'Concert' },
  { v: 'ephemere', l: 'Pop-up' },
  { v: 'evenement', l: 'Événement' },
];

const FAVORITES_KEY = 'sortir-paris:favorites';

const CATEGORY_COLOR_VAR: Record<Category, string> = {
  theatre: '--cat-theatre',
  standup: '--cat-standup',
  concert: '--cat-concert',
  ephemere: '--cat-popup',
  evenement: '--cat-evenement',
};
function categoryColor(cat: Category): string {
  return `var(${CATEGORY_COLOR_VAR[cat]})`;
}

interface Filters {
  price: string | null;
  zone: Zone | null;
  rating: string | null;
}

const state: {
  events: EventItem[];
  cat: Category | 'all';
  filters: Filters;
  favorites: Set<string>;
  query: string;
} = {
  events: [],
  cat: 'all',
  filters: { price: null, zone: null, rating: null },
  favorites: loadFavorites(),
  query: '',
};

function loadFavorites(): Set<string> {
  try {
    const raw = localStorage.getItem(FAVORITES_KEY);
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}

function saveFavorites() {
  localStorage.setItem(FAVORITES_KEY, JSON.stringify([...state.favorites]));
}

function starsSvg(): string {
  return '<svg viewBox="0 0 24 24"><path d="M12 2l2.9 6.6L22 9.6l-5.5 4.9L18 22l-6-4-6 4 1.5-7.5L2 9.6l7.1-1z"/></svg>';
}

function heart(id: string, active: boolean): string {
  return `<div class="heart ${active ? 'active' : ''}" data-heart="${id}"><svg viewBox="0 0 24 24"><path d="M20.8 4.6a5.5 5.5 0 00-7.8 0L12 5.6l-1-1a5.5 5.5 0 00-7.8 7.8l1 1L12 21l7.8-7.6 1-1a5.5 5.5 0 000-7.8z"/></svg></div>`;
}

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    return new Intl.DateTimeFormat('fr-FR', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(d);
  } catch {
    return iso;
  }
}

function ratingHTML(e: EventItem): string {
  if (!e.rating) return '';
  return `<span class="rating">${starsSvg()} ${e.rating.toFixed(1)}${e.reviewsCount ? ` · ${e.reviewsCount}` : ''}</span>`;
}

function heroCardHTML(e: EventItem): string {
  return `<div class="hero-card" data-open="${e.id}">
    <img class="hc-bg" src="${e.imageUrl}" alt="" width="200" height="130" loading="lazy" decoding="async" />
    ${e.isNew ? '<div class="badge-new">NOUVEAU</div>' : ''}
    <div class="hc-txt">
      <div class="hc-cat" style="color:${categoryColor(e.category)}">${CATEGORY_LABELS[e.category]}</div>
      <div class="hc-title">${escapeHTML(e.title)}</div>
    </div>
  </div>`;
}

function cardHTML(e: EventItem): string {
  return `<div class="card" data-open="${e.id}">
    ${heart(e.id, state.favorites.has(e.id))}
    <img class="card-thumb" src="${e.imageUrl}" alt="${escapeHTML(e.title)}" width="64" height="64" loading="lazy" decoding="async" />
    <div class="card-body">
      <div class="card-top">
        <div>
          <div class="card-cat" style="color:${categoryColor(e.category)}">${CATEGORY_LABELS[e.category]}</div>
          <div class="card-title">${escapeHTML(e.title)}</div>
        </div>
      </div>
      <div class="card-meta"><span>${escapeHTML(e.venue)}</span></div>
      <div class="card-meta" style="margin-top:6px;">
        <span class="price">${escapeHTML(e.priceLabel)}</span><span class="dot"></span>
        ${ratingHTML(e)}
        ${e.verified ? `<span class="dot"></span><span class="verified">vérifié · ${escapeHTML(e.verifiedVia ?? e.sourceName)}</span>` : ''}
      </div>
    </div>
  </div>`;
}

const PAGE_SIZE = 24;
const listPageSize = new Map<string, number>();
const listItemsCache = new Map<string, EventItem[]>();

function renderCardList(containerId: string, items: EventItem[]) {
  listItemsCache.set(containerId, items);
  const shown = listPageSize.get(containerId) ?? PAGE_SIZE;
  const slice = items.slice(0, shown);
  const remaining = items.length - slice.length;
  const html =
    slice.map(cardHTML).join('') +
    (remaining > 0
      ? `<button class="load-more-btn" data-loadmore="${containerId}">Charger plus (${remaining} restants)</button>`
      : '');
  $(containerId).innerHTML = html;
}

function escapeHTML(s: string): string {
  const div = document.createElement('div');
  div.textContent = s;
  return div.innerHTML;
}

function isThisWeek(iso: string): boolean {
  const d = new Date(iso).getTime();
  const now = Date.now();
  return d >= now && d <= now + 7 * 24 * 3600 * 1000;
}

function matchesFilters(e: EventItem): boolean {
  if (state.cat !== 'all' && e.category !== state.cat) return false;
  if (state.query) {
    const q = state.query.toLowerCase();
    if (!e.title.toLowerCase().includes(q) && !e.venue.toLowerCase().includes(q)) return false;
  }
  const f = state.filters;
  if (f.price === 'free' && e.price !== 0) return false;
  if (f.price === 'low' && !(e.price > 0 && e.price < 20)) return false;
  if (f.price === 'mid' && !(e.price >= 20 && e.price <= 40)) return false;
  if (f.price === 'high' && !(e.price > 40)) return false;
  if (f.zone && e.zone !== f.zone) return false;
  if (f.rating && (!e.rating || e.rating < parseFloat(f.rating))) return false;
  return true;
}

function $(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing #${id}`);
  return el;
}

function renderAll() {
  const news = state.events.filter((e) => e.isNew).slice(0, 10);
  $('hero-rail').innerHTML = news.length
    ? news.map(heroCardHTML).join('')
    : '<div class="empty-state">Rien de neuf depuis la dernière mise à jour.</div>';

  const upcoming = [...state.events]
    .filter((e) => isThisWeek(e.dateStart) || !e.dateStart)
    .sort((a, b) => a.dateStart.localeCompare(b.dateStart))
    .slice(0, 8);
  $('accueil-list').innerHTML = upcoming.length
    ? upcoming.map(cardHTML).join('')
    : '<div class="empty-state">Aucun événement chargé pour l’instant.</div>';

  const ephemereList = state.events.filter((e) => e.category === 'ephemere');
  renderCardList('ephemere-list', ephemereList);
  $('ephemere-empty').hidden = ephemereList.length > 0;

  $('carte-list').innerHTML = state.events.slice(0, 6).map(cardHTML).join('');
  renderExplorer();
  renderFavoris();
}

function renderExplorer() {
  $('chip-row').innerHTML = CATS.map(
    (c) => `<div class="chip ${state.cat === c.v ? 'active' : ''}" data-cat="${c.v}">${c.l}</div>`
  ).join('');
  const list = state.events.filter(matchesFilters);
  renderCardList('explorer-list', list);
  $('explorer-empty').hidden = list.length > 0;
  const count = Object.values(state.filters).filter(Boolean).length;
  $('filter-count').textContent = String(count);
}

function renderFavoris() {
  const list = state.events.filter((e) => state.favorites.has(e.id));
  $('favoris-list').innerHTML = list.map(cardHTML).join('');
  $('favoris-empty').hidden = list.length > 0;
}

function openDetail(id: string) {
  const e = state.events.find((x) => x.id === id);
  if (!e) return;
  $('detail-content').innerHTML = `
    <img class="detail-hero" src="${e.imageUrl}" alt="" loading="lazy" decoding="async" />
    <div class="detail-cat" style="color:${categoryColor(e.category)}">${CATEGORY_LABELS[e.category]}${e.verified ? ' · Vérifié via ' + escapeHTML(e.verifiedVia ?? e.sourceName) : ''}</div>
    <div class="detail-title">${escapeHTML(e.title)}</div>
    <div class="detail-meta-row">
      <span>${escapeHTML(e.venue)}</span>
      ${e.rating ? `<span class="rating">${starsSvg()} ${e.rating.toFixed(1)} · ${e.reviewsCount ?? 0} avis (${escapeHTML(e.reviewsSource ?? e.sourceName)})</span>` : ''}
    </div>
    ${e.description ? `<div class="detail-desc">${escapeHTML(e.description)}</div>` : ''}
    <div class="section-label" style="margin-top:0">DATE</div>
    <div class="avail-row"><div class="avail-pill sel">${escapeHTML(formatDate(e.dateStart))}</div></div>
    ${e.rating ? `<div class="review-line">★ Avis importés automatiquement depuis ${escapeHTML(e.reviewsSource ?? e.sourceName)} — non modérés par l'app.</div>` : ''}
    <div class="buy-bar">
      <div class="buy-price">${escapeHTML(e.priceLabel)}<small>par personne</small></div>
      <a class="buy-btn" href="${e.sourceUrl}" target="_blank" rel="noopener noreferrer" style="text-decoration:none;display:flex;align-items:center;justify-content:center;">Voir sur ${escapeHTML(e.sourceName)} ↗</a>
    </div>
    <div class="buy-note">Ouvre la billetterie du partenaire dans un nouvel onglet — l'achat se fait chez eux, pas dans l'app</div>
  `;
  openSheet('detail-sheet');
}

function openSheet(id: string) {
  $('backdrop').classList.add('open');
  $(id).classList.add('open');
}
function closeSheets() {
  $('backdrop').classList.remove('open');
  document.querySelectorAll('.sheet').forEach((s) => s.classList.remove('open'));
}

function setGreeting() {
  const hour = new Date().getHours();
  const el = document.getElementById('greeting');
  if (!el) return;
  el.textContent = hour < 12 ? 'Bonjour.' : hour < 18 ? 'Bon après-midi.' : 'Bonsoir.';
}

let mapController: MapController | null = null;

function showCarteTab() {
  if (!mapController) {
    mapController = setupMap('leaflet-map', (id) => openDetail(id));
    mapController.setEvents(state.events);
  }
  requestAnimationFrame(() => mapController?.invalidateSize());
}

async function loadEvents() {
  $('accueil-list').innerHTML = '<div class="load-state">Chargement des sorties…</div>';
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}data/events.json`, { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const file = (await res.json()) as EventsFile;
    state.events = file.events;
  } catch (err) {
    console.error('Impossible de charger data/events.json', err);
    $('accueil-list').innerHTML = '<div class="load-state error">Impossible de charger les données. Vérifie ta connexion, ou relance le scraper (npm run refresh-data).</div>';
    state.events = [];
  }
  renderAll();
  mapController?.setEvents(state.events);
}

document.addEventListener('click', (ev) => {
  const target = ev.target as HTMLElement;

  const tab = target.closest<HTMLElement>('.tab-btn');
  if (tab) {
    document.querySelectorAll('.tab-btn').forEach((b) => b.classList.remove('active'));
    tab.classList.add('active');
    document.querySelectorAll('.screen').forEach((s) => ((s as HTMLElement).hidden = true));
    $('screen-' + tab.dataset.tab).hidden = false;
    if (tab.dataset.tab === 'carte') showCarteTab();
    return;
  }

  const heartEl = target.closest<HTMLElement>('[data-heart]');
  if (heartEl) {
    ev.stopPropagation();
    const id = heartEl.dataset.heart!;
    state.favorites.has(id) ? state.favorites.delete(id) : state.favorites.add(id);
    saveFavorites();
    renderAll();
    return;
  }

  const loadMoreBtn = target.closest<HTMLElement>('[data-loadmore]');
  if (loadMoreBtn) {
    const containerId = loadMoreBtn.dataset.loadmore!;
    listPageSize.set(containerId, (listPageSize.get(containerId) ?? PAGE_SIZE) + PAGE_SIZE);
    renderCardList(containerId, listItemsCache.get(containerId) ?? []);
    return;
  }

  const openEl = target.closest<HTMLElement>('[data-open]');
  if (openEl) {
    openDetail(openEl.dataset.open!);
    return;
  }

  const chip = target.closest<HTMLElement>('.chip');
  if (chip) {
    state.cat = chip.dataset.cat as Category | 'all';
    listPageSize.delete('explorer-list');
    renderExplorer();
    return;
  }

  if (target.closest('#open-filters')) {
    openSheet('filter-sheet');
    return;
  }
  if (target.closest('[data-close]')) {
    closeSheets();
    return;
  }
  if (target === $('backdrop')) {
    closeSheets();
    return;
  }

  const opt = target.closest<HTMLElement>('.filter-opt');
  if (opt) {
    const group = opt.parentElement!.dataset.group as keyof Filters;
    const already = opt.classList.contains('sel');
    opt.parentElement!.querySelectorAll('.filter-opt').forEach((o) => o.classList.remove('sel'));
    if (!already) {
      opt.classList.add('sel');
      (state.filters[group] as string | null) = opt.dataset.val ?? null;
    } else {
      (state.filters[group] as string | null) = null;
    }
    return;
  }

  if (target.closest('#apply-filters')) {
    listPageSize.delete('explorer-list');
    renderExplorer();
    closeSheets();
    document.querySelector<HTMLElement>('[data-tab="explorer"]')?.click();
    return;
  }
});

document.getElementById('search-input')?.addEventListener('input', (ev) => {
  state.query = (ev.target as HTMLInputElement).value;
  listPageSize.delete('explorer-list');
  renderExplorer();
});

setGreeting();
loadEvents();
