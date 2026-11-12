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
import { countAtLeast, GLOBE_RADIUS, minPopulationForAltitude, toXYZ } from './geo';

const IMG = `${import.meta.env.BASE_URL}img/`;
const REGION_BORDERS_MAX_ALTITUDE = 1.3;

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
  private regionsEnabled = true;
  private citiesEnabled = true;

  constructor(
    container: HTMLElement,
    private readonly world: World,
    onClick: (click: GlobeClick) => void,
    onViewChange: () => void,
  ) {
    this.globe = new Globe(container, { animateIn: false })
      .globeImageUrl(`${IMG}earth-blue-marble.jpg`)
      .bumpImageUrl(`${IMG}earth-topology.png`)
      .backgroundImageUrl(`${IMG}night-sky.png`)
      .atmosphereColor('#7fb6ff')
      .atmosphereAltitude(0.18)
      .polygonsTransitionDuration(0)
      .polygonAltitude(0.004)
      .polygonCapColor(() => 'rgba(255, 196, 61, 0.22)')
      .polygonSideColor(() => 'rgba(255, 196, 61, 0.35)')
      .polygonStrokeColor(() => '#ffc43d')
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
      new PointsMaterial({ color: 0xffe08a, size: 3.5, sizeAttenuation: false }),
    );
    scene.add(this.cityPoints);

    const controls = this.globe.controls();
    controls.minDistance = GLOBE_RADIUS * 1.015;
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
  }

  setRegionsEnabled(on: boolean): void {
    this.regionsEnabled = on;
    this.updateLevelOfDetail();
  }

  setCitiesEnabled(on: boolean): void {
    this.citiesEnabled = on;
    this.updateLevelOfDetail();
  }

  setNight(on: boolean): void {
    this.globe.globeImageUrl(`${IMG}${on ? 'earth-night.jpg' : 'earth-blue-marble.jpg'}`);
  }

  setAutoRotate(on: boolean): void {
    this.globe.controls().autoRotate = on;
  }

  highlight(shape: CountryFeature | RegionFeature | null): void {
    this.globe.polygonsData(shape ? [shape] : []);
  }

  flyTo(lat: number, lng: number, altitude: number): void {
    this.globe.pointOfView({ lat, lng, altitude }, 1200);
  }
}
