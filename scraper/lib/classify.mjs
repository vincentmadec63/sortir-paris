// Classification par mots-clés : le dataset public OpenAgenda mélange tout type
// d'événement (emploi, administratif, culturel...). On ne garde que ce qui
// correspond à nos 5 catégories, et on écarte le bruit évident en premier.

function normalize(text) {
  return (text ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}

const EXCLUDE_KEYWORDS = [
  'emploi', 'recrut', 'job dating', 'jobdating', 'formation professionnelle',
  'cpf', 'bilan de competences', 'retraite', 'agirc', 'arrco',
  'assemblee generale', 'conseil municipal', 'permanence', 'alternance',
  'apprentissage', 'immobilier', 'notaire', 'succession', 'impots',
  'declaration fiscale', 'vaccination', 'depistage', 'don du sang',
  'equipier polyvalent', 'offre d\'emploi',
];

// Ordre = priorité de classement quand plusieurs catégories matchent.
const CATEGORY_KEYWORDS = [
  ['standup', ['stand-up', 'stand up', 'one-man-show', 'one-woman-show', 'cafe-theatre',
    'improvisation', 'impro', 'humoriste', 'plateau d\'humour', 'soiree humour']],
  ['theatre', ['theatre', 'piece de theatre', 'comedie', 'tragedie', 'moliere',
    'dramaturgie', 'mise en scene']],
  ['concert', ['concert', 'recital', 'set acoustique', 'tournee', 'dj set',
    'musique live', 'symphonique', 'philharmonique']],
  ['ephemere', ['ephemere', 'pop-up', 'pop up', 'popup', 'concept store', 'boutique ephemere',
    'bar ephemere', 'corner ephemere', 'flagship ephemere', 'showroom ephemere',
    'restaurant ephemere', 'cantine ephemere', 'friperie ephemere', 'marche ephemere',
    'boutique temporaire', 'store temporaire', 'espace ephemere', 'lieu ephemere',
    'marche de noel', 'experience immersive ephemere']],
  ['evenement', ['festival', 'exposition', 'vernissage', 'biennale', 'nocturne',
    'spectacle', 'cirque', 'danse', 'opera', 'ballet', 'projection',
    'avant-premiere', 'patrimoine', 'salon du livre',
    'marche nocturne']],
];

export function isExcluded(text) {
  const n = normalize(text);
  return EXCLUDE_KEYWORDS.some((k) => n.includes(k));
}

export function classify(text) {
  const n = normalize(text);
  for (const [category, keywords] of CATEGORY_KEYWORDS) {
    if (keywords.some((k) => n.includes(k))) return category;
  }
  return null;
}
