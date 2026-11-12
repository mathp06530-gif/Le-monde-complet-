import type { Selection, World } from './data';
import { flagEmoji, formatCoords, formatNumber } from './geo';

const CITY_PAGE = 100;

type Select = (selection: Selection | null) => void;

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className = '',
  text = '',
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

function linkButton(text: string, onClick: () => void, className = 'link'): HTMLButtonElement {
  const b = el('button', className, text);
  b.type = 'button';
  b.addEventListener('click', onClick);
  return b;
}

function facts(rows: [string, string | Node][]): HTMLElement {
  const dl = el('dl', 'facts');
  for (const [label, value] of rows) {
    dl.append(el('dt', '', label));
    const dd = el('dd');
    dd.append(value);
    dl.append(dd);
  }
  return dl;
}

/** Panneau latéral : accueil (pays par continent) ou fiche pays/région/ville. */
export class Panel {
  constructor(
    private readonly root: HTMLElement,
    private readonly world: World,
    private readonly select: Select,
  ) {}

  render(selection: Selection | null): void {
    this.root.replaceChildren();
    this.root.scrollTop = 0;
    if (!selection) this.renderHome();
    else if (selection.kind === 'country') this.renderCountry(selection.index);
    else if (selection.kind === 'region') this.renderRegion(selection.index);
    else this.renderCity(selection.index);
  }

  private breadcrumb(country: number, region = -1): HTMLElement {
    const { world } = this;
    const nav = el('nav', 'breadcrumb');
    nav.append(linkButton('Monde', () => this.select(null)));
    if (country >= 0) {
      nav.append(
        ' › ',
        linkButton(world.countries[country].properties.name, () =>
          this.select({ kind: 'country', index: country }),
        ),
      );
    }
    if (region >= 0) {
      nav.append(
        ' › ',
        linkButton(world.regions[region].properties.name, () =>
          this.select({ kind: 'region', index: region }),
        ),
      );
    }
    return nav;
  }

  private cityList(title: string, cities: number[]): HTMLElement {
    const { world } = this;
    const section = el('section');
    section.append(el('h3', '', `${title} (${formatNumber(cities.length)})`));
    if (cities.length === 0) {
      section.append(el('p', 'muted', 'Aucune ville répertoriée.'));
      return section;
    }
    const list = el('ul', 'list');
    section.append(list);
    let shown = 0;
    const more = linkButton('Afficher plus…', () => addPage(), 'more');
    const addPage = () => {
      for (const i of cities.slice(shown, shown + CITY_PAGE)) {
        const li = el('li');
        const b = linkButton(world.cities.name[i], () => this.select({ kind: 'city', index: i }));
        if (world.capitals.has(i)) b.prepend('★ ');
        li.append(b, el('span', 'muted', formatNumber(world.cities.pop[i])));
        list.append(li);
      }
      shown = Math.min(cities.length, shown + CITY_PAGE);
      more.hidden = shown >= cities.length;
    };
    addPage();
    section.append(more);
    return section;
  }

  private renderHome(): void {
    const { world } = this;
    this.root.append(
      el('h2', '', 'Explorer le monde'),
      el(
        'p',
        'muted',
        `${formatNumber(world.countries.length)} pays et territoires · ` +
          `${formatNumber(world.regions.length)} régions · ` +
          `${formatNumber(world.cities.name.length)} villes. ` +
          'Cliquez sur le globe, zoomez pour révéler plus de villes, ou utilisez la recherche.',
      ),
    );
    const byContinent = new Map<string, number[]>();
    world.countries.forEach((c, i) => {
      const list = byContinent.get(c.properties.continent) ?? [];
      list.push(i);
      byContinent.set(c.properties.continent, list);
    });
    const collator = new Intl.Collator('fr');
    for (const continent of [...byContinent.keys()].sort(collator.compare)) {
      const countries = byContinent.get(continent)!;
      countries.sort((a, b) =>
        collator.compare(world.countries[a].properties.name, world.countries[b].properties.name),
      );
      const details = el('details');
      details.append(el('summary', '', `${continent} (${countries.length})`));
      const list = el('ul', 'list');
      for (const i of countries) {
        const p = world.countries[i].properties;
        const li = el('li');
        li.append(
          linkButton(`${flagEmoji(p.a2)} ${p.name}`, () =>
            this.select({ kind: 'country', index: i }),
          ),
        );
        list.append(li);
      }
      details.append(list);
      this.root.append(details);
    }
  }

  private renderCountry(index: number): void {
    const { world } = this;
    const p = world.countries[index].properties;
    const regions = [...world.regionsByCountry[index]];
    const collator = new Intl.Collator('fr');
    regions.sort((a, b) =>
      collator.compare(world.regions[a].properties.name, world.regions[b].properties.name),
    );

    this.root.append(
      this.breadcrumb(-1),
      el('h2', '', `${flagEmoji(p.a2)} ${p.name}`),
      facts([
        ['Continent', p.continent],
        ['Capitale', p.capital || '—'],
        ['Population', p.pop ? `${formatNumber(p.pop)} hab.` : '—'],
        ['Code ISO', [p.a2, p.a3].filter(Boolean).join(' / ')],
      ]),
    );

    const details = el('details');
    details.append(el('summary', '', `Régions (${formatNumber(regions.length)})`));
    const list = el('ul', 'list');
    for (const r of regions) {
      const li = el('li');
      li.append(
        linkButton(world.regions[r].properties.name, () =>
          this.select({ kind: 'region', index: r }),
        ),
        el('span', 'muted', formatNumber(world.citiesByRegion[r].length)),
      );
      list.append(li);
    }
    details.append(list);
    this.root.append(details, this.cityList('Villes', world.citiesByCountry[index]));
  }

  private renderRegion(index: number): void {
    const { world } = this;
    const p = world.regions[index].properties;
    const country = world.countryOfRegion(index);
    this.root.append(
      this.breadcrumb(country),
      el('h2', '', p.name),
      facts([
        ['Type', p.type || 'Région'],
        ['Pays', country >= 0 ? world.countries[country].properties.name : '—'],
      ]),
      this.cityList('Villes', world.citiesByRegion[index]),
    );
  }

  private renderCity(index: number): void {
    const { world } = this;
    const c = world.cities;
    const country = c.country[index];
    const region = c.region[index];
    const lat = c.lat[index];
    const lng = c.lng[index];

    const map = el('a', '', 'Voir sur OpenStreetMap');
    map.href = `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=11/${lat}/${lng}`;
    map.target = '_blank';
    map.rel = 'noopener';

    this.root.append(
      this.breadcrumb(country, region),
      el('h2', '', c.name[index]),
      facts([
        ['Statut', world.capitals.has(index) ? '★ Capitale' : 'Ville'],
        ['Pays', country >= 0 ? world.countries[country].properties.name : '—'],
        ['Région', region >= 0 ? world.regions[region].properties.name : '—'],
        ['Population', `${formatNumber(c.pop[index])} hab.`],
        ['Coordonnées', formatCoords(lat, lng)],
        ['Carte', map],
      ]),
    );
  }
}
