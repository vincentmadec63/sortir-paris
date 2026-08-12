# Sortir Paris

PWA (installable sur iPhone et utilisable sur ordinateur) qui agrège théâtre,
stand-up, concerts, pop-up stores et événements sur Paris + grande couronne,
avec filtres par tags, carte interactive, favoris et préférences
synchronisées via compte (email/mot de passe ou Google, optionnel — mode
invité toujours disponible), un profil éditable à tout moment pour affiner
les recommandations, et redirection vers la billetterie du partenaire pour
l'achat (pas de paiement dans l'app).

## En local

```bash
npm install
npm run dev            # prévisualiser l'app sur http://localhost:5173
npm run refresh-data   # relance les 3 connecteurs + fusion (écrit public/data/events.json)
npm run build           # build de production dans dist/
```

## D'où viennent les données

Trois sources, fusionnées par `scraper/merge.mjs` :

- **[OpenAgenda](https://public.opendatasoft.com/explore/dataset/evenements-publics-openagenda/)**
  (mirroir public Opendatasoft, accès anonyme) — uniquement pour les
  catégories "concept éphémère" et "événement", qu'il couvre mieux qu'une
  billetterie. Classement par mots-clés.
- **[Billetreduc](https://www.billetreduc.com)** — théâtre, stand-up, concerts
  à Paris. Catégorisation directe via les pages `/theatre`, `/humour`,
  `/comedy-clubs`, `/concerts` du site (pas de devinette par mots-clés), prix
  et avis (échelle /10 convertie sur 5) lus dans le JSON-LD des fiches.
- **[TheaterOnline](https://www.theatreonline.com)** — théâtre, stand-up,
  concerts à Paris, en complément de Billetreduc (parfois d'autres salles,
  d'autres avis). Genres `comedie-boulevard`, `contemporain`, `classique`,
  `musique-danse`, `humour-cafe-theatre`. Données lues dans les microdonnées
  schema.org du HTML (le site n'expose pas de JSON-LD).

Règles communes appliquées par tous les connecteurs : **pas de photo → pas de
fiche**, et la catégorie **stand-up est filtrée à Paris intra-muros**
uniquement (pas de couronne).

**Badge "★ Coup de cœur"** : aucune source n'a de vraie donnée "prix/
récompense" (pas de Molières etc.). Ce badge reflète les pages éditoriales
publiques de TheaterOnline ("Coups de cœur" / "Succès du moment") — une
reconnaissance réelle mais pas un prix officiel, étiqueté comme tel plutôt
que présenté comme une récompense. Filtre disponible dans la feuille de
filtres d'Explorer.

Les doublons entre sources (même spectacle listé par deux billetteries) sont
fusionnés par titre normalisé dans `scraper/merge.mjs` (garde la fiche la
plus riche en infos). Chaque événement est géolocalisé (`lat`/`lng`) —
précisément quand la source le fournit, sinon via un centroïde
d'arrondissement/département (`scraper/lib/geocode.mjs`), utilisé par la
carte (Leaflet + OpenStreetMap, `src/map.ts`).

**Limites connues à ce stade** (à améliorer dans les prochaines sessions) :
- La classification par mots-clés d'OpenAgenda n'est pas parfaite (ex : un
  film peut être mal classé si sa description contient un mot ambigu).
- Le prix est parfois absent selon la source ; affiché "Tarif à vérifier"
  dans ce cas.
- Pas de source dédiée trouvée pour les pop-up stores parisiens qui soit
  scrapable sans navigateur headless (Sortiraparis rend ses résultats de
  recherche en JavaScript) — la couverture de cette catégorie reste modeste,
  via les mentions "éphémère"/"pop-up" dans OpenAgenda.
- Le scraping Billetreduc/TheaterOnline respecte les robots.txt et reste
  volontairement limité en nombre de pages par catégorie (usage personnel,
  pas de charge excessive sur leurs serveurs).

## Comptes utilisateurs (Supabase)

Sans configuration, l'app fonctionne normalement en mode invité (favoris en
local sur l'appareil, pas de préférences par défaut). Pour activer les vrais
comptes (email/mot de passe, préférences synchronisées entre appareils) :

1. Crée un compte sur **[supabase.com](https://supabase.com)** (gratuit, pas
   de carte bancaire requise) → **New project** → nomme-le, choisis un mot de
   passe de base de données, région Europe.
2. Une fois le projet créé, ouvre **SQL Editor** → colle le contenu de
   [`supabase/schema.sql`](supabase/schema.sql) → **Run**. Ça crée la table
   `preferences` avec les règles de sécurité (chaque utilisateur ne voit que
   ses propres données).
3. Dans **Project Settings → API**, récupère **Project URL** et la clé
   **anon public** (jamais la `service_role`).
4. En local : copie `.env.example` en `.env`, renseigne les deux valeurs.
   `npm run dev`/`npm run build` les prendront en compte automatiquement.
5. Sur GitHub : **Settings → Secrets and variables → Actions → New repository
   secret**, ajoute `VITE_SUPABASE_URL` et `VITE_SUPABASE_ANON_KEY` avec les
   mêmes valeurs. Le workflow `deploy.yml` les injecte au build. Repousse
   (ou relance le workflow) pour que le site déployé les prenne en compte.

Tant que ces secrets ne sont pas renseignés, le bouton compte affiche un
message "connexion pas encore activée" et l'app continue de fonctionner
normalement en mode invité — rien ne casse.

À l'ouverture de l'app (une seule fois, tant qu'aucun compte n'est créé), un
écran de connexion s'affiche avec la possibilité de continuer sans compte —
ce choix est mémorisé sur l'appareil et ne redemande plus rien ensuite, sauf
geste volontaire sur le bouton compte.

### Connexion Google

En plus d'email/mot de passe, un bouton "Continuer avec Google" est prévu.
Pour l'activer (gratuit, deux étapes après avoir configuré Supabase
ci-dessus) :

1. Sur **[console.cloud.google.com](https://console.cloud.google.com)** :
   crée un projet (ou réutilise-en un), puis **APIs & Services → OAuth
   consent screen** (type "External", renseigne juste le nom de l'app et ton
   email), puis **Credentials → Create Credentials → OAuth client ID** (type
   "Web application"). Dans **Authorized redirect URIs**, colle l'URL de
   callback Supabase — tu la trouves dans Supabase sous **Authentication →
   Providers → Google** (généralement
   `https://<ton-projet>.supabase.co/auth/v1/callback`).
2. Copie le **Client ID** et le **Client Secret** générés, colle-les dans
   Supabase (**Authentication → Providers → Google**, active le toggle, colle
   les deux valeurs, **Save**).

Rien à changer côté code — dès que c'est configuré côté Supabase, le bouton
Google fonctionne.

### KYC / profil (âge, centres d'intérêt, humour, spectacle)

À la première connexion (email ou Google), un court formulaire s'affiche
pour choisir : tranche d'âge, catégories qui intéressent (réutilise les tags
existants), type d'humour préféré (si stand-up coché), type de spectacle
préféré (si théâtre coché), et zone "chez moi". Modifiable à tout moment via
**Compte → Modifier mon profil**. Ces informations affinent la sélection sur
l'écran Accueil (catégories/zone en filtre, humour/spectacle en tri de
préférence par correspondance de mots-clés — pas un filtrage strict, voir
limites plus haut).

## Mettre en ligne (gratuit, via GitHub)

1. Crée un compte GitHub si tu n'en as pas, puis un nouveau repo (public ou
   privé, les deux fonctionnent avec les Actions gratuites).
2. Pousse ce projet :
   ```bash
   git remote add origin https://github.com/<toi>/<ton-repo>.git
   git branch -M main
   git push -u origin main
   ```
3. Dans les réglages du repo → **Pages**, choisis la source **GitHub
   Actions**.
4. Le workflow `deploy.yml` publie automatiquement l'app à chaque push sur
   `main`. Le workflow `refresh-data.yml` relance le connecteur deux fois
   par jour (6h et 16h UTC) et pousse les nouvelles données, ce qui redéclenche
   un déploiement.
5. Une fois en ligne, ouvre l'URL `https://<toi>.github.io/<ton-repo>/` sur
   iPhone dans Safari → partager → "Sur l'écran d'accueil" pour l'installer
   comme une app.

## Prochaines étapes

- Configurer Supabase + Google OAuth (voir plus haut) pour activer les
  comptes en production.
- Sign in with Apple (reporté — nécessite un compte Apple Developer payant,
  99$/an).
- Meilleure source pour les pop-up stores (dossier dédié à creuser :
  scraping avec navigateur headless, ou une source structurée pas encore
  identifiée).
- Matching humour/spectacle plus fin : capturer les sous-genres déjà exposés
  par Billetreduc/TheaterOnline (ex. `humour-noir`, `comedie-boulevard`) au
  lieu du simple mot-clé dans le titre/description.
- Notifications push (Web Push sur PWA iOS — nécessite iOS 16.4+).
- Connecteur Eventbrite en complément.
