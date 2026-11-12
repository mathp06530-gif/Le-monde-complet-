import { Vector3, type Camera } from 'three';
import type { Selection, World } from './data';
import { GLOBE_RADIUS, toXYZ } from './geo';

type LabelKind = 'country' | 'region' | 'city' | 'capital' | 'selected';

interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

const MAX_COUNTRY_LABELS = 28;
const MAX_REGION_LABELS = 40;
const MAX_CITY_LABELS = 45;
const COUNTRY_LABELS_MIN_ALTITUDE = 0.4;

/** Étiquettes HTML superposées au globe, placées sans chevauchement. */
export class Labels {
  enabled = true;

  private readonly pool: HTMLSpanElement[] = [];
  private used = 0;
  private boxes: Box[] = [];
  private readonly v = new Vector3();
  private readonly countryPositions: Float32Array;
  private readonly regionPositions: Float32Array;
  /** Pays triés par population décroissante : les plus grands d'abord. */
  private readonly countryOrder: number[];

  constructor(
    private readonly layer: HTMLElement,
    private readonly world: World,
    private readonly cityPositions: Float32Array,
  ) {
    this.countryPositions = new Float32Array(world.countries.length * 3);
    world.countries.forEach((c, i) =>
      toXYZ(c.properties.lat, c.properties.lng, 0.003, this.countryPositions, i * 3),
    );
    this.regionPositions = new Float32Array(world.regions.length * 3);
    world.regions.forEach((r, i) =>
      toXYZ(r.properties.lat, r.properties.lng, 0.003, this.regionPositions, i * 3),
    );
    this.countryOrder = world.countries
      .map((_, i) => i)
      .sort((a, b) => world.countries[b].properties.pop - world.countries[a].properties.pop);
  }

  update(
    camera: Camera,
    altitude: number,
    visibleCities: number,
    selection: Selection | null,
  ): void {
    this.used = 0;
    this.boxes = [];
    if (this.enabled) {
      const { world } = this;
      const w = this.layer.clientWidth;
      const h = this.layer.clientHeight;
      const cam = camera.position;
      const horizon = GLOBE_RADIUS * GLOBE_RADIUS;

      const place = (positions: Float32Array, i: number, text: string, kind: LabelKind) => {
        const x = positions[i * 3];
        const y = positions[i * 3 + 1];
        const z = positions[i * 3 + 2];
        // Point caché derrière l'horizon du globe.
        if (x * cam.x + y * cam.y + z * cam.z < horizon) return false;
        this.v.set(x, y, z).project(camera);
        if (Math.abs(this.v.x) > 1 || Math.abs(this.v.y) > 1 || this.v.z > 1) return false;
        return this.add(((this.v.x + 1) / 2) * w, ((1 - this.v.y) / 2) * h, text, kind);
      };

      let selectedCountry = -1;
      if (selection?.kind === 'city') {
        place(this.cityPositions, selection.index, world.cities.name[selection.index], 'selected');
        selectedCountry = world.cities.country[selection.index];
      } else if (selection?.kind === 'region') {
        selectedCountry = world.countryOfRegion(selection.index);
      } else if (selection?.kind === 'country') {
        selectedCountry = selection.index;
      }

      if (altitude > COUNTRY_LABELS_MIN_ALTITUDE) {
        let n = 0;
        for (const i of this.countryOrder) {
          if (place(this.countryPositions, i, world.countries[i].properties.name, 'country')) n++;
          if (n >= MAX_COUNTRY_LABELS) break;
        }
      }

      if (selectedCountry >= 0 && altitude < 1.2) {
        let n = 0;
        for (const i of world.regionsByCountry[selectedCountry]) {
          if (place(this.regionPositions, i, world.regions[i].properties.name, 'region')) n++;
          if (n >= MAX_REGION_LABELS) break;
        }
      }

      const maxCities = altitude > 1.5 ? 18 : MAX_CITY_LABELS;
      let n = 0;
      for (let i = 0; i < visibleCities && n < maxCities; i++) {
        const kind = world.capitals.has(i) ? 'capital' : 'city';
        if (place(this.cityPositions, i, world.cities.name[i], kind)) n++;
      }
    }
    for (let i = this.used; i < this.pool.length; i++) this.pool[i].hidden = true;
  }

  private add(x: number, y: number, text: string, kind: LabelKind): boolean {
    const width = text.length * (kind === 'country' ? 8 : 6.6) + 14;
    const box: Box = { x0: x - 4, y0: y - 9, x1: x + width, y1: y + 9 };
    if (kind === 'country' || kind === 'region') {
      box.x0 = x - width / 2;
      box.x1 = x + width / 2;
    }
    for (const b of this.boxes) {
      if (box.x0 < b.x1 && box.x1 > b.x0 && box.y0 < b.y1 && box.y1 > b.y0) return false;
    }
    this.boxes.push(box);

    let el = this.pool[this.used];
    if (!el) {
      el = document.createElement('span');
      this.layer.appendChild(el);
      this.pool.push(el);
    }
    this.used++;
    if (el.textContent !== text) el.textContent = text;
    el.className = `label label-${kind}`;
    el.hidden = false;
    el.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
    return true;
  }
}
