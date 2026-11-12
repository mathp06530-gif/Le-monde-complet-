# 🌍 Le Monde Complet

Globe terrestre 3D interactif, dans le navigateur : **242 pays et territoires**,
**4 589 régions** (états, provinces, départements…) et **135 233 villes**.

## Fonctionnalités

- Globe 3D (texture NASA Blue Marble, relief, atmosphère, mode nuit)
- Frontières des pays et des régions
- Toutes les villes de plus de 1 000 habitants : elles apparaissent au fur et à
  mesure du zoom, les plus peuplées d'abord
- Recherche instantanée d'un pays, d'une région ou d'une ville (sans tenir
  compte des accents)
- Clic sur le globe : fiche du pays, de la région ou de la ville (capitale,
  population, coordonnées, lien OpenStreetMap)
- Navigation hiérarchique : continent › pays › région › ville
- Utilisable sur mobile

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
d3-geo, TopoJSON.

## Déploiement

Le workflow `.github/workflows/deploy.yml` publie le site sur GitHub Pages à
chaque push sur `main`. Il faut activer une fois Pages dans les réglages du
dépôt : _Settings › Pages › Source : GitHub Actions_.

## Données et crédits

- Pays et régions : [Natural Earth](https://www.naturalearthdata.com/) (domaine public)
- Villes : [GeoNames](https://www.geonames.org/) (CC BY 4.0), via le paquet `all-the-cities`
- Textures : NASA Blue Marble / Black Marble, via `three-globe`

Les frontières sont celles de Natural Earth et n'expriment aucune position sur
les territoires disputés.
