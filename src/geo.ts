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
  if (altitude <= 0.07) return 0;
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
