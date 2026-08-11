const USER_AGENT = 'sortir-paris-mvp/0.1 (usage personnel, contact: vincentmadec63@gmail.com)';

export async function fetchText(url) {
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT, 'Accept-Language': 'fr-FR,fr;q=0.9' } });
  if (!res.ok) throw new Error(`HTTP ${res.status} sur ${url}`);
  return res.text();
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Limite le nombre d'appels concurrents à `fn` sur `items`, pour rester
// courtois avec les serveurs qu'on interroge (pas de rafale illimitée).
export async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const i = cursor++;
      try {
        results[i] = await fn(items[i], i);
      } catch (err) {
        console.warn(`  ⚠ échec sur l'item ${i}:`, err.message);
        results[i] = null;
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}
