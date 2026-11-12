import type { Selection, World } from './data';
import { normalize } from './geo';

export interface SearchResult {
  selection: Selection;
  title: string;
  subtitle: string;
}

/**
 * Renvoie les index des entrées correspondant à la requête : d'abord celles
 * qui commencent par la requête, puis celles qui la contiennent. L'ordre
 * d'origine (par importance) est conservé dans chaque groupe.
 */
export function matchKeys(keys: readonly string[], query: string, limit: number): number[] {
  if (!query || limit <= 0) return [];
  const prefix: number[] = [];
  const inner: number[] = [];
  for (let i = 0; i < keys.length && prefix.length < limit; i++) {
    const at = keys[i].indexOf(query);
    if (at === 0) prefix.push(i);
    else if (at > 0 && inner.length < limit) inner.push(i);
  }
  return prefix.concat(inner).slice(0, limit);
}

export class SearchIndex {
  private readonly countryKeys: string[];
  private readonly regionKeys: string[];
  private readonly cityKeys: string[];

  constructor(private readonly world: World) {
    this.countryKeys = world.countries.map((c) =>
      normalize(`${c.properties.name} | ${c.properties.nameEn}`),
    );
    this.regionKeys = world.regions.map((r) =>
      normalize(`${r.properties.name} | ${r.properties.nameEn}`),
    );
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
    for (const i of matchKeys(this.regionKeys, query, 6)) {
      const p = world.regions[i].properties;
      const country = world.countryOfRegion(i);
      results.push({
        selection: { kind: 'region', index: i },
        title: p.name,
        subtitle: `Région · ${country >= 0 ? world.countries[country].properties.name : p.a3}`,
      });
    }
    for (const i of matchKeys(this.cityKeys, query, 14)) {
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
}
