import type { Selection, World } from './data';
import { flagEmoji, formatCoords, formatNumber } from './geo';
import { parseScanUrl, scansNear, type Scan, type ScanLibrary } from './scans';
import { regionTypeLabel } from './search';

const CITY_PAGE = 100;

export interface PanelActions {
  select(selection: Selection | null): void;
  /** Descend en vue au sol à cet endroit. */
  descend(lat: number, lng: number, zoom: number): void;
  /** Descend et passe directement en mode marche. */
  walk(lat: number, lng: number): void;
  /** Ouvre les vraies photos de rue les plus proches. */
  openStreet(lat: number, lng: number, name: string): void;
  /** Ouvre la ville en 3D photo-réaliste. */
  openCity3d(lat: number, lng: number, name: string): void;
  /** Ouvre un lieu scanné en 3D dans la visionneuse. */
  openScan(scan: Scan): void;
}

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
    private readonly actions: PanelActions,
    private readonly scans: ScanLibrary,
  ) {}

  private current: Selection | null = null;

  private select(selection: Selection | null): void {
    this.actions.select(selection);
  }

  /** Liste de scans 3D, avec ajout possible à un endroit donné. */
  private scanSection(title: string, scans: Scan[], addAt?: { lat: number; lng: number }) {
    const section = el('section');
    section.append(el('h3', '', `${title} (${scans.length})`));
    const list = el('ul', 'list');
    for (const scan of scans) {
      const li = el('li');
      li.append(linkButton(`◈ ${scan.name}`, () => this.actions.openScan(scan)));
      if (this.scans.isCustom(scan)) {
        li.append(
          linkButton('retirer', () => {
            this.scans.remove(scan);
            this.render(this.current);
          }),
        );
      }
      list.append(li);
    }
    section.append(list);
    if (scans.length === 0) {
      section.append(
        el(
          'p',
          'muted',
          addAt
            ? 'Aucun lieu scanné ici pour l’instant.'
            : 'Aucun scan enregistré. Ouvrez la fiche d’une ville pour en ajouter un.',
        ),
      );
    }
    if (addAt) {
      section.append(
        linkButton(
          '＋ Ajouter un scan 3D ici',
          () => {
            const url = parseScanUrl(
              window.prompt('Adresse HTTPS du scan (par exemple un lien SuperSplat) :') ?? '',
            );
            if (!url) return;
            const name = window.prompt('Nom du lieu :')?.trim();
            if (!name) return;
            this.scans.add({ name, url, ...addAt });
            this.render(this.current);
          },
          'more',
        ),
      );
    }
    return section;
  }

  private tag(text: string): HTMLElement {
    return el('p', 'tag', `// ${text}`);
  }

  private groundActions(
    lat: number,
    lng: number,
    zoom: number,
    street: boolean,
    name = '',
  ): HTMLElement {
    const box = el('div', 'actions');
    box.append(linkButton('▼ Descendre au sol', () => this.actions.descend(lat, lng, zoom), 'btn'));
    if (street) {
      box.append(
        linkButton('⛶ Marcher dans les rues', () => this.actions.walk(lat, lng), 'btn'),
        linkButton('◉ Photos de rue réelles', () => this.actions.openStreet(lat, lng, name), 'btn'),
        linkButton('▣ Ville 3D réaliste', () => this.actions.openCity3d(lat, lng, name), 'btn'),
      );
    }
    return box;
  }

  private externalLinks(lat: number, lng: number): HTMLElement {
    const box = el('span', 'links');
    const add = (text: string, href: string) => {
      const a = el('a', '', text);
      a.href = href;
      a.target = '_blank';
      a.rel = 'noopener';
      box.append(a);
    };
    add(
      'Street View ↗',
      `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${lat},${lng}`,
    );
    add('Mapillary ↗', `https://www.mapillary.com/app/?lat=${lat}&lng=${lng}&z=17`);
    add('Streets GL (3D) ↗', `https://streets.gl/#${lat},${lng},45.00,0.00,1200.00`);
    add(
      'OpenStreetMap ↗',
      `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=15/${lat}/${lng}`,
    );
    return box;
  }

  render(selection: Selection | null): void {
    this.current = selection;
    this.root.replaceChildren();
    this.root.scrollTop = 0;
    if (!selection) this.renderHome();
    else if (selection.kind === 'country') this.renderCountry(selection.index);
    else if (selection.kind === 'group') this.renderGroup(selection.index);
    else if (selection.kind === 'region') this.renderRegion(selection.index);
    else if (selection.kind === 'city') this.renderCity(selection.index);
    else this.renderPlace(selection);
  }

  private breadcrumb(country: number, region = -1, parentGroup = -1): HTMLElement {
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
    const group = region >= 0 ? world.groupOfRegion[region] : parentGroup;
    if (group >= 0) {
      nav.append(
        ' › ',
        linkButton(world.groups[group].name, () => this.select({ kind: 'group', index: group })),
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
      this.tag('SYSTÈME EN LIGNE'),
      el('h2', '', 'Explorer le monde'),
      el(
        'p',
        'muted',
        `${formatNumber(world.countries.length)} pays et territoires · ` +
          `${formatNumber(world.regions.length)} régions · ` +
          `${formatNumber(world.cities.name.length)} villes. ` +
          'Cliquez sur le globe, zoomez jusqu’au sol pour passer en imagerie satellite, ou lancez une recherche.',
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
    this.root.append(this.scanSection('Lieux scannés en 3D', this.scans.all));
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
      this.tag('CIBLE : PAYS'),
      el('h2', '', `${flagEmoji(p.a2)} ${p.name}`),
      facts([
        ['Continent', p.continent],
        ['Capitale', p.capital || '—'],
        ['Population', p.pop ? `${formatNumber(p.pop)} hab.` : '—'],
        ['Code ISO', [p.a2, p.a3].filter(Boolean).join(' / ')],
      ]),
    );

    const groups = [...world.groupsByCountry[index]].sort((a, b) =>
      collator.compare(world.groups[a].name, world.groups[b].name),
    );
    if (groups.length > 0) {
      const details = el('details');
      details.append(el('summary', '', `Régions (${formatNumber(groups.length)})`));
      const list = el('ul', 'list');
      for (const g of groups) {
        const li = el('li');
        li.append(
          linkButton(world.groups[g].name, () => this.select({ kind: 'group', index: g })),
          el('span', 'muted', formatNumber(world.groups[g].regions.length)),
        );
        list.append(li);
      }
      details.append(list);
      this.root.append(details);
    }
    const subdivisions = groups.length > 0 ? 'Départements et subdivisions' : 'Régions';
    this.root.append(
      this.regionList(subdivisions, regions),
      this.cityList('Villes', world.citiesByCountry[index]),
    );
  }

  private regionList(title: string, regions: number[]): HTMLDetailsElement {
    const { world } = this;
    const details = el('details');
    details.append(el('summary', '', `${title} (${formatNumber(regions.length)})`));
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
    return details;
  }

  private renderGroup(index: number): void {
    const { world } = this;
    const group = world.groups[index];
    const collator = new Intl.Collator('fr');
    const regions = [...group.regions].sort((a, b) =>
      collator.compare(world.regions[a].properties.name, world.regions[b].properties.name),
    );
    const list = this.regionList('Départements et subdivisions', regions);
    list.open = true;
    this.root.append(
      this.breadcrumb(group.country),
      this.tag('CIBLE : RÉGION'),
      el('h2', '', group.name),
      facts([
        ['Pays', world.countries[group.country].properties.name],
        ['Subdivisions', formatNumber(regions.length)],
      ]),
      list,
      this.cityList('Villes', world.citiesOfGroup(index)),
    );
  }

  private renderRegion(index: number): void {
    const { world } = this;
    const p = world.regions[index].properties;
    const country = world.countryOfRegion(index);
    this.root.append(
      this.breadcrumb(country, -1, world.groupOfRegion[index]),
      this.tag(`CIBLE : ${regionTypeLabel(p.type).toUpperCase()}`),
      el('h2', '', p.name),
      facts([
        ['Type', regionTypeLabel(p.type)],
        ['Pays', country >= 0 ? world.countries[country].properties.name : '—'],
      ]),
      this.groundActions(p.lat, p.lng, 9, false),
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

    this.root.append(
      this.breadcrumb(country, region),
      this.tag(world.capitals.has(index) ? 'CIBLE : CAPITALE' : 'CIBLE : VILLE'),
      el('h2', '', c.name[index]),
      facts([
        ['Statut', world.capitals.has(index) ? '★ Capitale' : 'Ville'],
        ['Pays', country >= 0 ? world.countries[country].properties.name : '—'],
        ['Région', region >= 0 ? world.regions[region].properties.name : '—'],
        ['Population', `${formatNumber(c.pop[index])} hab.`],
        ['Coordonnées', formatCoords(lat, lng)],
        ['Liens', this.externalLinks(lat, lng)],
      ]),
      this.groundActions(lat, lng, 14.5, true, c.name[index]),
      this.scanSection('Lieux scannés à proximité', scansNear(this.scans.all, lat, lng, 40), {
        lat,
        lng,
      }),
    );
  }

  private renderPlace(place: Extract<Selection, { kind: 'place' }>): void {
    this.root.append(
      this.breadcrumb(-1),
      this.tag('CIBLE : LIEU'),
      el('h2', '', place.name),
      el('p', 'muted', place.detail),
      facts([
        ['Coordonnées', formatCoords(place.lat, place.lng)],
        ['Liens', this.externalLinks(place.lat, place.lng)],
      ]),
      this.groundActions(place.lat, place.lng, 16.5, true, place.name),
      this.scanSection(
        'Lieux scannés à proximité',
        scansNear(this.scans.all, place.lat, place.lng, 40),
        { lat: place.lat, lng: place.lng },
      ),
    );
  }
}
