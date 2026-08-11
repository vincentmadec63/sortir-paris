// Billetreduc encode le "+" de "ld+json" en entité HTML dans l'attribut type,
// d'où le pattern un peu inhabituel ci-dessous.
const SCRIPT_RE = /<script type="application\/ld(?:\+|&#x2B;)json"[^>]*>([\s\S]*?)<\/script>/g;

export function extractJsonLd(html) {
  const blocks = [];
  let m;
  const re = new RegExp(SCRIPT_RE);
  while ((m = re.exec(html))) {
    try {
      blocks.push(JSON.parse(m[1].trim()));
    } catch {
      // bloc mal formé, on l'ignore plutôt que de faire échouer tout le run
    }
  }
  return blocks;
}

export function findByType(blocks, type) {
  return blocks.find((b) => {
    const t = b?.['@type'];
    return t === type || (Array.isArray(t) && t.includes(type));
  });
}
