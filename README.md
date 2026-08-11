# Sortir Paris

PWA (installable sur iPhone et utilisable sur ordinateur) qui agrège théâtre,
stand-up, concerts, concepts éphémères et événements sur Paris + grande
couronne, avec filtres par tags, favoris locaux, et redirection vers la
billetterie du partenaire (pas d'achat ni de compte dans l'app).

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

**Limites connues à ce stade** (à améliorer dans les prochaines sessions) :
- Billetreduc et TheaterOnline peuvent lister le même spectacle séparément
  (deux fiches, deux billetteries) — pas de déduplication inter-sources pour
  l'instant.
- La classification par mots-clés d'OpenAgenda n'est pas parfaite (ex : un
  film peut être mal classé si sa description contient un mot ambigu).
- Le prix est parfois absent selon la source ; affiché "Tarif à vérifier"
  dans ce cas.
- Le scraping Billetreduc/TheaterOnline respecte les robots.txt et reste
  volontairement limité en nombre de pages par catégorie (usage personnel,
  pas de charge excessive sur leurs serveurs).

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

Voir le plan de session pour la feuille de route complète : connecteur
Eventbrite, enrichissement avis/notes, scraping des grosses billetteries
(Fnac, Billetreduc, TheaterOnline) un site à la fois, favoris déjà en place
côté PWA, notifications push (iOS 16.4+).
