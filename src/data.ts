import { geoBounds, geoContains } from 'd3-geo';
import { feature, mesh } from 'topojson-client';
import type { Feature, MultiLineString, MultiPolygon, Polygon } from 'geojson';
import type { GeometryCollection, Topology } from 'topojson-specification';
import { angularDistance, inBBox, type BBox } from './geo';

export interface CountryProps {
  name: string;
  nameEn: string;
  a2: string;
  a3: string;
  pop: number;
  continent: string;
  subregion: string;
  capital: string;
  lat: number;
  lng: number;
}

export interface RegionProps {
  name: string;
  nameEn: string;
  a3: string;
  type: string;
  /** Niveau administratif supérieur (ex. région d'un département), ou ''. */
  group: string;
  lat: number;
  lng: number;
}

export type CountryFeature = Feature<Polygon | MultiPolygon, CountryProps>;
export type RegionFeature = Feature<Polygon | MultiPolygon, RegionProps>;

/** Villes en colonnes, triées par population décroissante. */
export interface Cities {
  name: string[];
  lat: number[];
  lng: number[];
  pop: number[];
  /** Index du pays dans `World.countries`, ou -1. */
  country: number[];
  /** Index de la région dans `World.regions`, ou -1. */
  region: number[];
  /** Index des villes capitales. */
  capital: number[];
}

/** Regroupement de régions d'un même pays (ex. les 18 régions françaises). */
export interface Group {
  name: string;
  country: number;
  regions: number[];
}

export type Selection =
  | { kind: 'country'; index: number }
  | { kind: 'group'; index: number }
  | { kind: 'region'; index: number }
  | { kind: 'city'; index: number }
  /** Lieu libre issu de la recherche en ligne (adresse, village, monument…). */
  | { kind: 'place'; name: string; detail: string; lat: number; lng: number };

export class World {
  readonly countries: CountryFeature[];
  readonly regions: RegionFeature[];
  readonly countryBorders: MultiLineString;
  readonly regionBorders: MultiLineString;
  readonly regionsByCountry: number[][];
  readonly groups: Group[] = [];
  readonly groupsByCountry: number[][];
  /** Index du groupe de chaque région, ou -1. */
  readonly groupOfRegion: number[];
  readonly countryOfRegionIndex: number[];
  readonly citiesByCountry: number[][];
  readonly citiesByRegion: number[][];
  readonly capitals: Set<number>;

  private readonly countryBoxes: BBox[];
  private readonly regionBoxes: (BBox | undefined)[];

  constructor(
    countriesTopo: Topology,
    regionsTopo: Topology,
    readonly cities: Cities,
  ) {
    const cObj = countriesTopo.objects.in as GeometryCollection<CountryProps>;
    const rObj = regionsTopo.objects.in as GeometryCollection<RegionProps>;
    this.countries = feature(countriesTopo, cObj).features as CountryFeature[];
    this.regions = feature(regionsTopo, rObj).features as RegionFeature[];
    this.countryBorders = mesh(countriesTopo, cObj);
    this.regionBorders = mesh(regionsTopo, rObj);

    this.countryBoxes = this.countries.map(boundsOf);
    this.regionBoxes = new Array(this.regions.length);

    const a3ToCountry = new Map(this.countries.map((c, i) => [c.properties.a3, i]));
    this.regionsByCountry = this.countries.map(() => []);
    this.countryOfRegionIndex = this.regions.map((r, i) => {
      const c = a3ToCountry.get(r.properties.a3) ?? -1;
      if (c >= 0) this.regionsByCountry[c].push(i);
      return c;
    });

    // Un niveau intermédiaire n'a de sens que s'il regroupe réellement des régions.
    this.groupsByCountry = this.countries.map(() => []);
    this.groupOfRegion = this.regions.map(() => -1);
    this.regionsByCountry.forEach((regionIndexes, country) => {
      const byName = new Map<string, number[]>();
      for (const r of regionIndexes) {
        const name = this.regions[r].properties.group;
        if (!name) return;
        byName.set(name, [...(byName.get(name) ?? []), r]);
      }
      if (byName.size < 2 || byName.size >= regionIndexes.length) return;
      for (const [name, members] of byName) {
        const index = this.groups.push({ name, country, regions: members }) - 1;
        this.groupsByCountry[country].push(index);
        for (const r of members) this.groupOfRegion[r] = index;
      }
    });

    this.citiesByCountry = this.countries.map(() => []);
    this.citiesByRegion = this.regions.map(() => []);
    for (let i = 0; i < cities.name.length; i++) {
      if (cities.country[i] >= 0) this.citiesByCountry[cities.country[i]].push(i);
      if (cities.region[i] >= 0) this.citiesByRegion[cities.region[i]].push(i);
    }
    this.capitals = new Set(cities.capital);
  }

  /** Pays d'une région (ou -1). */
  countryOfRegion(region: number): number {
    return this.countryOfRegionIndex[region];
  }

  /** Villes d'un groupe de régions, les plus peuplées d'abord. */
  citiesOfGroup(group: number): number[] {
    return this.groups[group].regions.flatMap((r) => this.citiesByRegion[r]).sort((a, b) => a - b);
  }

  countryAt(lat: number, lng: number): number {
    return this.countries.findIndex(
      (c, i) => inBBox(this.countryBoxes[i], lng, lat) && geoContains(c, [lng, lat]),
    );
  }

  regionAt(lat: number, lng: number, country = -1): number {
    const candidates = country >= 0 ? this.regionsByCountry[country] : this.regions.keys();
    for (const i of candidates) {
      const box = (this.regionBoxes[i] ??= boundsOf(this.regions[i]));
      if (inBBox(box, lng, lat) && geoContains(this.regions[i], [lng, lat])) return i;
    }
    return -1;
  }

  /** Ville la plus proche parmi les `count` premières, dans un rayon angulaire donné. */
  cityNear(lat: number, lng: number, count: number, maxAngle: number): number {
    const { lat: lats, lng: lngs } = this.cities;
    const maxDeg = (maxAngle * 180) / Math.PI;
    let best = -1;
    let bestDist = maxAngle;
    for (let i = 0; i < count; i++) {
      if (Math.abs(lats[i] - lat) > maxDeg) continue;
      const d = angularDistance(lat, lng, lats[i], lngs[i]);
      if (d < bestDist) {
        bestDist = d;
        best = i;
      }
    }
    return best;
  }
}

function boundsOf(f: Feature): BBox {
  const [[w, s], [e, n]] = geoBounds(f);
  return [w, s, e, n];
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} : HTTP ${res.status}`);
  return res.json() as Promise<T>;
}

export async function loadWorld(): Promise<World> {
  const base = `${import.meta.env.BASE_URL}data/`;
  const [countries, regions, cities] = await Promise.all([
    fetchJson<Topology>(`${base}countries.json`),
    fetchJson<Topology>(`${base}regions.json`),
    fetchJson<Cities>(`${base}cities.json`),
  ]);
  return new World(countries, regions, cities);
}
