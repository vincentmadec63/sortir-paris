# Sortir Paris

PWA (installable sur iPhone et utilisable sur ordinateur) qui agrège théâtre,
stand-up, concerts, concepts éphémères et événements sur Paris + grande
couronne, avec filtres par tags, favoris locaux, et redirection vers la
billetterie du partenaire (pas d'achat ni de compte dans l'app).

## En local

```bash
npm install
npm run dev              # prévisualiser l'app sur http://localhost:5173
npm run fetch:openagenda  # relancer le connecteur de données (écrit public/data/events.json)
npm run build             # build de production dans dist/
```

## D'où viennent les données

Pour ce premier MVP, une seule source : le [mirroir public OpenAgenda
hébergé par Opendatasoft](https://public.opendatasoft.com/explore/dataset/evenements-publics-openagenda/),
en accès anonyme (aucune clé API, aucun compte). Le connecteur
(`scraper/sources/openagenda.mjs`) :

1. interroge les événements à venir dans les 8 départements Paris + petite
   + grande couronne,
2. classe chaque événement dans une catégorie (théâtre / stand-up / concert /
   concept éphémère / événement) par mots-clés, en excluant le bruit évident
   (offres d'emploi, formations, réunions administratives...),
3. écrit `public/data/events.json`, consommé directement par la PWA.

**Limites connues à ce stade** (à améliorer dans les prochaines sessions) :
- La classification par mots-clés n'est pas parfaite (ex : un film peut être
  mal classé "théâtre" s'il contient le mot "comédie").
- Les concepts éphémères sont rares dans ce jeu de données — il faudra une
  source dédiée (ex : agendas municipaux, Instagram de lieux) pour vraiment
  bien couvrir cette catégorie.
- Pas de note/avis pour l'instant (OpenAgenda n'en fournit pas) — prévu en
  phase 2 avec une source d'avis dédiée.
- Le prix est extrait d'un champ texte libre quand c'est possible ; sinon
  affiché "Tarif à vérifier".

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
