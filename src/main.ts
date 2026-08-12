import './style.css';
import { registerSW } from 'virtual:pwa-register';
import type { EventItem, EventsFile, Category, Zone } from './types';
import { CATEGORY_LABELS } from './types';
import { setupMap, type MapController } from './map';
import {
  isAuthConfigured,
  getSession,
  onAuthStateChange,
  signIn,
  signUp,
  signInWithGoogle,
  signOut,
  loadPreferences,
  savePreferences,
  EMPTY_PREFS,
  type Preferences,
} from './auth';
import type { Session } from '@supabase/supabase-js';

registerSW({ immediate: true });

const WELCOME_SEEN_KEY = 'sortir-paris:welcome-seen';

// URL par événement (partage + pages statiques générées par
// scripts/generate-event-pages.mjs) : /spectacle/<slug>/, où slug est l'id
// avec son premier ":" remplacé par un "-" (ex. "theatreonline:52725" ->
// "theatreonline-52725"), réversible car les préfixes de source ne
// contiennent jamais de tiret.
// La racine du site est déduite du chemin actuel plutôt que de
// document.baseURI : le service worker de la PWA sert parfois le shell
// racine en réponse à une navigation profonde (cache offline-first), auquel
// cas document.baseURI ne reflète pas la vraie profondeur du document livré
// — alors que window.location.pathname, lui, reste toujours le chemin
// réellement demandé, fiable dans tous les cas (page statique fraîche,
// fallback SPA en dev, ou shell mis en cache par le service worker).
function computeBasePath(): string {
  const marker = '/spectacle/';
  const idx = window.location.pathname.indexOf(marker);
  if (idx !== -1) return window.location.pathname.slice(0, idx + 1);
  return new URL('.', document.baseURI).pathname;
}
function slugFromId(id: string): string {
  return id.replace(':', '-');
}
function idFromSlug(slug: string): string {
  return slug.replace('-', ':');
}
function eventPath(id: string): string {
  return `${computeBasePath()}spectacle/${slugFromId(id)}/`;
}
function eventUrl(id: string): string {
  return `${window.location.origin}${eventPath(id)}`;
}

let currentSession: Session | null = null;
let currentPrefs: Preferences = EMPTY_PREFS;

const CATS: { v: Category | 'all'; l: string }[] = [
  { v: 'all', l: 'Tout' },
  { v: 'theatre', l: 'Théâtre' },
  { v: 'standup', l: 'Stand-up' },
  { v: 'concert', l: 'Concert' },
  { v: 'ephemere', l: 'Pop-up' },
  { v: 'evenement', l: 'Spectacles' },
];

const FAVORITES_KEY = 'sortir-paris:favorites';

interface Filters {
  price: string | null;
  zone: Zone | null;
  rating: string | null;
  when: string | null;
  sort: string | null;
  highlight: string | null;
}

const state: {
  events: EventItem[];
  cat: Category | 'all';
  tag: string | null;
  filters: Filters;
  favorites: Set<string>;
  query: string;
  mapCat: Category | 'all';
  nearMe: boolean;
  userLocation: { lat: number; lng: number } | null;
} = {
  events: [],
  cat: 'all',
  tag: null,
  filters: { price: null, zone: null, rating: null, when: null, sort: null, highlight: null },
  favorites: loadFavorites(),
  query: '',
  mapCat: 'all',
  nearMe: false,
  userLocation: null,
};

function loadFavorites(): Set<string> {
  try {
    const raw = localStorage.getItem(FAVORITES_KEY);
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}

// Personnalisation implicite : pas de questionnaire (le KYC explicite a été
// retiré, rejeté par l'utilisateur) — on apprend silencieusement des goûts
// à partir de ce que la personne regarde et favorite, sur l'appareil,
// invité comme connecté.
const AFFINITY_KEY = 'sortir-paris:affinity';

interface Affinity {
  categories: Partial<Record<Category, number>>;
  zones: Partial<Record<Zone, number>>;
}

function loadAffinity(): Affinity {
  try {
    const raw = localStorage.getItem(AFFINITY_KEY);
    return raw ? (JSON.parse(raw) as Affinity) : { categories: {}, zones: {} };
  } catch {
    return { categories: {}, zones: {} };
  }
}

const affinity: Affinity = loadAffinity();

function recordAffinity(e: EventItem, weight: number) {
  affinity.categories[e.category] = (affinity.categories[e.category] ?? 0) + weight;
  affinity.zones[e.zone] = (affinity.zones[e.zone] ?? 0) + weight;
  localStorage.setItem(AFFINITY_KEY, JSON.stringify(affinity));
}

function affinityScore(e: EventItem): number {
  return (affinity.categories[e.category] ?? 0) + (affinity.zones[e.zone] ?? 0);
}

function saveFavorites() {
  if (currentSession) {
    currentPrefs = { ...currentPrefs, favoriteEventIds: [...state.favorites] };
    void savePreferences(currentSession.user.id, currentPrefs);
  } else {
    localStorage.setItem(FAVORITES_KEY, JSON.stringify([...state.favorites]));
  }
}

function starsSvg(): string {
  return '<svg viewBox="0 0 24 24"><path d="M12 2l2.9 6.6L22 9.6l-5.5 4.9L18 22l-6-4-6 4 1.5-7.5L2 9.6l7.1-1z"/></svg>';
}

function heart(id: string, active: boolean): string {
  return `<div class="heart ${active ? 'active' : ''}" data-heart="${id}"><svg viewBox="0 0 24 24"><path d="M20.8 4.6a5.5 5.5 0 00-7.8 0L12 5.6l-1-1a5.5 5.5 0 00-7.8 7.8l1 1L12 21l7.8-7.6 1-1a5.5 5.5 0 000-7.8z"/></svg></div>`;
}

function distanceKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function formatDistance(km: number): string {
  return km < 1 ? `${Math.round(km * 1000)} m` : `${km.toFixed(1).replace('.', ',')} km`;
}

function distanceLabel(e: EventItem): string {
  if (!state.nearMe || !state.userLocation) return '';
  const km = distanceKm(state.userLocation.lat, state.userLocation.lng, e.lat, e.lng);
  return `<span class="dot"></span><span class="distance">📍 ${formatDistance(km)}</span>`;
}

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    return new Intl.DateTimeFormat('fr-FR', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(d);
  } catch {
    return iso;
  }
}

function formatDateShort(iso: string): string {
  try {
    return new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(iso));
  } catch {
    return iso;
  }
}

// dateStart/dateEnd viennent parfois de la période complète de la série de
// représentations (pas une seule séance) — on le rend explicite plutôt que
// d'afficher une date isolée sans contexte.
function dateSectionHTML(e: EventItem): string {
  const startDay = e.dateStart?.slice(0, 10);
  const endDay = e.dateEnd?.slice(0, 10);
  if (endDay && endDay !== startDay) {
    return `
      <div class="section-label" style="margin-top:0">PÉRIODE DE REPRÉSENTATION</div>
      <div class="avail-row"><div class="avail-pill sel">Du ${escapeHTML(formatDateShort(e.dateStart))} au ${escapeHTML(formatDateShort(e.dateEnd!))}</div></div>
      <p class="form-note" style="margin-top:-8px;">Dates et horaires précis des séances à vérifier sur la billetterie du partenaire.</p>
    `;
  }
  return `
    <div class="section-label" style="margin-top:0">PROCHAINE DATE</div>
    <div class="avail-row"><div class="avail-pill sel">${escapeHTML(formatDate(e.dateStart))}</div></div>
  `;
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
      <div class="hc-cat">${CATEGORY_LABELS[e.category]}</div>
      <div class="hc-title">${escapeHTML(e.title)}</div>
    </div>
  </div>`;
}

function subgenreLabel(e: EventItem): string {
  const tag = e.tags?.[0];
  if (!tag || tag === CATEGORY_LABELS[e.category]) return '';
  return ` · ${escapeHTML(tag)}`;
}

function cardHTML(e: EventItem): string {
  return `<div class="card cat-${e.category}" data-open="${e.id}">
    ${heart(e.id, state.favorites.has(e.id))}
    <img class="card-thumb" src="${e.imageUrl}" alt="${escapeHTML(e.title)}" width="64" height="64" loading="lazy" decoding="async" />
    <div class="card-body">
      <div class="card-top">
        <div>
          <div class="card-cat">${CATEGORY_LABELS[e.category]}${subgenreLabel(e)}${e.highlighted ? ' · <span class="highlight-badge">★ Coup de cœur</span>' : ''}</div>
          <div class="card-title">${escapeHTML(e.title)}</div>
        </div>
      </div>
      <div class="card-meta"><span>${escapeHTML(e.venue)}</span></div>
      <div class="card-meta" style="margin-top:6px;">
        <span class="price">${escapeHTML(e.priceLabel)}</span><span class="dot"></span>
        ${ratingHTML(e)}
        ${e.verified ? `<span class="dot"></span><span class="verified">vérifié · ${escapeHTML(e.verifiedVia ?? e.sourceName)}</span>` : ''}
        ${distanceLabel(e)}
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

function matchesWhen(e: EventItem, when: string): boolean {
  if (!e.dateStart) return false;
  const d = new Date(e.dateStart);
  const now = new Date();
  if (d.getTime() < now.getTime()) return false;

  if (when === 'today') {
    return d.toDateString() === now.toDateString();
  }
  if (when === 'week') {
    return d.getTime() <= now.getTime() + 7 * 24 * 3600 * 1000;
  }
  if (when === 'weekend') {
    const day = now.getDay(); // 0 = dimanche, 6 = samedi
    const daysUntilSaturday = (6 - day + 7) % 7;
    const saturday = new Date(now);
    saturday.setHours(0, 0, 0, 0);
    saturday.setDate(now.getDate() + daysUntilSaturday);
    const mondayAfter = new Date(saturday);
    mondayAfter.setDate(saturday.getDate() + 2);
    return d.getTime() >= saturday.getTime() && d.getTime() < mondayAfter.getTime();
  }
  if (when === 'month') {
    return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
  }
  return true;
}

// "Ce soir" réutilise exactement la logique du filtre "Aujourd'hui" (même
// date + horaire pas encore passé) : dateStart correspond parfois au début
// d'une période de représentation plutôt qu'à la séance du jour, donc les
// spectacles à programmation continue peuvent ne pas apparaître ici — c'est
// une limitation déjà connue du filtre "Aujourd'hui", pas une régression.
function tonightEvents(): EventItem[] {
  return state.events
    .filter((e) => matchesWhen(e, 'today'))
    .sort((a, b) => a.dateStart.localeCompare(b.dateStart))
    .slice(0, 8);
}

function matchesFilters(e: EventItem): boolean {
  if (state.cat !== 'all' && e.category !== state.cat) return false;
  if (state.tag && !e.tags?.includes(state.tag)) return false;
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
  if (f.when && !matchesWhen(e, f.when)) return false;
  if (f.sort === 'topRated' && (!e.reviewsCount || e.reviewsCount < 10)) return false;
  if (f.highlight === 'only' && !e.highlighted) return false;
  return true;
}

function $(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing #${id}`);
  return el;
}

function renderAll() {
  const tonight = tonightEvents();
  $('tonight-label').hidden = tonight.length === 0;
  $('tonight-list').innerHTML = tonight.map(cardHTML).join('');

  const news = state.events.filter((e) => e.isNew).slice(0, 10);
  $('hero-rail').innerHTML = news.length
    ? news.map(heroCardHTML).join('')
    : '<div class="empty-state">Rien de neuf depuis la dernière mise à jour.</div>';

  let upcoming = [...state.events].filter((e) => isThisWeek(e.dateStart) || !e.dateStart);
  const hasPrefs = currentSession && (currentPrefs.favoriteCategories.length > 0 || currentPrefs.homeZone);
  if (hasPrefs) {
    const preferred = upcoming.filter(
      (e) =>
        (currentPrefs.favoriteCategories.length === 0 || currentPrefs.favoriteCategories.includes(e.category)) &&
        (!currentPrefs.homeZone || e.zone === currentPrefs.homeZone)
    );
    if (preferred.length > 0) upcoming = preferred;
  }
  upcoming = upcoming
    .sort((a, b) => a.dateStart.localeCompare(b.dateStart))
    .sort((a, b) => affinityScore(b) - affinityScore(a))
    .slice(0, 8);
  $('screen-accueil').querySelector('.screen-sub')!.textContent = hasPrefs
    ? 'Sélection selon tes préférences.'
    : "Voici ce qu'il ne faut pas rater cette semaine.";
  $('accueil-list').innerHTML = upcoming.length
    ? upcoming.map(cardHTML).join('')
    : '<div class="empty-state">Aucun événement chargé pour l’instant.</div>';

  $('carte-list').innerHTML = topMapEvents().slice(0, 6).map(cardHTML).join('');
  renderExplorer();
  renderFavoris();
}

function renderTagRow() {
  const tagRow = $('tag-row');
  const counts = new Map<string, number>();
  for (const e of state.events) {
    if (state.cat !== 'all' && e.category !== state.cat) continue;
    for (const t of e.tags ?? []) counts.set(t, (counts.get(t) ?? 0) + 1);
  }
  const tags = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12)
    .map(([t]) => t);
  if (state.cat === 'all' || tags.length === 0) {
    tagRow.hidden = true;
    tagRow.innerHTML = '';
    return;
  }
  tagRow.hidden = false;
  tagRow.innerHTML = tags
    .map((t) => `<div class="chip ${state.tag === t ? 'active' : ''}" data-tag="${escapeHTML(t)}">${escapeHTML(t)}</div>`)
    .join('');
}

function setNearStatus(msg: string | null) {
  const el = $('near-status');
  el.hidden = !msg;
  el.textContent = msg ?? '';
}

// Le tri par distance prend le pas sur "Mieux notés" quand actif : les deux
// tris n'ont pas grand sens combinés, et "près de moi" est une intention
// plus explicite (l'utilisateur vient de donner sa position) qu'un filtre
// resté coché dans la feuille de filtres.
function toggleNearMe() {
  if (state.nearMe) {
    state.nearMe = false;
    setNearStatus(null);
    listPageSize.delete('explorer-list');
    renderExplorer();
    return;
  }
  if (!navigator.geolocation) {
    setNearStatus('Géolocalisation non disponible sur cet appareil.');
    return;
  }
  setNearStatus('Localisation en cours…');
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      state.userLocation = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      state.nearMe = true;
      setNearStatus(null);
      listPageSize.delete('explorer-list');
      renderExplorer();
    },
    () => {
      setNearStatus("Position indisponible — vérifie l'autorisation de localisation.");
    },
    { enableHighAccuracy: false, timeout: 8000 }
  );
}

function renderExplorer() {
  $('chip-row').innerHTML = CATS.map(
    (c) => `<div class="chip ${state.cat === c.v ? 'active' : ''}" data-cat="${c.v}">${c.l}</div>`
  ).join('');
  renderTagRow();
  $('near-me-btn').classList.toggle('active', state.nearMe);
  document
    .querySelectorAll<HTMLElement>('#when-row [data-when]')
    .forEach((el) => el.classList.toggle('active', state.filters.when === el.dataset.when));
  const list = state.events.filter(matchesFilters);
  if (state.filters.sort === 'topRated') list.sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0));
  if (state.nearMe && state.userLocation) {
    const loc = state.userLocation;
    list.sort((a, b) => distanceKm(loc.lat, loc.lng, a.lat, a.lng) - distanceKm(loc.lat, loc.lng, b.lat, b.lng));
  }
  renderCardList('explorer-list', list);
  $('explorer-empty').hidden = list.length > 0;
  const count = Object.values(state.filters).filter(Boolean).length;
  $('filter-count').textContent = String(count);
}

function renderFavoris() {
  const list = state.events.filter((e) => state.favorites.has(e.id));
  $('favoris-list').innerHTML = list.map(cardHTML).join('');
  $('favoris-empty').hidden = list.length > 0;
  ($('share-favorites') as HTMLButtonElement).hidden = list.length === 0;
}

let currentDetailId: string | null = null;

function openDetail(id: string, opts: { updateUrl?: boolean } = {}) {
  const e = state.events.find((x) => x.id === id);
  if (!e) return;
  recordAffinity(e, 1);
  currentDetailId = id;
  if (opts.updateUrl !== false) {
    history.pushState({ eventId: id }, '', eventPath(id));
  }
  $('detail-content').innerHTML = `
    <img class="detail-hero" src="${e.imageUrl}" alt="" loading="lazy" decoding="async" />
    <div class="detail-cat">${CATEGORY_LABELS[e.category]}${subgenreLabel(e)}${e.verified ? ' · Vérifié via ' + escapeHTML(e.verifiedVia ?? e.sourceName) : ''}</div>
    ${e.highlighted ? `<div class="highlight-badge" style="margin:6px 0 0;">★ ${escapeHTML(e.highlightedVia ?? 'Coup de cœur')}</div>` : ''}
    <div class="detail-title">${escapeHTML(e.title)}</div>
    <div class="detail-meta-row">
      <span>${escapeHTML(e.venue)}</span>
      ${e.rating ? `<span class="rating">${starsSvg()} ${e.rating.toFixed(1)} · ${e.reviewsCount ?? 0} avis (${escapeHTML(e.reviewsSource ?? e.sourceName)})</span>` : ''}
    </div>
    ${e.description ? `<div class="detail-desc">${escapeHTML(e.description)}</div>` : ''}
    ${dateSectionHTML(e)}
    ${e.rating ? `<div class="review-line">★ Avis importés automatiquement depuis ${escapeHTML(e.reviewsSource ?? e.sourceName)} — non modérés par l'app.</div>` : ''}
    <div class="buy-bar">
      <div class="buy-price">${escapeHTML(e.priceLabel)}<small>par personne</small></div>
      <a class="buy-btn" href="${e.sourceUrl}" target="_blank" rel="noopener noreferrer" style="text-decoration:none;display:flex;align-items:center;justify-content:center;">Voir sur ${escapeHTML(e.sourceName)} ↗</a>
    </div>
    <div class="buy-note">Ouvre la billetterie du partenaire dans un nouvel onglet — l'achat se fait chez eux, pas dans l'app</div>
    <div class="form-actions">
      <button class="btn" id="share-event">Partager</button>
    </div>
  `;
  openSheet('detail-sheet');
}

async function shareLink(url: string, title: string, btn: HTMLElement) {
  if (navigator.share) {
    try {
      await navigator.share({ title, url });
    } catch {
      // annulé par l'utilisateur — rien à faire
    }
    return;
  }
  try {
    await navigator.clipboard.writeText(url);
    const original = btn.textContent;
    btn.textContent = 'Lien copié !';
    setTimeout(() => {
      btn.textContent = original;
    }, 2000);
  } catch {
    // presse-papiers indisponible — pas de repli supplémentaire
  }
}

async function shareCurrentEvent(btn: HTMLElement) {
  if (!currentDetailId) return;
  const e = state.events.find((x) => x.id === currentDetailId);
  if (!e) return;
  await shareLink(eventUrl(e.id), e.title, btn);
}

// Partage d'une sélection de favoris : les ids sont encodés en query string
// (?selection=a,b,c) plutôt qu'en chemin — pas besoin de page statique par
// combinaison possible (contrairement aux fiches individuelles), et decodage
// simple côté client via maybeOpenSharedSelection().
async function shareFavorites(btn: HTMLElement) {
  if (state.favorites.size === 0) return;
  const slugs = [...state.favorites].map(slugFromId).join(',');
  const url = `${window.location.origin}${computeBasePath()}?selection=${encodeURIComponent(slugs)}`;
  await shareLink(url, `Ma sélection Sortir Paris (${state.favorites.size})`, btn);
}

let selectionOpen = false;

function openSelection(ids: string[]): boolean {
  const items = state.events.filter((e) => ids.includes(e.id));
  if (items.length === 0) return false;
  selectionOpen = true;
  $('selection-content').innerHTML = `
    <h3 class="sheet-heading">Sélection partagée (${items.length})</h3>
    <p class="form-note">Une sélection de sorties partagée avec toi.</p>
    ${items.map(cardHTML).join('')}
  `;
  openSheet('selection-sheet');
  return true;
}

function maybeOpenSharedSelection(): boolean {
  const raw = new URLSearchParams(window.location.search).get('selection');
  if (!raw) return false;
  const ids = raw.split(',').filter(Boolean).map(idFromSlug);
  return openSelection(ids);
}

function openSheet(id: string) {
  $('backdrop').classList.add('open');
  $(id).classList.add('open');
}
// updateUrl=false quand la fermeture est déclenchée par une navigation
// arrière/avant déjà en cours (popstate) : l'URL reflète déjà la nouvelle
// position, la retoucher ici créerait une entrée d'historique parasite.
function closeSheets(opts: { updateUrl?: boolean } = {}) {
  $('backdrop').classList.remove('open');
  document.querySelectorAll('.sheet').forEach((s) => s.classList.remove('open'));
  localStorage.setItem(WELCOME_SEEN_KEY, '1');
  if (currentDetailId) {
    currentDetailId = null;
    if (opts.updateUrl !== false) history.pushState({}, '', computeBasePath());
  }
  if (selectionOpen) {
    selectionOpen = false;
    history.replaceState({}, '', computeBasePath());
  }
}

function updateAccountButton() {
  $('open-account').classList.toggle('logged-in', Boolean(currentSession));
}

function renderAccountSheet(error?: string) {
  const el = $('account-content');
  const isFirstRun = !localStorage.getItem(WELCOME_SEEN_KEY) && !currentSession;

  if (!isAuthConfigured) {
    el.innerHTML = `
      <h3 class="sheet-heading">Compte</h3>
      <p class="form-note">La connexion n'est pas encore activée sur cette installation. En attendant, tes favoris restent enregistrés sur cet appareil.</p>
      <div class="form-actions">
        <button class="btn primary" id="account-continue-guest">Continuer sans compte</button>
      </div>
    `;
    return;
  }

  if (!currentSession) {
    el.innerHTML = `
      <h3 class="sheet-heading">${isFirstRun ? 'Bienvenue' : 'Compte'}</h3>
      ${isFirstRun ? '<p class="form-note">Connecte-toi pour retrouver tes préférences sur tous tes appareils — ou continue sans compte, tu pourras le faire plus tard.</p>' : ''}
      <div class="form-actions">
        <button class="btn google" id="account-google">
          <svg viewBox="0 0 48 48"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.9 29.3 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.1 8 3l6-6C34.6 5.1 29.6 3 24 3 12.4 3 3 12.4 3 24s9.4 21 21 21 21-9.4 21-21c0-1.4-.1-2.5-.4-3.5z"/><path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 16 19 13 24 13c3.1 0 5.8 1.1 8 3l6-6C34.6 6.1 29.6 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.5 0 10.4-2.1 14.1-5.5l-6.5-5.5c-2.1 1.6-4.9 2.6-7.6 2.6-5.2 0-9.7-3.1-11.3-7.9l-6.6 5.1C9.6 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.3-2.2 4.3-4.1 5.8l6.5 5.5C41.5 36.5 44 30.8 44 24c0-1.4-.1-2.5-.4-3.5z"/></svg>
          Continuer avec Google
        </button>
      </div>
      <p class="form-divider">ou</p>
      <div class="field"><label>Email</label><input type="email" id="account-email-input" autocomplete="email" /></div>
      <div class="field"><label>Mot de passe</label><input type="password" id="account-password-input" autocomplete="current-password" /></div>
      <div class="form-actions">
        <button class="btn" id="account-signup">Créer un compte</button>
        <button class="btn primary" id="account-signin">Se connecter</button>
      </div>
      ${error ? `<div class="form-error">${escapeHTML(error)}</div>` : ''}
      <p class="form-note">Une fois connecté, tes préférences s'appliquent automatiquement à l'ouverture, sur tous tes appareils.</p>
      <div class="form-actions">
        <button class="btn" id="account-continue-guest">Continuer sans compte</button>
      </div>
    `;
    return;
  }

  el.innerHTML = `
    <h3 class="sheet-heading">Compte</h3>
    <div class="account-email">${escapeHTML(currentSession.user.email ?? '')}</div>
    <div class="filter-group">
      <h4>Tes catégories préférées</h4>
      <div class="filter-options" id="pref-categories">
        ${CATS.filter((c) => c.v !== 'all')
          .map(
            (c) =>
              `<div class="filter-opt ${currentPrefs.favoriteCategories.includes(c.v as Category) ? 'sel' : ''}" data-pref-cat="${c.v}">${c.l}</div>`
          )
          .join('')}
      </div>
    </div>
    <div class="filter-group">
      <h4>Zone "chez moi"</h4>
      <div class="filter-options" id="pref-zone">
        <div class="filter-opt ${currentPrefs.homeZone === 'paris' ? 'sel' : ''}" data-pref-zone="paris">Paris</div>
        <div class="filter-opt ${currentPrefs.homeZone === 'petite_couronne' ? 'sel' : ''}" data-pref-zone="petite_couronne">Petite couronne</div>
        <div class="filter-opt ${currentPrefs.homeZone === 'grande_couronne' ? 'sel' : ''}" data-pref-zone="grande_couronne">Grande couronne</div>
      </div>
    </div>
    <div class="form-actions">
      <button class="btn primary" id="account-save-prefs">Enregistrer</button>
    </div>
    <div class="form-actions">
      <button class="btn danger" id="account-signout">Se déconnecter</button>
    </div>
    ${error ? `<div class="form-error">${escapeHTML(error)}</div>` : ''}
  `;
}

function setGreeting() {
  const hour = new Date().getHours();
  const el = document.getElementById('greeting');
  if (!el) return;
  el.textContent = hour < 12 ? 'Bonjour.' : hour < 18 ? 'Bon après-midi.' : 'Bonsoir.';
}

let mapController: MapController | null = null;

const MAP_MIN_REVIEWS = 10;
const MAP_MAX_PINS = 150;

// La carte n'a de sens que pour repérer les meilleures adresses, pas pour
// dumper les 1800+ événements dessus (retour utilisateur : "ça ne sert à
// rien"). On ne garde que les mieux notés et les coups de cœur, filtrés
// selon la catégorie choisie dans la carte elle-même (indépendante du
// filtre d'Explorer).
function topMapEvents(): EventItem[] {
  return [...state.events]
    .filter((e) => state.mapCat === 'all' || e.category === state.mapCat)
    .filter((e) => e.highlighted || (e.rating && (e.reviewsCount ?? 0) >= MAP_MIN_REVIEWS))
    .sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0))
    .slice(0, MAP_MAX_PINS);
}

function renderCarteChips() {
  $('carte-chip-row').innerHTML = CATS.map(
    (c) => `<div class="chip ${state.mapCat === c.v ? 'active' : ''}" data-mapcat="${c.v}">${c.l}</div>`
  ).join('');
}

function refreshCarte() {
  renderCarteChips();
  mapController?.setEvents(topMapEvents());
  $('carte-list').innerHTML = topMapEvents().slice(0, 6).map(cardHTML).join('');
}

function showCarteTab() {
  if (!mapController) {
    mapController = setupMap('leaflet-map', (id) => openDetail(id));
    mapController.setEvents(topMapEvents());
  }
  renderCarteChips();
  requestAnimationFrame(() => mapController?.invalidateSize());
}

async function loadEvents() {
  $('accueil-list').innerHTML = '<div class="load-state">Chargement des sorties…</div>';
  try {
    const res = await fetch(`${computeBasePath()}data/events.json`, { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const file = (await res.json()) as EventsFile;
    state.events = file.events;
  } catch (err) {
    console.error('Impossible de charger data/events.json', err);
    $('accueil-list').innerHTML = '<div class="load-state error">Impossible de charger les données. Vérifie ta connexion, ou relance le scraper (npm run refresh-data).</div>';
    state.events = [];
  }
  renderAll();
  mapController?.setEvents(topMapEvents());
  return routeFromLocation();
}

// Ouvre directement la fiche correspondant à /spectacle/<slug>/ si l'URL
// courante en pointe une (partage, lien indexé) — appelé une fois les
// événements chargés puisque la résolution dépend de state.events.
function routeFromLocation(): boolean {
  const base = computeBasePath();
  const path = window.location.pathname;
  if (!path.startsWith(`${base}spectacle/`)) return false;
  const rest = path.slice(`${base}spectacle/`.length);
  const slug = rest.split('/')[0];
  if (!slug) return false;
  const id = idFromSlug(decodeURIComponent(slug));
  if (!state.events.some((e) => e.id === id)) return false;
  openDetail(id, { updateUrl: false });
  return true;
}

window.addEventListener('popstate', () => {
  const opened = routeFromLocation();
  if (!opened) closeSheets({ updateUrl: false });
});

async function handleSignIn() {
  const email = ($('account-email-input') as HTMLInputElement).value.trim();
  const password = ($('account-password-input') as HTMLInputElement).value;
  const error = await signIn(email, password);
  if (error) renderAccountSheet(error);
  else closeSheets();
}

async function handleSignUp() {
  const email = ($('account-email-input') as HTMLInputElement).value.trim();
  const password = ($('account-password-input') as HTMLInputElement).value;
  const error = await signUp(email, password);
  if (error) {
    renderAccountSheet(error);
    return;
  }
  renderAccountSheet();
  $('account-content').insertAdjacentHTML(
    'afterbegin',
    '<p class="form-note">Compte créé. Si la confirmation par email est activée sur le projet, vérifie ta boîte mail avant de te connecter.</p>'
  );
}

async function handleSavePrefs() {
  if (!currentSession) return;
  const favoriteCategories = [...document.querySelectorAll<HTMLElement>('#pref-categories .sel')].map(
    (el) => el.dataset.prefCat as Category
  );
  const homeZoneEl = document.querySelector<HTMLElement>('#pref-zone .sel');
  const homeZone = (homeZoneEl?.dataset.prefZone as Zone | undefined) ?? null;
  currentPrefs = { ...currentPrefs, favoriteCategories, homeZone };
  await savePreferences(currentSession.user.id, currentPrefs);
  renderAll();
  closeSheets();
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
    if (state.favorites.has(id)) {
      state.favorites.delete(id);
    } else {
      state.favorites.add(id);
      const favorited = state.events.find((x) => x.id === id);
      if (favorited) recordAffinity(favorited, 3);
    }
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

  const shareBtn = target.closest<HTMLElement>('#share-event');
  if (shareBtn) {
    void shareCurrentEvent(shareBtn);
    return;
  }

  const shareFavBtn = target.closest<HTMLElement>('#share-favorites');
  if (shareFavBtn) {
    void shareFavorites(shareFavBtn);
    return;
  }

  if (target.closest('#near-me-btn')) {
    toggleNearMe();
    return;
  }

  const whenChip = target.closest<HTMLElement>('[data-when]');
  if (whenChip) {
    state.filters.when = state.filters.when === whenChip.dataset.when ? null : whenChip.dataset.when!;
    listPageSize.delete('explorer-list');
    renderExplorer();
    return;
  }

  const tagChip = target.closest<HTMLElement>('[data-tag]');
  if (tagChip) {
    state.tag = state.tag === tagChip.dataset.tag ? null : tagChip.dataset.tag!;
    listPageSize.delete('explorer-list');
    renderExplorer();
    return;
  }

  const mapCatChip = target.closest<HTMLElement>('[data-mapcat]');
  if (mapCatChip) {
    state.mapCat = mapCatChip.dataset.mapcat as Category | 'all';
    refreshCarte();
    return;
  }

  const chip = target.closest<HTMLElement>('.chip');
  if (chip) {
    state.cat = chip.dataset.cat as Category | 'all';
    state.tag = null;
    listPageSize.delete('explorer-list');
    renderExplorer();
    return;
  }

  if (target.closest('#open-filters')) {
    openSheet('filter-sheet');
    return;
  }
  if (target.closest('#open-account')) {
    renderAccountSheet();
    openSheet('account-sheet');
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

  const prefCat = target.closest<HTMLElement>('[data-pref-cat]');
  if (prefCat) {
    prefCat.classList.toggle('sel');
    return;
  }
  const prefZone = target.closest<HTMLElement>('[data-pref-zone]');
  if (prefZone) {
    prefZone.parentElement!.querySelectorAll('[data-pref-zone]').forEach((o) => o.classList.remove('sel'));
    prefZone.classList.add('sel');
    return;
  }
  if (target.closest('#account-google')) {
    void signInWithGoogle();
    return;
  }
  if (target.closest('#account-continue-guest')) {
    localStorage.setItem(WELCOME_SEEN_KEY, '1');
    closeSheets();
    return;
  }
  if (target.closest('#account-signin')) {
    void handleSignIn();
    return;
  }
  if (target.closest('#account-signup')) {
    void handleSignUp();
    return;
  }
  if (target.closest('#account-signout')) {
    void signOut();
    closeSheets();
    return;
  }
  if (target.closest('#account-save-prefs')) {
    void handleSavePrefs();
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

onAuthStateChange(async (session) => {
  currentSession = session;
  updateAccountButton();
  if (session) {
    currentPrefs = await loadPreferences(session.user.id);
    state.favorites = new Set(currentPrefs.favoriteEventIds);
  } else {
    currentPrefs = EMPTY_PREFS;
    state.favorites = loadFavorites();
  }
  renderAll();
});

async function maybeShowWelcome() {
  if (localStorage.getItem(WELCOME_SEEN_KEY)) return;
  const session = await getSession();
  if (session) {
    localStorage.setItem(WELCOME_SEEN_KEY, '1');
    return;
  }
  renderAccountSheet();
  openSheet('account-sheet');
}

setGreeting();
void loadEvents().then((routed) => {
  const selectionOpened = maybeOpenSharedSelection();
  if (!routed && !selectionOpened) void maybeShowWelcome();
});
