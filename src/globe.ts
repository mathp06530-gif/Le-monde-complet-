import Globe, { type GlobeInstance } from 'globe.gl';
import {
  BufferAttribute,
  BufferGeometry,
  LineBasicMaterial,
  LineSegments,
  Points,
  PointsMaterial,
} from 'three';
import type { MultiLineString } from 'geojson';
import type { CountryFeature, RegionFeature, World } from './data';
import { EarthMaterial } from './earth-material';
import { countAtLeast, GLOBE_RADIUS, minPopulationForAltitude, toXYZ } from './geo';

const IMG = `${import.meta.env.BASE_URL}img/`;
const REGION_BORDERS_MAX_ALTITUDE = 1.3;
/** Altitude minimale du globe ; en dessous, la vue au sol prend le relais. */
export const MIN_ORBIT_ALTITUDE = 0.09;

function buildLines(lines: MultiLineString, altitude: number, material: LineBasicMaterial) {
  let segments = 0;
  for (const line of lines.coordinates) segments += Math.max(0, line.length - 1);
  const positions = new Float32Array(segments * 6);
  let o = 0;
  for (const line of lines.coordinates) {
    for (let i = 1; i < line.length; i++) {
      toXYZ(line[i - 1][1], line[i - 1][0], altitude, positions, o);
      toXYZ(line[i][1], line[i][0], altitude, positions, o + 3);
      o += 6;
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(positions, 3));
  return new LineSegments(geometry, material);
}

export interface GlobeClick {
  lat: number;
  lng: number;
}

/** Le globe 3D et ses couches : frontières, régions, villes, surbrillance. */
export class WorldGlobe {
  readonly globe: GlobeInstance;
  /** Positions des villes (x, y, z), dans le même ordre que `world.cities`. */
  readonly cityPositions: Float32Array;
  /** Nombre de villes actuellement affichées (les plus peuplées d'abord). */
  visibleCities = 0;

  private readonly regionLines: LineSegments;
  private readonly cityPoints: Points;
  private readonly earth = new EarthMaterial(IMG);
  private cloudsEnabled = true;
  private regionsEnabled = true;
  private citiesEnabled = true;

  constructor(
    container: HTMLElement,
    private readonly world: World,
    onClick: (click: GlobeClick) => void,
    onViewChange: () => void,
  ) {
    this.globe = new Globe(container, { animateIn: false })
      .globeMaterial(this.earth.material)
      .backgroundImageUrl(`${IMG}night-sky.png`)
      .atmosphereColor('#6aa8ff')
      .atmosphereAltitude(0.16)
      .polygonsTransitionDuration(0)
      .polygonAltitude(0.004)
      .polygonCapColor(() => 'rgba(0, 255, 156, 0.14)')
      .polygonSideColor(() => 'rgba(0, 255, 156, 0.3)')
      .polygonStrokeColor(() => '#00ff9c')
      .onGlobeClick(({ lat, lng }) => onClick({ lat, lng }))
      .onPolygonClick((_polygon, _event, { lat, lng }) => onClick({ lat, lng }));

    const scene = this.globe.scene();
    scene.add(
      buildLines(
        world.countryBorders,
        0.0016,
        new LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55 }),
      ),
    );
    this.regionLines = buildLines(
      world.regionBorders,
      0.0012,
      new LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.22 }),
    );
    scene.add(this.regionLines);

    const { lat, lng } = world.cities;
    this.cityPositions = new Float32Array(lat.length * 3);
    for (let i = 0; i < lat.length; i++) toXYZ(lat[i], lng[i], 0.002, this.cityPositions, i * 3);
    const cityGeometry = new BufferGeometry();
    cityGeometry.setAttribute('position', new BufferAttribute(this.cityPositions, 3));
    this.cityPoints = new Points(
      cityGeometry,
      new PointsMaterial({ color: 0x9dffe0, size: 3, sizeAttenuation: false }),
    );
    scene.add(this.cityPoints);

    const controls = this.globe.controls();
    controls.minDistance = GLOBE_RADIUS * (1 + MIN_ORBIT_ALTITUDE);
    controls.maxDistance = GLOBE_RADIUS * 6;
    controls.autoRotateSpeed = 0.35;
    controls.addEventListener('change', () => {
      this.updateLevelOfDetail();
      onViewChange();
    });

    const resize = () => this.globe.width(window.innerWidth).height(window.innerHeight);
    window.addEventListener('resize', resize);
    resize();
    this.globe.pointOfView({ lat: 30, lng: 10, altitude: 2.2 });
    this.updateLevelOfDetail();
  }

  get altitude(): number {
    return this.globe.camera().position.length() / GLOBE_RADIUS - 1;
  }

  private updateLevelOfDetail(): void {
    const altitude = this.altitude;
    this.regionLines.visible = this.regionsEnabled && altitude < REGION_BORDERS_MAX_ALTITUDE;
    this.visibleCities = this.citiesEnabled
      ? countAtLeast(this.world.cities.pop, minPopulationForAltitude(altitude))
      : 0;
    this.cityPoints.geometry.setDrawRange(0, this.visibleCities);
    this.earth.setClouds(this.cloudsEnabled, altitude);
  }

  /** À appeler à chaque image : met à jour le soleil et la dérive des nuages. */
  tick(now: number): void {
    this.earth.setDate(new Date());
    this.earth.drift(now / 1000);
  }

  setRealSun(on: boolean): void {
    this.earth.setRealSun(on);
  }

  setCloudsEnabled(on: boolean): void {
    this.cloudsEnabled = on;
    this.updateLevelOfDetail();
  }

  /** Suspend ou reprend le rendu (le globe est masqué pendant la vue au sol). */
  setPaused(paused: boolean): void {
    if (paused) this.globe.pauseAnimation();
    else this.globe.resumeAnimation();
  }

  setRegionsEnabled(on: boolean): void {
    this.regionsEnabled = on;
    this.updateLevelOfDetail();
  }

  setCitiesEnabled(on: boolean): void {
    this.citiesEnabled = on;
    this.updateLevelOfDetail();
  }

  setAutoRotate(on: boolean): void {
    this.globe.controls().autoRotate = on;
    if (!on) this.settle();
  }

  /**
   * Annule l'élan résiduel des contrôles (inertie de la rotation automatique),
   * qui décalerait sinon la destination d'un déplacement de caméra.
   */
  private settle(): void {
    const controls = this.globe.controls();
    controls.enableDamping = false;
    controls.update();
    controls.enableDamping = true;
  }

  highlight(shapes: (CountryFeature | RegionFeature)[]): void {
    this.globe.polygonsData(shapes);
  }

  flyTo(lat: number, lng: number, altitude: number, ms = 1200): void {
    this.settle();
    this.globe.pointOfView({ lat, lng, altitude: Math.max(altitude, MIN_ORBIT_ALTITUDE) }, ms);
  }

  /** Point visé par la caméra. */
  get center(): { lat: number; lng: number } {
    const { lat, lng } = this.globe.pointOfView();
    return { lat, lng };
  }
}
