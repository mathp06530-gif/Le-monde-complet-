/** Fonctions utilitaires pures (géométrie, formatage) — sans dépendance au DOM. */

export const GLOBE_RADIUS = 100;

/** [ouest, sud, est, nord] ; ouest > est quand la boîte franchit l'antiméridien. */
export type BBox = [number, number, number, number];

/**
 * Convertit latitude/longitude en coordonnées cartésiennes, avec la même
 * convention que three-globe (y vers le pôle Nord).
 */
export function toXYZ(
  lat: number,
  lng: number,
  altitude: number,
  out: Float32Array | number[],
  offset = 0,
): void {
  const phi = ((90 - lat) * Math.PI) / 180;
  const theta = ((90 - lng) * Math.PI) / 180;
  const r = GLOBE_RADIUS * (1 + altitude);
  out[offset] = r * Math.sin(phi) * Math.cos(theta);
  out[offset + 1] = r * Math.cos(phi);
  out[offset + 2] = r * Math.sin(phi) * Math.sin(theta);
}

export function inBBox([w, s, e, n]: BBox, lng: number, lat: number): boolean {
  if (lat < s || lat > n) return false;
  return w <= e ? lng >= w && lng <= e : lng >= w || lng <= e;
}

/** Minuscule, sans accents ni ponctuation : sert de clé de recherche. */
export function normalize(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9Ͱ-￿]+/g, ' ')
    .trim();
}

/** Drapeau emoji à partir d'un code ISO 3166-1 alpha-2. */
export function flagEmoji(a2: string): string {
  if (!/^[A-Z]{2}$/.test(a2)) return '🏳️';
  return String.fromCodePoint(...[...a2].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65));
}

const numberFormat = new Intl.NumberFormat('fr-FR');
export function formatNumber(n: number): string {
  return numberFormat.format(n);
}

export function formatCoords(lat: number, lng: number): string {
  const f = (v: number, pos: string, neg: string) =>
    `${Math.abs(v).toFixed(4).replace('.', ',')}° ${v >= 0 ? pos : neg}`;
  return `${f(lat, 'N', 'S')}, ${f(lng, 'E', 'O')}`;
}

/**
 * Population minimale d'une ville pour être affichée à une altitude de caméra
 * donnée (en rayons terrestres). Plus on zoome, plus on montre de villes.
 */
export function minPopulationForAltitude(altitude: number): number {
  if (altitude <= 0.13) return 0;
  return Math.round(400_000 * altitude ** 2.2);
}

/** Nombre d'éléments >= min dans un tableau trié par ordre décroissant. */
export function countAtLeast(sortedDesc: ArrayLike<number>, min: number): number {
  let lo = 0;
  let hi = sortedDesc.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (sortedDesc[mid] >= min) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** Distance angulaire (radians) entre deux points donnés en degrés. */
export function angularDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const r = Math.PI / 180;
  const dLat = (lat2 - lat1) * r;
  const dLng = (lng2 - lng1) * r;
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(dLng / 2) ** 2;
  return 2 * Math.asin(Math.min(1, Math.sqrt(a)));
}

/**
 * Point subsolaire (là où le Soleil est au zénith) à un instant donné.
 * Précision de l'ordre du degré, largement suffisante pour l'éclairage.
 */
export function subsolarPoint(date: Date): { lat: number; lng: number } {
  const start = Date.UTC(date.getUTCFullYear(), 0, 0);
  const dayOfYear = (date.getTime() - start) / 86_400_000;
  const lat = -23.44 * Math.cos(((2 * Math.PI) / 365) * (dayOfYear + 10));
  const b = (2 * Math.PI * (dayOfYear - 81)) / 364;
  const equationOfTime = 9.87 * Math.sin(2 * b) - 7.53 * Math.cos(b) - 1.5 * Math.sin(b);
  const hours = date.getUTCHours() + date.getUTCMinutes() / 60 + date.getUTCSeconds() / 3600;
  let lng = -15 * (hours - 12 + equationOfTime / 60);
  lng = ((((lng + 180) % 360) + 360) % 360) - 180;
  return { lat, lng };
}

const EARTH_RADIUS_M = 6_371_000;
/** Demi-angle de vue vertical de la caméra du globe (50° au total). */
const GLOBE_HALF_FOV = (25 * Math.PI) / 180;
/** Mètres par pixel au zoom 0 à l'équateur, pour des tuiles de 512 px. */
const METERS_PER_PIXEL_Z0 = 78_271.517;

/**
 * Zoom cartographique montrant la même étendue de terrain que le globe vu à
 * une altitude donnée (en rayons terrestres), pour une fenêtre de `height` px.
 */
export function zoomForAltitude(altitude: number, lat: number, height: number): number {
  const visibleMeters = 2 * altitude * EARTH_RADIUS_M * Math.tan(GLOBE_HALF_FOV);
  const cos = Math.max(0.05, Math.cos((lat * Math.PI) / 180));
  return Math.log2((METERS_PER_PIXEL_Z0 * cos * height) / visibleMeters);
}

/** Réciproque de `zoomForAltitude`. */
export function altitudeForZoom(zoom: number, lat: number, height: number): number {
  const cos = Math.max(0.05, Math.cos((lat * Math.PI) / 180));
  const visibleMeters = (METERS_PER_PIXEL_Z0 * cos * height) / 2 ** zoom;
  return visibleMeters / (2 * EARTH_RADIUS_M * Math.tan(GLOBE_HALF_FOV));
}

/** Altitude lisible : mètres sous 1 km, kilomètres au-delà. */
export function formatDistance(meters: number): string {
  return meters < 1000
    ? `${Math.round(meters)} m`
    : `${formatNumber(Math.round(meters / 1000))} km`;
}

/** Déplace un point de `meters` mètres dans la direction `bearing` (degrés). */
export function movePoint(
  lat: number,
  lng: number,
  bearing: number,
  meters: number,
): { lat: number; lng: number } {
  const rad = (bearing * Math.PI) / 180;
  const dLat = (meters * Math.cos(rad)) / 111_320;
  const cos = Math.max(0.01, Math.cos((lat * Math.PI) / 180));
  const dLng = (meters * Math.sin(rad)) / (111_320 * cos);
  return { lat: Math.max(-85, Math.min(85, lat + dLat)), lng: lng + dLng };
}
