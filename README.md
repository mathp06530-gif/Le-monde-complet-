# 🌍 Le Monde Complet

Globe terrestre 3D interactif, dans le navigateur : **242 pays et territoires**,
**4 589 régions** (états, provinces, départements…) et **199 568 villes et villages**.

## Fonctionnalités

**Vue orbitale (globe)**

- Terre photo-réaliste : alternance jour/nuit calculée d'après la position
  réelle du Soleil, lumières des villes côté nuit, nuages, relief, reflets sur
  les océans, atmosphère
- Frontières des pays et des régions ; toutes les villes et tous les villages de plus
  de 500 habitants, qui apparaissent au fur et à mesure du zoom
- Trois niveaux administratifs quand ils existent : pays › région › département
  (France, Italie, Espagne, Royaume-Uni…)

**Vue au sol**

- En zoomant jusqu'au bout (ou via « Descendre au sol »), le globe laisse place
  à l'imagerie satellite drapée sur le relief, avec bâtiments 3D, noms de rues
  et de lieux
- Mode « Marcher » : déplacement libre à hauteur de rue, au clavier (ZQSD ou
  flèches) ou avec les flèches tactiles
- Liens directs vers les photos de rue (Google Street View, Mapillary)
- Lieux scannés en 3D (Gaussian splats, par exemple publiés sur SuperSplat /
  PlayCanvas) : on colle le lien d'un scan sur la fiche d'une ville et il
  s'ouvre dans la visionneuse intégrée

**Recherche et navigation**

- Recherche instantanée des pays, régions et villes (sans tenir compte des
  accents ; on peut préciser le lieu, par exemple « mons var »), plus une recherche mondiale en ligne pour les adresses, villages et
  monuments
- Fiches d'information (capitale, population, coordonnées)
- Interface de style terminal, utilisable sur mobile

## Développement

Prérequis : Node.js 22 ou plus.

```bash
npm install
npm run dev        # serveur de développement
npm run build      # build de production dans dist/
npm run preview    # prévisualiser le build
```

| Commande            | Rôle                                   |
| ------------------- | -------------------------------------- |
| `npm run lint`      | ESLint                                 |
| `npm run format`    | Prettier                               |
| `npm run typecheck` | Vérification TypeScript                |
| `npm test`          | Tests unitaires (Vitest)               |
| `npm run data`      | Régénère les données de `public/data/` |

## Architecture

| Fichier                  | Rôle                                                        |
| ------------------------ | ----------------------------------------------------------- |
| `scripts/build-data.mjs` | Télécharge, simplifie et compacte les données sources       |
| `src/data.ts`            | Chargement, index et requêtes spatiales (pays/région/ville) |
| `src/globe.ts`           | Globe 3D et couches (frontières, villes, surbrillance)      |
| `src/labels.ts`          | Noms affichés sur le globe, sans chevauchement              |
| `src/search.ts`          | Recherche                                                   |
| `src/panel.ts`           | Panneau latéral (accueil et fiches)                         |
| `src/geo.ts`             | Utilitaires purs (testés)                                   |

Pile technique : Vite, TypeScript, [globe.gl](https://globe.gl) / Three.js,
[MapLibre GL JS](https://maplibre.org), d3-geo, TopoJSON.

Pour livrer des scans 3D avec l'application, ajoutez-les à
`public/data/scans.json` sous la forme
`[{ "name": "…", "url": "https://…", "lat": 48.8, "lng": 2.1 }]`.

## Déploiement

Le workflow `.github/workflows/deploy.yml` publie le site sur GitHub Pages à
chaque push sur `main` (ou à la demande, depuis l'onglet Actions). Il faut activer une fois Pages dans les réglages du
dépôt : _Settings › Pages › Source : GitHub Actions_.

## Données et crédits

- Pays et régions : [Natural Earth](https://www.naturalearthdata.com/) (domaine public)
- Villes et villages : [GeoNames](https://www.geonames.org/) « cities500 » (CC BY 4.0), via le
  paquet `cities-500-structured`
- Textures du globe : NASA Blue Marble / Black Marble, via `three-globe`
- Imagerie satellite de la vue au sol : Esri World Imagery (Esri, Maxar,
  Earthstar Geographics) — soumise aux conditions d'utilisation d'Esri
- Rues, bâtiments et noms de lieux : © contributeurs
  [OpenStreetMap](https://www.openstreetmap.org/copyright), tuiles
  [OpenFreeMap](https://openfreemap.org)
- Relief : Mapzen / AWS Terrain Tiles
- Recherche mondiale : Nominatim (OpenStreetMap)

La vue au sol et la recherche mondiale nécessitent une connexion Internet : ces
données sont chargées à la demande depuis les services ci-dessus.

Les frontières sont celles de Natural Earth et n'expriment aucune position sur
les territoires disputés.
