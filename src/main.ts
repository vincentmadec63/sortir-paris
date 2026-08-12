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
  filters: Filters;
  favorites: Set<string>;
  query: string;
} = {
  events: [],
  cat: 'all',
  filters: { price: null, zone: null, rating: null, when: null, sort: null, highlight: null },
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

function cardHTML(e: EventItem): string {
  return `<div class="card cat-${e.category}" data-open="${e.id}">
    ${heart(e.id, state.favorites.has(e.id))}
    <img class="card-thumb" src="${e.imageUrl}" alt="${escapeHTML(e.title)}" width="64" height="64" loading="lazy" decoding="async" />
    <div class="card-body">
      <div class="card-top">
        <div>
          <div class="card-cat">${CATEGORY_LABELS[e.category]}${e.highlighted ? ' · <span class="highlight-badge">★ Coup de cœur</span>' : ''}</div>
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
  upcoming = upcoming.sort((a, b) => a.dateStart.localeCompare(b.dateStart)).slice(0, 8);
  $('screen-accueil').querySelector('.screen-sub')!.textContent = hasPrefs
    ? 'Sélection selon tes préférences.'
    : "Voici ce qu'il ne faut pas rater cette semaine.";
  $('accueil-list').innerHTML = upcoming.length
    ? upcoming.map(cardHTML).join('')
    : '<div class="empty-state">Aucun événement chargé pour l’instant.</div>';

  const ephemereList = state.events.filter((e) => e.category === 'ephemere');
  renderCardList('ephemere-list', ephemereList);
  $('ephemere-empty').hidden = ephemereList.length > 0;

  $('carte-list').innerHTML = topMapEvents().slice(0, 6).map(cardHTML).join('');
  renderExplorer();
  renderFavoris();
}

function renderExplorer() {
  $('chip-row').innerHTML = CATS.map(
    (c) => `<div class="chip ${state.cat === c.v ? 'active' : ''}" data-cat="${c.v}">${c.l}</div>`
  ).join('');
  document
    .querySelectorAll<HTMLElement>('#when-row [data-when]')
    .forEach((el) => el.classList.toggle('active', state.filters.when === el.dataset.when));
  const list = state.events.filter(matchesFilters);
  if (state.filters.sort === 'topRated') list.sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0));
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
    <div class="detail-cat">${CATEGORY_LABELS[e.category]}${e.verified ? ' · Vérifié via ' + escapeHTML(e.verifiedVia ?? e.sourceName) : ''}</div>
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
  localStorage.setItem(WELCOME_SEEN_KEY, '1');
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
// rien"). On ne garde que les mieux notés et les coups de cœur.
function topMapEvents(): EventItem[] {
  return [...state.events]
    .filter((e) => e.highlighted || (e.rating && (e.reviewsCount ?? 0) >= MAP_MIN_REVIEWS))
    .sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0))
    .slice(0, MAP_MAX_PINS);
}

function showCarteTab() {
  if (!mapController) {
    mapController = setupMap('leaflet-map', (id) => openDetail(id));
    mapController.setEvents(topMapEvents());
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
  mapController?.setEvents(topMapEvents());
}

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

  const whenChip = target.closest<HTMLElement>('[data-when]');
  if (whenChip) {
    state.filters.when = state.filters.when === whenChip.dataset.when ? null : whenChip.dataset.when!;
    listPageSize.delete('explorer-list');
    renderExplorer();
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
loadEvents();
void maybeShowWelcome();
