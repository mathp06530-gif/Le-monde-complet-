import './style.css';
import { loadWorld, type Selection, type World } from './data';
import { WorldGlobe, type GlobeClick } from './globe';
import { Labels } from './labels';
import { Panel } from './panel';
import { SearchIndex } from './search';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

function start(world: World): void {
  let selection: Selection | null = null;
  let labelsDirty = true;

  const globe = new WorldGlobe($('globe'), world, onGlobeClick, () => (labelsDirty = true));
  const labels = new Labels($('labels'), world, globe.cityPositions);
  const panel = new Panel($('panel-content'), world, select);
  const search = new SearchIndex(world);

  function select(next: Selection | null, fly = true): void {
    selection = next;
    labelsDirty = true;
    panel.render(selection);
    $('panel').classList.toggle('open', selection !== null);
    if (!selection) {
      globe.highlight(null);
      return;
    }
    setAutoRotate(false);
    const altitude = globe.altitude;
    if (selection.kind === 'country') {
      const c = world.countries[selection.index];
      globe.highlight(c);
      if (fly) globe.flyTo(c.properties.lat, c.properties.lng, Math.min(altitude, 1.1));
    } else if (selection.kind === 'region') {
      const r = world.regions[selection.index];
      globe.highlight(r);
      if (fly) globe.flyTo(r.properties.lat, r.properties.lng, Math.min(altitude, 0.35));
    } else {
      const { lat, lng, region, country } = world.cities;
      const i = selection.index;
      globe.highlight(
        region[i] >= 0
          ? world.regions[region[i]]
          : country[i] >= 0
            ? world.countries[country[i]]
            : null,
      );
      if (fly) globe.flyTo(lat[i], lng[i], Math.min(altitude, 0.12));
    }
  }

  function onGlobeClick({ lat, lng }: GlobeClick): void {
    const altitude = globe.altitude;
    const city = world.cityNear(lat, lng, globe.visibleCities, Math.max(0.0015, altitude * 0.014));
    if (city >= 0) return select({ kind: 'city', index: city }, false);
    const country = world.countryAt(lat, lng);
    if (altitude < 0.8) {
      const region = world.regionAt(lat, lng, country);
      if (region >= 0) return select({ kind: 'region', index: region }, false);
    }
    select(country >= 0 ? { kind: 'country', index: country } : null, false);
  }

  // --- Recherche
  const input = $<HTMLInputElement>('search');
  const results = $<HTMLUListElement>('results');
  const closeResults = () => results.replaceChildren();
  input.addEventListener('input', () => {
    results.replaceChildren(
      ...search.search(input.value).map((r) => {
        const li = document.createElement('li');
        const b = document.createElement('button');
        b.type = 'button';
        const title = document.createElement('strong');
        title.textContent = r.title;
        const sub = document.createElement('small');
        sub.textContent = r.subtitle;
        b.append(title, sub);
        b.addEventListener('click', () => {
          select(r.selection);
          input.value = r.title;
          closeResults();
        });
        li.append(b);
        return li;
      }),
    );
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeResults();
    if (e.key === 'Enter') results.querySelector('button')?.click();
  });
  $('globe').addEventListener('pointerdown', closeResults);

  // --- Options d'affichage
  const toggle = (id: string, apply: (on: boolean) => void) => {
    const box = $<HTMLInputElement>(id);
    box.addEventListener('change', () => apply(box.checked));
    return box;
  };
  toggle('opt-regions', (on) => globe.setRegionsEnabled(on));
  toggle('opt-cities', (on) => {
    globe.setCitiesEnabled(on);
    labelsDirty = true;
  });
  toggle('opt-labels', (on) => {
    labels.enabled = on;
    labelsDirty = true;
  });
  toggle('opt-night', (on) => globe.setNight(on));
  const rotate = toggle('opt-rotate', (on) => globe.setAutoRotate(on));
  function setAutoRotate(on: boolean): void {
    rotate.checked = on;
    globe.setAutoRotate(on);
  }
  setAutoRotate(true);

  $('panel-close').addEventListener('click', () => select(null));
  $('panel-toggle').addEventListener('click', () => $('panel').classList.toggle('open'));

  panel.render(null);
  let lastProjection = '';
  const frame = () => {
    // Le redimensionnement du canevas est appliqué par le globe avec un temps
    // de retard : on surveille la projection plutôt que l'événement `resize`.
    const camera = globe.globe.camera();
    const projection = `${camera.projectionMatrix.elements[0]},${window.innerWidth}`;
    if (labelsDirty || projection !== lastProjection) {
      labelsDirty = false;
      lastProjection = projection;
      labels.update(camera, globe.altitude, globe.visibleCities, selection);
    }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
  $('loading').remove();
}

loadWorld()
  .then(start)
  .catch((error: unknown) => {
    console.error(error);
    $('loading').textContent = `Impossible de charger les données : ${String(error)}`;
  });
