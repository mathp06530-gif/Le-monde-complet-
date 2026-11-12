// Génère les jeux de données compacts servis par l'application (public/data).
//
// Sources :
//  - Natural Earth (domaine public) : pays (1:50m) et régions/états (1:10m)
//  - GeoNames « cities500 » (CC BY 4.0) : lieux habités de plus de 500 habitants,
//    via le paquet npm `cities-500-structured`
//
// Usage : npm run data
import { mkdir, readFile, writeFile, access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import mapshaper from 'mapshaper';
import { geoBounds, geoContains } from 'd3-geo';
import { feature } from 'topojson-client';

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
// Fichier tabulé GeoNames : nom (1), lat (4), lng (5), code de type (7),
// pays (8), code admin1 (10), population (14).
const cities = (
  await readFile(
    path.join(root, 'node_modules', 'cities-500-structured', 'dist', 'cities500.txt'),
    'utf8',
  )
)
  .split('\n')
  .filter(Boolean)
  .map((line) => {
    const f = line.split('\t');
    return {
      name: f[1],
      country: f[8],
      featureCode: f[7],
      adminCode: f[10],
      population: Number(f[14]) || 0,
      loc: { coordinates: [Number(f[5]), Number(f[4])] },
    };
  });
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
          // Niveau administratif supérieur quand il existe (ex. région d'un département).
          group: p.region || '',
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

// Territoires que GeoNames code à part mais que Natural Earth rattache à un État.
const A2_ALIASES = {
  GP: 'FR',
  MQ: 'FR',
  GF: 'FR',
  RE: 'FR',
  YT: 'FR',
  BQ: 'NL',
  CX: 'AU',
  CC: 'AU',
  TK: 'NZ',
  SJ: 'NO',
};

const sorted = [...cities].sort((a, b) => b.population - a.population);
const out = { name: [], lat: [], lng: [], pop: [], country: [], region: [], capital: [] };
sorted.forEach((c, i) => {
  const [lng, lat] = c.loc.coordinates;
  const region = findRegion(lng, lat, `${c.country}.${c.adminCode}`);
  let country = a2ToCountry.get(c.country) ?? a2ToCountry.get(A2_ALIASES[c.country]) ?? -1;
  if (country < 0 && region >= 0) {
    country = a3ToCountry.get(regionFeatures[region].properties.a3) ?? -1;
  }
  out.name.push(c.name);
  out.lat.push(round(lat, 4));
  out.lng.push(round(lng, 4));
  out.pop.push(c.population);
  out.country.push(country);
  out.region.push(region);
  if (c.featureCode === 'PPLC') out.capital.push(i);
});

// Villes côtières ou insulaires tombées hors des polygones simplifiés : on
// reprend la région de la ville rattachée la plus proche (même pays, < 80 km).
const cityGrid = new Map();
const cellOf = (lng, lat) => `${Math.floor(lng)},${Math.floor(lat)}`;
out.region.forEach((r, i) => {
  if (r < 0) return;
  const k = cellOf(out.lng[i], out.lat[i]);
  if (!cityGrid.has(k)) cityGrid.set(k, []);
  cityGrid.get(k).push(i);
});
const MAX_KM = 80;
let adopted = 0;
out.region.forEach((r, i) => {
  if (r >= 0) return;
  const lat = out.lat[i];
  const lng = out.lng[i];
  let best = -1;
  let bestKm = MAX_KM;
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      for (const j of cityGrid.get(cellOf(lng + dx, lat + dy)) ?? []) {
        if (out.country[j] !== out.country[i]) continue;
        const km = Math.hypot(
          (out.lat[j] - lat) * 111,
          (out.lng[j] - lng) * 111 * Math.cos((lat * Math.PI) / 180),
        );
        if (km < bestKm) {
          bestKm = km;
          best = j;
        }
      }
    }
  }
  if (best >= 0) {
    out.region[i] = out.region[best];
    adopted++;
  }
});
const orphanCountry = out.country.filter((c) => c < 0).length;
const orphanRegion = out.region.filter((r) => r < 0).length;
console.log(`Villes rattachées par proximité : ${adopted}`);
await writeFile(path.join(outDir, 'cities.json'), JSON.stringify(out));
console.log(
  `Villes : ${sorted.length} (sans pays : ${orphanCountry}, sans région : ${orphanRegion})`,
);
