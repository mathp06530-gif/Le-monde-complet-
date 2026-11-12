import maplibregl, { type GeoJSONSource, type StyleSpecification } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import type { Feature, FeatureCollection } from 'geojson';
import { movePoint } from './geo';

const OSM = 'https://tiles.openfreemap.org';
const NAME = ['coalesce', ['get', 'name:fr'], ['get', 'name:latin'], ['get', 'name']];
const HALO = { 'text-halo-color': 'rgba(0, 8, 6, 0.9)', 'text-halo-width': 1.4 };

/** Vitesse de marche (m/s) ; Maj pour courir. */
const WALK_SPEED = 14;
const RUN_FACTOR = 5;
const TURN_SPEED = 70;
const WALK_ZOOM = 20.5;
const WALK_PITCH = 80;

const style: StyleSpecification = {
  version: 8,
  projection: { type: 'globe' },
  glyphs: `${OSM}/fonts/{fontstack}/{range}.pbf`,
  sources: {
    satellite: {
      type: 'raster',
      tiles: [
        'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      ],
      tileSize: 256,
      maxzoom: 19,
      attribution: 'Imagerie © Esri, Maxar, Earthstar Geographics',
    },
    relief: {
      type: 'raster-dem',
      tiles: ['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'],
      encoding: 'terrarium',
      tileSize: 256,
      maxzoom: 14,
      attribution: 'Relief : Mapzen, AWS Terrain Tiles',
    },
    osm: {
      type: 'vector',
      url: `${OSM}/planet`,
      attribution: '© OpenStreetMap, OpenFreeMap',
    },
    highlight: { type: 'geojson', data: { type: 'FeatureCollection', features: [] } },
  },
  terrain: { source: 'relief', exaggeration: 1 },
  sky: {
    'sky-color': '#5b9bd5',
    'horizon-color': '#cfe3f2',
    'fog-color': '#cfd8dc',
    'sky-horizon-blend': 0.6,
    'horizon-fog-blend': 0.6,
    'fog-ground-blend': 0.4,
    'atmosphere-blend': ['interpolate', ['linear'], ['zoom'], 0, 1, 6, 0.6, 9, 0],
  },
  layers: [
    { id: 'space', type: 'background', paint: { 'background-color': '#020604' } },
    { id: 'satellite', type: 'raster', source: 'satellite' },
    {
      id: 'borders',
      type: 'line',
      source: 'osm',
      'source-layer': 'boundary',
      filter: ['all', ['<=', ['get', 'admin_level'], 4], ['!=', ['get', 'maritime'], 1]],
      paint: {
        'line-color': '#ffffff',
        'line-opacity': ['case', ['<=', ['get', 'admin_level'], 2], 0.7, 0.35],
        'line-width': ['case', ['<=', ['get', 'admin_level'], 2], 1.4, 0.8],
      },
    },
    {
      id: 'highlight',
      type: 'line',
      source: 'highlight',
      paint: { 'line-color': '#00ff9c', 'line-width': 2.5, 'line-opacity': 0.9 },
    },
    {
      id: 'buildings',
      type: 'fill-extrusion',
      source: 'osm',
      'source-layer': 'building',
      minzoom: 14,
      paint: {
        'fill-extrusion-color': [
          'interpolate',
          ['linear'],
          ['coalesce', ['get', 'render_height'], 6],
          0,
          '#cfc9bf',
          60,
          '#b9bcc4',
          250,
          '#9fb0c4',
        ],
        'fill-extrusion-height': ['coalesce', ['get', 'render_height'], 6],
        'fill-extrusion-base': ['coalesce', ['get', 'render_min_height'], 0],
        'fill-extrusion-opacity': ['interpolate', ['linear'], ['zoom'], 14, 0, 15.5, 0.92],
      },
    },
    {
      id: 'streets',
      type: 'symbol',
      source: 'osm',
      'source-layer': 'transportation_name',
      minzoom: 13,
      layout: {
        'symbol-placement': 'line',
        'text-field': NAME as never,
        'text-font': ['Noto Sans Regular'],
        'text-size': ['interpolate', ['linear'], ['zoom'], 13, 10, 18, 14],
      },
      paint: { 'text-color': '#eafff6', ...HALO },
    },
    {
      id: 'places',
      type: 'symbol',
      source: 'osm',
      'source-layer': 'place',
      layout: {
        'text-field': NAME as never,
        'text-font': ['Noto Sans Bold'],
        'text-size': [
          'match',
          ['get', 'class'],
          ['country'],
          15,
          ['state'],
          12,
          ['city'],
          14,
          ['town'],
          12.5,
          11,
        ],
        'text-transform': ['match', ['get', 'class'], ['country', 'state'], 'uppercase', 'none'],
        'text-letter-spacing': ['match', ['get', 'class'], ['country', 'state'], 0.12, 0],
        'symbol-sort-key': ['coalesce', ['get', 'rank'], 20],
        'text-max-width': 9,
      },
      paint: {
        'text-color': ['match', ['get', 'class'], ['country', 'state'], '#9dffe0', '#ffffff'],
        ...HALO,
      },
    },
  ],
};

export interface GroundCallbacks {
  onClick(lat: number, lng: number): void;
  onMove(): void;
  /** Appelé quand l'utilisateur dézoome assez pour repasser en orbite. */
  onLeave(): void;
}

/** Zoom en dessous duquel on rend la main au globe orbital. */
export const LEAVE_ZOOM = 4.6;

/**
 * Vue au sol : imagerie satellite drapée sur le relief, bâtiments 3D et noms
 * de rues. En mode « marche », on se déplace au clavier comme dans un jeu.
 */
export class GroundView {
  readonly map: maplibregl.Map;
  walking = false;

  private readonly keys = new Set<string>();
  private lastFrame = 0;
  private drag: { x: number; y: number } | null = null;

  constructor(
    private readonly container: HTMLElement,
    callbacks: GroundCallbacks,
  ) {
    this.map = new maplibregl.Map({
      container,
      style,
      center: [0, 0],
      zoom: 5,
      maxZoom: 22,
      maxPitch: 85,
      attributionControl: false,
    });
    this.map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-left');
    this.map.on('click', (e) => {
      if (!this.walking) callbacks.onClick(e.lngLat.lat, e.lngLat.lng);
    });
    this.map.on('move', () => callbacks.onMove());
    this.map.on('moveend', () => {
      if (this.map.getZoom() < LEAVE_ZOOM) callbacks.onLeave();
    });

    window.addEventListener('keydown', (e) => this.onKey(e, true));
    window.addEventListener('keyup', (e) => this.onKey(e, false));
    window.addEventListener('blur', () => this.keys.clear());
    container.addEventListener('pointerdown', (e) => {
      if (!this.walking) return;
      this.drag = { x: e.clientX, y: e.clientY };
      container.setPointerCapture(e.pointerId);
    });
    container.addEventListener('pointermove', (e) => {
      if (!this.walking || !this.drag) return;
      const bearing = this.map.getBearing() - (e.clientX - this.drag.x) * 0.25;
      const pitch = Math.min(
        85,
        Math.max(30, this.map.getPitch() + (e.clientY - this.drag.y) * 0.2),
      );
      this.drag = { x: e.clientX, y: e.clientY };
      this.map.jumpTo({ bearing, pitch });
    });
    const release = () => (this.drag = null);
    container.addEventListener('pointerup', release);
    container.addEventListener('pointercancel', release);

    requestAnimationFrame((t) => this.frame(t));
  }

  get center(): { lat: number; lng: number } {
    const { lat, lng } = this.map.getCenter();
    return { lat, lng };
  }

  /** Hauteur approximative de la caméra au-dessus du sol, en mètres. */
  get cameraHeight(): number {
    const { lat } = this.map.getCenter();
    const metersPerPixel = (78_271.517 * Math.cos((lat * Math.PI) / 180)) / 2 ** this.map.getZoom();
    const distance = (this.container.clientHeight / 2 / Math.tan(0.3217)) * metersPerPixel;
    return distance * Math.cos((this.map.getPitch() * Math.PI) / 180);
  }

  resize(): void {
    this.map.resize();
  }

  jumpTo(lat: number, lng: number, zoom: number): void {
    this.map.jumpTo({ center: [lng, lat], zoom, pitch: 0, bearing: 0 });
  }

  flyTo(lat: number, lng: number, zoom: number, pitch = 55): void {
    this.applyWalking(false);
    this.map.flyTo({ center: [lng, lat], zoom, pitch, speed: 1.1, essential: true });
  }

  highlight(shapes: Feature[]): void {
    const data: FeatureCollection = { type: 'FeatureCollection', features: shapes };
    const apply = () =>
      (this.map.getSource('highlight') as GeoJSONSource | undefined)?.setData(data);
    if (this.map.isStyleLoaded()) apply();
    else this.map.once('load', apply);
  }

  /** Active ou quitte le mode marche à l'endroit visé. */
  setWalking(on: boolean): void {
    if (on === this.walking) return;
    this.applyWalking(on);
    if (on) {
      this.map.easeTo({ zoom: WALK_ZOOM, pitch: WALK_PITCH, duration: 1800 });
    } else {
      this.map.easeTo({ zoom: Math.min(this.map.getZoom(), 17), pitch: 55, duration: 1200 });
    }
  }

  /** Vole jusqu'à un point et s'y pose directement en mode marche. */
  walkAt(lat: number, lng: number): void {
    this.applyWalking(true);
    this.map.flyTo({
      center: [lng, lat],
      zoom: WALK_ZOOM,
      pitch: WALK_PITCH,
      speed: 1.1,
      essential: true,
    });
  }

  private applyWalking(on: boolean): void {
    this.walking = on;
    this.keys.clear();
    // Le clavier doit piloter la marche, pas le champ de recherche resté actif.
    if (on && document.activeElement instanceof HTMLElement) document.activeElement.blur();
    const handlers = [
      this.map.dragPan,
      this.map.dragRotate,
      this.map.keyboard,
      this.map.doubleClickZoom,
    ];
    for (const handler of handlers) {
      if (on) handler.disable();
      else handler.enable();
    }
  }

  /** Maintient (ou relâche) une commande de déplacement, pour les boutons tactiles. */
  hold(code: string, pressed: boolean): void {
    if (pressed) this.keys.add(code);
    else this.keys.delete(code);
  }

  private onKey(e: KeyboardEvent, pressed: boolean): void {
    if (!this.walking || (e.target as HTMLElement).tagName === 'INPUT') return;
    // `code` désigne la position physique de la touche : ZQSD (AZERTY) et
    // WASD (QWERTY) fonctionnent donc tous les deux.
    if (!/^(Key[WASDQE]|Arrow(Up|Down|Left|Right)|Shift(Left|Right))$/.test(e.code)) return;
    e.preventDefault();
    this.hold(e.code, pressed);
  }

  private frame(now: number): void {
    const dt = Math.min(0.25, (now - this.lastFrame) / 1000);
    this.lastFrame = now;
    if (this.walking && this.keys.size > 0 && !this.map.isEasing()) {
      const has = (...codes: string[]) => codes.some((c) => this.keys.has(c));
      const forward = Number(has('KeyW', 'ArrowUp')) - Number(has('KeyS', 'ArrowDown'));
      const strafe = Number(has('KeyD')) - Number(has('KeyA'));
      const turn = Number(has('ArrowRight', 'KeyE')) - Number(has('ArrowLeft', 'KeyQ'));
      const speed = WALK_SPEED * (has('ShiftLeft', 'ShiftRight') ? RUN_FACTOR : 1) * dt;
      let bearing = this.map.getBearing() + turn * TURN_SPEED * dt;
      let { lat, lng } = this.map.getCenter();
      if (forward) ({ lat, lng } = movePoint(lat, lng, bearing, forward * speed));
      if (strafe) ({ lat, lng } = movePoint(lat, lng, bearing + 90, strafe * speed));
      bearing = ((bearing + 540) % 360) - 180;
      this.map.jumpTo({ center: [lng, lat], bearing });
    }
    requestAnimationFrame((t) => this.frame(t));
  }
}
