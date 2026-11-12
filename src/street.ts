import {
  BackSide,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  Scene,
  SphereGeometry,
  SRGBColorSpace,
  TextureLoader,
  WebGLRenderer,
} from 'three';
import { angularDistance } from './geo';

/** Méta-catalogue Panoramax : photos de rue libres (IGN, OpenStreetMap France…). */
const API = 'https://api.panoramax.xyz/api';
const DEG = Math.PI / 180;

export interface StreetPhoto {
  id: string;
  lat: number;
  lng: number;
  imageUrl: string;
  /** Champ de vision horizontal en degrés ; 360 pour une photo sphérique. */
  fov: number;
  date: string;
  author: string;
  license: string;
  /** Adresses des photos précédente et suivante de la même séquence. */
  prev?: string;
  next?: string;
}

interface StacAsset {
  href?: string;
  type?: string;
  roles?: string[];
}

interface StacLink {
  rel?: string;
  type?: string;
  href?: string;
}

interface StacItem {
  id?: string;
  geometry?: { coordinates?: number[] };
  properties?: Record<string, unknown>;
  assets?: Record<string, StacAsset>;
  links?: StacLink[];
}

/** Convertit un élément STAC de l'API Panoramax ; `null` s'il est inutilisable. */
export function parsePhoto(item: StacItem): StreetPhoto | null {
  const [lng, lat] = item.geometry?.coordinates ?? [];
  const assets = Object.values(item.assets ?? {});
  // On préfère la version « visuelle » en JPEG : assez nette, bien plus légère.
  const image =
    assets.find((a) => a.roles?.includes('visual') && a.type === 'image/jpeg') ??
    assets.find((a) => a.roles?.includes('visual')) ??
    assets.find((a) => a.roles?.includes('data'));
  if (!item.id || typeof lat !== 'number' || typeof lng !== 'number' || !image?.href) return null;

  const props = item.properties ?? {};
  const orientation = props['pers:interior_orientation'] as { field_of_view?: number } | undefined;
  const link = (rel: string) =>
    item.links?.find((l) => l.rel === rel && l.type === 'application/geo+json')?.href;
  return {
    id: item.id,
    lat,
    lng,
    imageUrl: image.href,
    fov: Number(orientation?.field_of_view) || 70,
    date: String(props.datetime ?? '').slice(0, 10),
    author: String(props['geovisio:producer'] ?? ''),
    license: String(props.license ?? ''),
    prev: link('prev'),
    next: link('next'),
  };
}

/** Photo la plus proche d'un point parmi une liste. */
export function nearestPhoto(photos: StreetPhoto[], lat: number, lng: number): StreetPhoto | null {
  let best: StreetPhoto | null = null;
  let bestDistance = Infinity;
  for (const photo of photos) {
    const d = angularDistance(lat, lng, photo.lat, photo.lng);
    if (d < bestDistance) {
      bestDistance = d;
      best = photo;
    }
  }
  return best;
}

/** Cherche la photo de rue la plus proche, en élargissant le rayon peu à peu. */
export async function findPhotoNear(
  lat: number,
  lng: number,
  signal?: AbortSignal,
): Promise<StreetPhoto | null> {
  // Rayons en degrés : environ 100 m, 500 m puis 3 km.
  for (const radius of [0.001, 0.005, 0.03]) {
    const bbox = [lng - radius, lat - radius, lng + radius, lat + radius]
      .map((v) => v.toFixed(6))
      .join(',');
    const res = await fetch(`${API}/search?bbox=${bbox}&limit=60`, { signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = (await res.json()) as { features?: StacItem[] };
    const photos = (json.features ?? []).map(parsePhoto).filter((p) => p !== null);
    const best = nearestPhoto(photos, lat, lng);
    if (best) return best;
  }
  return null;
}

export async function fetchPhoto(href: string, signal?: AbortSignal): Promise<StreetPhoto | null> {
  const res = await fetch(href, { signal });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return parsePhoto((await res.json()) as StacItem);
}

/**
 * Visionneuse de photos de rue : les photos sphériques sont plaquées à
 * l'intérieur d'une sphère, les photos classiques sur une portion de sphère.
 * On regarde autour de soi en faisant glisser, on zoome à la molette.
 */
export class StreetViewer {
  private readonly renderer: WebGLRenderer;
  private readonly scene = new Scene();
  private readonly camera = new PerspectiveCamera(75, 1, 0.1, 200);
  private readonly material = new MeshBasicMaterial({ side: BackSide });
  private readonly mesh = new Mesh(new SphereGeometry(50, 64, 32), this.material);
  private readonly loader = new TextureLoader().setCrossOrigin('anonymous');
  private yaw = 0;
  private pitch = 0;
  /** Amplitude de regard autorisée (radians) ; infinie pour une photo à 360°. */
  private maxYaw = Infinity;
  private maxPitch = 85 * DEG;
  private drag: { x: number; y: number } | null = null;
  private request = 0;

  constructor(private readonly container: HTMLElement) {
    this.renderer = new WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    container.append(this.renderer.domElement);
    // L'image est vue de l'intérieur : on retourne la sphère pour ne pas l'inverser.
    this.mesh.scale.x = -1;
    this.scene.add(this.mesh);

    const canvas = this.renderer.domElement;
    canvas.style.touchAction = 'none';
    canvas.addEventListener('pointerdown', (e) => {
      this.drag = { x: e.clientX, y: e.clientY };
      canvas.setPointerCapture(e.pointerId);
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!this.drag) return;
      const speed = (this.camera.fov / 75) * 0.25 * DEG;
      this.look(
        this.yaw - (e.clientX - this.drag.x) * speed,
        this.pitch + (e.clientY - this.drag.y) * speed,
      );
      this.drag = { x: e.clientX, y: e.clientY };
    });
    const release = () => (this.drag = null);
    canvas.addEventListener('pointerup', release);
    canvas.addEventListener('pointercancel', release);
    canvas.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        this.camera.fov = Math.min(95, Math.max(25, this.camera.fov + e.deltaY * 0.04));
        this.render();
      },
      { passive: false },
    );
    new ResizeObserver(() => this.resize()).observe(container);
  }

  /** Charge et affiche une photo ; la promesse se résout quand l'image est visible. */
  async show(photo: StreetPhoto): Promise<void> {
    const request = ++this.request;
    const texture = await this.loader.loadAsync(photo.imageUrl);
    if (request !== this.request) {
      texture.dispose();
      return;
    }
    texture.colorSpace = SRGBColorSpace;
    const image = texture.image as { width: number; height: number };
    const full = photo.fov >= 360;
    const horizontal = (full ? 360 : Math.min(photo.fov, 180)) * DEG;
    const vertical = full ? Math.PI : Math.min(Math.PI, (horizontal * image.height) / image.width);

    this.mesh.geometry.dispose();
    // Le centre de l'image (u = 0,5) est placé droit devant, sur l'axe -x.
    this.mesh.geometry = new SphereGeometry(
      50,
      64,
      32,
      Math.PI - horizontal / 2,
      horizontal,
      Math.PI / 2 - vertical / 2,
      vertical,
    );
    this.material.map?.dispose();
    this.material.map = texture;
    this.material.needsUpdate = true;

    this.maxYaw = full ? Infinity : Math.max(0, horizontal / 2 - 20 * DEG);
    this.maxPitch = full ? 85 * DEG : Math.max(0, vertical / 2 - 15 * DEG);
    this.camera.fov = full ? 75 : Math.min(75, (vertical / DEG) * 0.9);
    this.look(full ? this.yaw : 0, full ? this.pitch : 0);
    this.resize();
  }

  private look(yaw: number, pitch: number): void {
    this.yaw = Math.min(this.maxYaw, Math.max(-this.maxYaw, yaw));
    this.pitch = Math.min(this.maxPitch, Math.max(-this.maxPitch, pitch));
    this.render();
  }

  private resize(): void {
    const { clientWidth: w, clientHeight: h } = this.container;
    if (w === 0 || h === 0) return;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.render();
  }

  private render(): void {
    const c = Math.cos(this.pitch);
    this.camera.lookAt(-Math.cos(this.yaw) * c, Math.sin(this.pitch), -Math.sin(this.yaw) * c);
    this.camera.updateProjectionMatrix();
    this.renderer.render(this.scene, this.camera);
  }
}
