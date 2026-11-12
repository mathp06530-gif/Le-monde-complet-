import type { Selection, World } from './data';
import { normalize } from './geo';

export interface SearchResult {
  selection: Selection;
  title: string;
  subtitle: string;
}

/**
 * Renvoie les index des entrées correspondant à la requête : d'abord les
 * correspondances exactes, puis celles qui commencent par la requête, puis
 * celles qui la contiennent. L'ordre d'origine (par importance) est conservé
 * dans chaque groupe. `accept` permet d'écarter des entrées.
 */
export function matchKeys(
  keys: readonly string[],
  query: string,
  limit: number,
  accept?: (index: number) => boolean,
): number[] {
  if (!query || limit <= 0) return [];
  const exact: number[] = [];
  const prefix: number[] = [];
  const inner: number[] = [];
  for (let i = 0; i < keys.length && exact.length < limit; i++) {
    const at = keys[i].indexOf(query);
    if (at < 0 || (accept && !accept(i))) continue;
    if (at > 0) {
      if (inner.length < limit) inner.push(i);
    } else if (keys[i].length === query.length || keys[i].startsWith(`${query} |`)) {
      exact.push(i);
    } else if (prefix.length < limit) {
      prefix.push(i);
    }
  }
  return exact.concat(prefix, inner).slice(0, limit);
}

export class SearchIndex {
  private readonly countryKeys: string[];
  private readonly regionKeys: string[];
  private readonly groupKeys: string[];
  private readonly cityKeys: string[];

  constructor(private readonly world: World) {
    this.countryKeys = world.countries.map((c) =>
      normalize(`${c.properties.name} | ${c.properties.nameEn}`),
    );
    this.regionKeys = world.regions.map((r) =>
      normalize(`${r.properties.name} | ${r.properties.nameEn}`),
    );
    this.groupKeys = world.groups.map((g) => normalize(g.name));
    this.cityKeys = world.cities.name.map(normalize);
  }

  search(text: string): SearchResult[] {
    const query = normalize(text);
    if (query.length < 2) return [];
    const { world } = this;
    const results: SearchResult[] = [];

    for (const i of matchKeys(this.countryKeys, query, 5)) {
      const p = world.countries[i].properties;
      results.push({
        selection: { kind: 'country', index: i },
        title: p.name,
        subtitle: `Pays · ${p.continent}`,
      });
    }
    for (const i of matchKeys(this.groupKeys, query, 4)) {
      const g = world.groups[i];
      results.push({
        selection: { kind: 'group', index: i },
        title: g.name,
        subtitle: `Région · ${world.countries[g.country].properties.name}`,
      });
    }
    for (const i of matchKeys(this.regionKeys, query, 6)) {
      const p = world.regions[i].properties;
      const country = world.countryOfRegion(i);
      results.push({
        selection: { kind: 'region', index: i },
        title: p.name,
        subtitle: `${regionTypeLabel(p.type)} · ${country >= 0 ? world.countries[country].properties.name : p.a3}`,
      });
    }
    for (const i of this.matchCities(query, 14)) {
      const c = world.cities;
      const parts = ['Ville'];
      if (c.region[i] >= 0) parts.push(world.regions[c.region[i]].properties.name);
      if (c.country[i] >= 0) parts.push(world.countries[c.country[i]].properties.name);
      results.push({
        selection: { kind: 'city', index: i },
        title: c.name[i],
        subtitle: parts.join(' · '),
      });
    }
    return results;
  }

  /**
   * Villes correspondant à la requête. Les derniers mots peuvent préciser le
   * lieu : « mons var » ou « paris texas » filtrent sur la région, le groupe
   * de régions ou le pays.
   */
  private matchCities(query: string, limit: number): number[] {
    const { world } = this;
    const found = new Set<number>();
    const words = query.split(' ');
    for (let split = words.length - 1; split >= 1 && found.size < limit; split--) {
      const name = words.slice(0, split).join(' ');
      const qualifier = words.slice(split).join(' ');
      const inPlace = (i: number) => {
        const region = world.cities.region[i];
        const country = world.cities.country[i];
        const group = region >= 0 ? world.groupOfRegion[region] : -1;
        return (
          (region >= 0 && this.regionKeys[region].includes(qualifier)) ||
          (group >= 0 && this.groupKeys[group].includes(qualifier)) ||
          (country >= 0 && this.countryKeys[country].includes(qualifier))
        );
      };
      for (const i of matchKeys(this.cityKeys, name, limit - found.size, inPlace)) found.add(i);
    }
    for (const i of matchKeys(this.cityKeys, query, limit)) {
      if (found.size >= limit) break;
      found.add(i);
    }
    return [...found];
  }
}

const REGION_TYPES: Record<string, string> = {
  State: 'État',
  Province: 'Province',
  Region: 'Région',
  Department: 'Département',
  'Metropolitan department': 'Département',
  'Overseas department': 'Département d’outre-mer',
  County: 'Comté',
  District: 'District',
  Municipality: 'Municipalité',
  Prefecture: 'Préfecture',
  Governorate: 'Gouvernorat',
  Territory: 'Territoire',
  Canton: 'Canton',
  Republic: 'République',
  Parish: 'Paroisse',
  Emirate: 'Émirat',
  Island: 'Île',
  'Autonomous Community': 'Communauté autonome',
  'Autonomous Region': 'Région autonome',
  'Federal District': 'District fédéral',
  'Capital District': 'District de la capitale',
};

/** Nom français du type de subdivision fourni (en anglais) par Natural Earth. */
export function regionTypeLabel(type: string): string {
  return REGION_TYPES[type] ?? (type || 'Région');
}

export interface OnlinePlace {
  name: string;
  detail: string;
  lat: number;
  lng: number;
}

/**
 * Recherche mondiale via Nominatim (OpenStreetMap) : adresses, villages,
 * monuments… Appelée uniquement sur action explicite de l'utilisateur, comme
 * l'exige la politique d'usage du service.
 */
export async function searchOnline(text: string, signal?: AbortSignal): Promise<OnlinePlace[]> {
  const url = new URL('https://nominatim.openstreetmap.org/search');
  url.search = new URLSearchParams({
    q: text,
    format: 'jsonv2',
    limit: '8',
    'accept-language': 'fr',
  }).toString();
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const rows = (await res.json()) as { display_name: string; lat: string; lon: string }[];
  return rows.map((row) => {
    const [name, ...rest] = row.display_name.split(', ');
    return { name, detail: rest.join(', '), lat: Number(row.lat), lng: Number(row.lon) };
  });
}
