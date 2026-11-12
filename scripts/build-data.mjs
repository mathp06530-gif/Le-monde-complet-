// Génère les jeux de données compacts servis par l'application (public/data).
//
// Sources :
//  - Natural Earth (domaine public) : pays (1:50m) et régions/états (1:10m)
//  - GeoNames (CC BY 4.0) via les paquets npm `all-the-cities` et `cities.json`
//
// Usage : npm run data
import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile, access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import mapshaper from 'mapshaper';
import { geoBounds, geoContains } from 'd3-geo';
import { feature } from 'topojson-client';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cacheDir = path.join(root, '.cache', 'natural-earth');
const outDir = path.join(root, 'public', 'data');

const NE_BASE = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson';
const NE_COUNTRIES = 'ne_50m_admin_0_countries.geojson';
const NE_REGIONS = 'ne_10m_admin_1_states_provinces.geojson';

const CONTINENTS_FR = {
  Africa: 'Afrique',
  Antarctica: 'Antarctique',
  Asia: 'Asie',
  Europe: 'Europe',
  'North America': 'Amérique du Nord',
  Oceania: 'Océanie',
  'South America': 'Amérique du Sud',
  'Seven seas (open ocean)': 'Îles océaniques',
};

async function fetchCached(name) {
  const file = path.join(cacheDir, name);
  try {
    await access(file);
  } catch {
    console.log(`Téléchargement de ${name}…`);
    const res = await fetch(`${NE_BASE}/${name}`);
    if (!res.ok) throw new Error(`${name}: HTTP ${res.status}`);
    await mkdir(cacheDir, { recursive: true });
    await writeFile(file, Buffer.from(await res.arrayBuffer()));
  }
  return JSON.parse(await readFile(file, 'utf8'));
}

const round = (v, d) => {
  const f = 10 ** d;
  return Math.round(v * f) / f;
};

async function toTopojson(geojson, simplify) {
  const out = await mapshaper.applyCommands(
    `-i in.json ${simplify} -o out.json format=topojson quantization=100000`,
    { 'in.json': JSON.stringify(geojson) },
  );
  return JSON.parse(out['out.json'].toString());
}

/** Boîte englobante [ouest, sud, est, nord] ; ouest > est si l'antiméridien est franchi. */
function bbox(f) {
  const [[w, s], [e, n]] = geoBounds(f);
  return [w, s, e, n];
}
function inBbox([w, s, e, n], lng, lat) {
  if (lat < s || lat > n) return false;
  return w <= e ? lng >= w && lng <= e : lng >= w || lng <= e;
}

await mkdir(outDir, { recursive: true });

// ---------------------------------------------------------------- Pays
const neCountries = await fetchCached(NE_COUNTRIES);
const cities = require('all-the-cities');
const capitals = new Map(
  cities.filter((c) => c.featureCode === 'PPLC').map((c) => [c.country, c.name]),
);

const countries = {
  type: 'FeatureCollection',
  features: neCountries.features.map((f) => {
    const p = f.properties;
    const a2 = p.ISO_A2_EH && p.ISO_A2_EH !== '-99' ? p.ISO_A2_EH : p.ISO_A2;
    return {
      type: 'Feature',
      geometry: f.geometry,
      properties: {
        name: p.NAME_FR || p.NAME,
        nameEn: p.NAME,
        a2: a2 === '-99' ? '' : a2,
        a3: p.ADM0_A3,
        pop: Math.round(p.POP_EST) || 0,
        continent: CONTINENTS_FR[p.CONTINENT] ?? p.CONTINENT,
        subregion: p.SUBREGION,
        capital: capitals.get(a2) ?? '',
        lat: round(p.LABEL_Y, 3),
        lng: round(p.LABEL_X, 3),
      },
    };
  }),
};
const countriesTopo = await toTopojson(countries, '');
await writeFile(path.join(outDir, 'countries.json'), JSON.stringify(countriesTopo));
console.log(`Pays : ${countries.features.length}`);

// ------------------------------------------------------------- Régions
const neRegions = await fetchCached(NE_REGIONS);
const regions = {
  type: 'FeatureCollection',
  features: neRegions.features
    .filter((f) => f.geometry && (f.properties.name || f.properties.name_en))
    .map((f) => {
      const p = f.properties;
      return {
        type: 'Feature',
        geometry: f.geometry,
        properties: {
          name: p.name_fr || p.name || p.name_en,
          nameEn: p.name_en || p.name,
          a3: p.adm0_a3,
          type: p.type_en || '',
          gn: p.gn_a1_code || '',
          lat: round(p.latitude, 3),
          lng: round(p.longitude, 3),
        },
      };
    }),
};
const regionsTopo = await toTopojson(regions, '-simplify 12% keep-shapes');
// `gn` ne sert qu'au rattachement des villes : on le retire du fichier publié.
const regionFeatures = feature(regionsTopo, regionsTopo.objects.in).features;
const gnToRegion = new Map();
regionFeatures.forEach((f, i) => {
  if (f.properties.gn) gnToRegion.set(f.properties.gn, i);
});
for (const g of regionsTopo.objects.in.geometries) delete g.properties.gn;
await writeFile(path.join(outDir, 'regions.json'), JSON.stringify(regionsTopo));
console.log(`Régions : ${regionFeatures.length}`);

// -------------------------------------------------------------- Villes
const a2ToCountry = new Map();
const a3ToCountry = new Map();
countries.features.forEach((f, i) => {
  if (f.properties.a2) a2ToCountry.set(f.properties.a2, i);
  a3ToCountry.set(f.properties.a3, i);
});

// Index spatial grossier des régions (cases de 2°) pour le point-dans-polygone.
const CELL = 2;
const grid = new Map();
const regionBoxes = regionFeatures.map(bbox);
regionBoxes.forEach(([w, s, e, n], i) => {
  const spans =
    w <= e
      ? [[w, e]]
      : [
          [w, 180],
          [-180, e],
        ];
  for (const [x0, x1] of spans) {
    for (let x = Math.floor(x0 / CELL); x <= Math.floor(x1 / CELL); x++) {
      for (let y = Math.floor(s / CELL); y <= Math.floor(n / CELL); y++) {
        const k = `${x},${y}`;
        if (!grid.has(k)) grid.set(k, []);
        grid.get(k).push(i);
      }
    }
  }
});

function findRegion(lng, lat, gnCode) {
  // La géométrie fait foi ; le code GeoNames ne sert que de repli (villes
  // côtières tombant hors des polygones simplifiés), car il ne désigne pas
  // toujours le même niveau administratif que Natural Earth.
  const cands = grid.get(`${Math.floor(lng / CELL)},${Math.floor(lat / CELL)}`) ?? [];
  for (const i of cands) {
    if (inBbox(regionBoxes[i], lng, lat) && geoContains(regionFeatures[i], [lng, lat])) return i;
  }
  return gnToRegion.get(gnCode) ?? -1;
}

const sorted = [...cities].sort((a, b) => b.population - a.population);
const out = { name: [], lat: [], lng: [], pop: [], country: [], region: [], capital: [] };
let orphanCountry = 0;
let orphanRegion = 0;
sorted.forEach((c, i) => {
  const [lng, lat] = c.loc.coordinates;
  const region = findRegion(lng, lat, `${c.country}.${c.adminCode}`);
  let country = a2ToCountry.get(c.country) ?? -1;
  if (country < 0 && region >= 0) {
    country = a3ToCountry.get(regionFeatures[region].properties.a3) ?? -1;
  }
  if (country < 0) orphanCountry++;
  if (region < 0) orphanRegion++;
  out.name.push(c.name);
  out.lat.push(round(lat, 4));
  out.lng.push(round(lng, 4));
  out.pop.push(c.population);
  out.country.push(country);
  out.region.push(region);
  if (c.featureCode === 'PPLC') out.capital.push(i);
});
await writeFile(path.join(outDir, 'cities.json'), JSON.stringify(out));
console.log(
  `Villes : ${sorted.length} (sans pays : ${orphanCountry}, sans région : ${orphanRegion})`,
);
