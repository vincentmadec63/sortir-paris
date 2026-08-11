// Petit lecteur de microdonnées schema.org (itemscope/itemtype/itemprop),
// utilisé pour TheaterOnline qui n'expose pas de JSON-LD mais des
// attributs microdata directement dans le HTML.
import * as cheerio from 'cheerio';

function nearestScopeAncestor($, el) {
  let cur = el.parent();
  while (cur.length) {
    if (cur.attr('itemscope') !== undefined) return cur;
    cur = cur.parent();
  }
  return null;
}

function directPropElements($, scopeEl, prop) {
  return scopeEl
    .find(`[itemprop="${prop}"]`)
    .filter((_, node) => {
      const el = $(node);
      const ancestor = nearestScopeAncestor($, el);
      return ancestor && ancestor.get(0) === scopeEl.get(0);
    });
}

function elementValue($, el) {
  const tag = el.prop('tagName')?.toLowerCase();
  if (tag === 'meta') return el.attr('content') ?? '';
  if (tag === 'img') return el.attr('src') ?? '';
  if (tag === 'time') return el.attr('datetime') ?? el.text().trim();
  if (tag === 'a' || tag === 'link') return el.attr('href') ?? el.text().trim();
  return el.text().trim();
}

export function load(html) {
  return cheerio.load(html);
}

export function findScopes($, root, type) {
  return root.find(`[itemscope][itemtype*="schema.org/${type}"]`);
}

export function propValue($, scopeEl, prop) {
  const found = directPropElements($, scopeEl, prop);
  if (found.length === 0) return undefined;
  return elementValue($, found.first());
}

export function propValues($, scopeEl, prop) {
  const found = directPropElements($, scopeEl, prop);
  return found.toArray().map((node) => elementValue($, $(node)));
}

export function propScope($, scopeEl, prop) {
  const found = directPropElements($, scopeEl, prop);
  if (found.length === 0) return null;
  return found.first();
}

export function propScopes($, scopeEl, prop) {
  const found = directPropElements($, scopeEl, prop);
  return found.toArray().map((node) => $(node));
}
