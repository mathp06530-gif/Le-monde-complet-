import './style.css';
import type { Feature } from 'geojson';
import { loadWorld, type Selection, type World } from './data';
import {
  altitudeForZoom,
  formatCoords,
  formatDistance,
  formatNumber,
  zoomForAltitude,
} from './geo';
import { MIN_ORBIT_ALTITUDE, WorldGlobe, type GlobeClick } from './globe';
import type { GroundView } from './ground';
import { Labels } from './labels';
import { Panel } from './panel';
import { ScanLibrary, type Scan } from './scans';
import { SearchIndex, searchOnline } from './search';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const EARTH_RADIUS_M = 6_371_000;

/** Séquence de démarrage affichée pendant le chargement des données. */
function boot(): () => void {
  const lines = [
    'INITIALISATION DU NOYAU…',
    'LIAISON SATELLITE………… OK',
    'CHARGEMENT DES FRONTIÈRES…',
    'INDEXATION DES VILLES…',
    'CALCUL DE LA POSITION DU SOLEIL…',
  ];
  const log = $('boot-log');
  let i = 0;
  const timer = window.setInterval(() => {
    if (i < lines.length) log.textContent += `> ${lines[i++]}\n`;
  }, 220);
  return () => window.clearInterval(timer);
}

function start(world: World, scans: ScanLibrary): void {
  let selection: Selection | null = null;
  let labelsDirty = true;
  let mode: 'orbit' | 'ground' = 'orbit';
  let ground: GroundView | null = null;
  let entering = false;

  const globe = new WorldGlobe($('globe'), world, onClick, onOrbitMove);
  const labels = new Labels($('labels'), world, globe.cityPositions);
  const panel = new Panel(
    $('panel-content'),
    world,
    {
      openScan,
      select,
      descend: (lat, lng, zoom) => void enterGround(lat, lng, zoom, true),
      walk: (lat, lng) => void enterGround(lat, lng, 17, true, true),
    },
    scans,
  );
  const search = new SearchIndex(world);

  // ------------------------------------------------------------ Sélection
  function shapesOf(target: Selection | null): Feature[] {
    if (!target) return [];
    switch (target.kind) {
      case 'country':
        return [world.countries[target.index]];
      case 'group':
        return world.groups[target.index].regions.map((r) => world.regions[r]);
      case 'region':
        return [world.regions[target.index]];
      case 'city': {
        const region = world.cities.region[target.index];
        const country = world.cities.country[target.index];
        if (region >= 0) return [world.regions[region]];
        return country >= 0 ? [world.countries[country]] : [];
      }
      case 'place':
        return [];
    }
  }

  /** Point et niveaux de zoom (orbite, sol) adaptés à chaque type de cible. */
  function viewOf(target: Selection): { lat: number; lng: number; altitude: number; zoom: number } {
    switch (target.kind) {
      case 'country': {
        const p = world.countries[target.index].properties;
        return { lat: p.lat, lng: p.lng, altitude: 1.1, zoom: 5.5 };
      }
      case 'group': {
        const members = world.groups[target.index].regions.map((r) => world.regions[r].properties);
        const lat = members.reduce((sum, p) => sum + p.lat, 0) / members.length;
        const lng = members.reduce((sum, p) => sum + p.lng, 0) / members.length;
        return { lat, lng, altitude: 0.5, zoom: 7 };
      }
      case 'region': {
        const p = world.regions[target.index].properties;
        return { lat: p.lat, lng: p.lng, altitude: 0.3, zoom: 8.5 };
      }
      case 'city': {
        const { lat, lng } = world.cities;
        return { lat: lat[target.index], lng: lng[target.index], altitude: 0.2, zoom: 13.5 };
      }
      case 'place':
        return { lat: target.lat, lng: target.lng, altitude: 0.2, zoom: 16.5 };
    }
  }

  function select(next: Selection | null, fly = true): void {
    selection = next;
    labelsDirty = true;
    panel.render(selection);
    $('panel').classList.toggle('open', selection !== null);
    const shapes = shapesOf(selection);
    globe.highlight(shapes as Parameters<WorldGlobe['highlight']>[0]);
    ground?.highlight(shapes);
    if (!selection) return;
    setAutoRotate(false);
    if (!fly) return;
    const view = viewOf(selection);
    if (mode === 'ground' && ground) ground.flyTo(view.lat, view.lng, view.zoom);
    else if (selection.kind === 'place') void enterGround(view.lat, view.lng, view.zoom, true);
    else globe.flyTo(view.lat, view.lng, Math.min(globe.altitude, view.altitude));
  }

  function onClick({ lat, lng }: GlobeClick): void {
    const orbit = mode === 'orbit';
    const altitude = orbit
      ? globe.altitude
      : altitudeForZoom(ground!.map.getZoom(), lat, window.innerHeight);
    const candidates = orbit ? globe.visibleCities : world.cities.name.length;
    const city = world.cityNear(lat, lng, candidates, Math.max(0.0002, altitude * 0.014));
    if (city >= 0) return select({ kind: 'city', index: city }, false);
    const country = world.countryAt(lat, lng);
    if (altitude < 0.8) {
      const region = world.regionAt(lat, lng, country);
      if (region >= 0) return select({ kind: 'region', index: region }, false);
    }
    select(country >= 0 ? { kind: 'country', index: country } : null, false);
  }

  // ------------------------------------------------- Orbite ↔ vue au sol
  function onOrbitMove(): void {
    labelsDirty = true;
    // Arrivé au plus près du globe, on bascule sur l'imagerie satellite.
    if (mode === 'orbit' && !entering && globe.altitude <= MIN_ORBIT_ALTITUDE * 1.02) {
      const { lat, lng } = globe.center;
      void enterGround(lat, lng, zoomForAltitude(globe.altitude, lat, window.innerHeight), false);
    }
  }

  async function enterGround(lat: number, lng: number, zoom: number, fly: boolean, walk = false) {
    entering = true;
    if (!ground) {
      const { GroundView } = await import('./ground');
      ground = new GroundView($('ground'), {
        onClick: (clickLat, clickLng) => onClick({ lat: clickLat, lng: clickLng }),
        onMove: updateHud,
        onLeave: leaveGround,
      });
      ground.highlight(shapesOf(selection));
    }
    if (mode === 'orbit') {
      const from = globe.center;
      const startZoom = zoomForAltitude(globe.altitude, from.lat, window.innerHeight);
      document.body.dataset.mode = mode = 'ground';
      ground.resize();
      ground.jumpTo(fly ? from.lat : lat, fly ? from.lng : lng, fly ? startZoom : zoom);
      globe.setPaused(true);
      setAutoRotate(false);
    }
    if (walk) ground.walkAt(lat, lng);
    else if (fly) ground.flyTo(lat, lng, zoom);
    entering = false;
    updateWalkUi();
  }

  function leaveGround(): void {
    if (mode !== 'ground' || !ground) return;
    ground.setWalking(false);
    const { lat, lng } = ground.center;
    const altitude = altitudeForZoom(ground.map.getZoom(), lat, window.innerHeight);
    document.body.dataset.mode = mode = 'orbit';
    globe.setPaused(false);
    globe.flyTo(lat, lng, Math.max(altitude, MIN_ORBIT_ALTITUDE * 2.5), 0);
    labelsDirty = true;
    updateWalkUi();
    updateHud();
  }

  // ------------------------------------------------------------------ HUD
  function updateHud(): void {
    const orbit = mode === 'orbit' || !ground;
    const { lat, lng } = orbit ? globe.center : ground!.center;
    const height = orbit ? globe.altitude * EARTH_RADIUS_M : ground!.cameraHeight;
    $('hud-coords').textContent = formatCoords(lat, lng);
    $('hud-altitude').textContent = formatDistance(height);
    $('hud-mode').textContent = orbit ? 'ORBITE' : ground!.walking ? 'MARCHE' : 'SOL';
    $<HTMLAnchorElement>('link-streetview').href =
      `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${lat},${lng}`;
  }

  function updateWalkUi(): void {
    const walking = ground?.walking ?? false;
    $('btn-walk').textContent = walking ? '✕ Quitter la marche' : '⛶ Marcher';
    document.body.classList.toggle('walking', walking);
    updateHud();
  }

  $('btn-orbit').addEventListener('click', leaveGround);
  $('btn-walk').addEventListener('click', () => {
    ground?.setWalking(!ground.walking);
    updateWalkUi();
  });
  for (const pad of document.querySelectorAll<HTMLButtonElement>('#dpad button')) {
    const code = pad.dataset.code!;
    const set = (pressed: boolean) => (e: Event) => {
      e.preventDefault();
      ground?.hold(code, pressed);
    };
    pad.addEventListener('pointerdown', set(true));
    for (const type of ['pointerup', 'pointerleave', 'pointercancel']) {
      pad.addEventListener(type, set(false));
    }
  }
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !$('scan-viewer').hidden) return closeScan();
    if (e.key === 'Escape' && ground?.walking) {
      ground.setWalking(false);
      updateWalkUi();
    }
  });

  // ------------------------------------------------- Visionneuse de scans
  function openScan(scan: Scan): void {
    $('scan-title').textContent = scan.name;
    $<HTMLAnchorElement>('scan-link').href = scan.url;
    $<HTMLIFrameElement>('scan-frame').src = scan.url;
    $('scan-viewer').hidden = false;
  }
  function closeScan(): void {
    $('scan-viewer').hidden = true;
    $<HTMLIFrameElement>('scan-frame').src = 'about:blank';
  }
  $('scan-close').addEventListener('click', closeScan);

  // ------------------------------------------------------------ Recherche
  const input = $<HTMLInputElement>('search');
  const results = $<HTMLUListElement>('results');
  let onlineRequest: AbortController | null = null;
  const closeResults = () => results.replaceChildren();

  function resultItem(title: string, subtitle: string, onPick: () => void): HTMLLIElement {
    const li = document.createElement('li');
    const b = document.createElement('button');
    b.type = 'button';
    const strong = document.createElement('strong');
    strong.textContent = title;
    const small = document.createElement('small');
    small.textContent = subtitle;
    b.append(strong, small);
    b.addEventListener('click', onPick);
    li.append(b);
    return li;
  }

  async function runOnlineSearch(text: string): Promise<void> {
    onlineRequest?.abort();
    onlineRequest = new AbortController();
    results.replaceChildren(resultItem('Recherche mondiale…', 'OpenStreetMap', () => {}));
    try {
      const places = await searchOnline(text, onlineRequest.signal);
      results.replaceChildren(
        ...(places.length
          ? places.map((place) =>
              resultItem(place.name, place.detail, () => {
                select({ kind: 'place', ...place });
                input.value = place.name;
                closeResults();
              }),
            )
          : [resultItem('Aucun résultat', `« ${text} » est introuvable`, closeResults)]),
      );
    } catch (error) {
      if ((error as Error).name === 'AbortError') return;
      results.replaceChildren(
        resultItem('Recherche mondiale indisponible', 'Vérifiez la connexion', closeResults),
      );
    }
  }

  input.addEventListener('input', () => {
    const text = input.value.trim();
    const items = search.search(text).map((r) =>
      resultItem(r.title, r.subtitle, () => {
        select(r.selection);
        input.value = r.title;
        closeResults();
      }),
    );
    if (text.length >= 3) {
      items.push(
        resultItem(`⌕ Chercher « ${text} » partout`, 'Adresses, villages, monuments…', () => {
          void runOnlineSearch(text);
        }),
      );
    }
    results.replaceChildren(...items);
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeResults();
    if (e.key === 'Enter') results.querySelector('button')?.click();
  });
  for (const id of ['globe', 'ground']) $(id).addEventListener('pointerdown', closeResults);

  // ------------------------------------------------- Options d'affichage
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
  toggle('opt-sun', (on) => globe.setRealSun(on));
  toggle('opt-clouds', (on) => globe.setCloudsEnabled(on));
  const rotate = toggle('opt-rotate', (on) => globe.setAutoRotate(on));
  function setAutoRotate(on: boolean): void {
    rotate.checked = on;
    globe.setAutoRotate(on);
  }
  setAutoRotate(true);

  $('panel-close').addEventListener('click', () => select(null));
  $('panel-toggle').addEventListener('click', () => $('panel').classList.toggle('open'));
  window.addEventListener('resize', () => ground?.resize());

  $('hud-stats').textContent =
    `${formatNumber(world.countries.length)} PAYS · ${formatNumber(world.regions.length)} RÉGIONS · ` +
    `${formatNumber(world.cities.name.length)} VILLES`;

  // ------------------------------------------------------ Boucle de rendu
  panel.render(null);
  let lastProjection = '';
  let lastClock = '';
  const frame = (now: number) => {
    if (mode === 'orbit') {
      globe.tick(now);
      // Le redimensionnement du canevas est appliqué par le globe avec un temps
      // de retard : on surveille la projection plutôt que l'événement `resize`.
      const camera = globe.globe.camera();
      const projection = `${camera.projectionMatrix.elements[0]},${window.innerWidth}`;
      if (labelsDirty || projection !== lastProjection) {
        labelsDirty = false;
        lastProjection = projection;
        labels.update(camera, globe.altitude, globe.visibleCities, selection);
        updateHud();
      }
    }
    const clock = new Date().toISOString().slice(11, 19);
    if (clock !== lastClock) $('hud-clock').textContent = `${(lastClock = clock)} UTC`;
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
  document.body.dataset.mode = mode;
}

const stopBoot = boot();
const scanLibrary = new ScanLibrary();
Promise.all([loadWorld(), scanLibrary.load()])
  .then(([world]) => {
    start(world, scanLibrary);
    stopBoot();
    $('loading').classList.add('done');
    window.setTimeout(() => $('loading').remove(), 600);
  })
  .catch((error: unknown) => {
    stopBoot();
    console.error(error);
    $('boot-log').textContent += `\n! ÉCHEC DU CHARGEMENT : ${String(error)}`;
  });
