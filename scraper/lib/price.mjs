// Le dataset public n'a pas de champ prix structuré : on essaie d'en extraire
// un depuis le texte libre "conditions_fr". Si on ne trouve rien de fiable,
// on renvoie price:null plutôt que de deviner un montant.
export function parsePrice(conditionsText) {
  const text = (conditionsText ?? '').trim();
  if (!text) return { price: null, priceLabel: 'Tarif à vérifier' };

  if (/\b(gratuit|entr[ée]e? libre)\b/i.test(text)) {
    return { price: 0, priceLabel: 'Gratuit' };
  }

  const match = text.match(/(\d+(?:[.,]\d{1,2})?)\s?€/);
  if (match) {
    const amount = parseFloat(match[1].replace(',', '.'));
    const prefix = /partir de|d[eè]s/i.test(text) ? 'à partir de ' : '';
    return { price: amount, priceLabel: `${prefix}${amount}€` };
  }

  return { price: null, priceLabel: text.length <= 40 ? text : 'Tarif à vérifier' };
}
