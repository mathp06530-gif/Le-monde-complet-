import { angularDistance } from './geo';

/**
 * Lieu réel numérisé en 3D (« Gaussian splat »), publié sur une plateforme
 * comme SuperSplat (PlayCanvas) et affiché ici dans une visionneuse intégrée.
 */
export interface Scan {
  name: string;
  url: string;
  lat: number;
  lng: number;
}

const STORAGE_KEY = 'le-monde-complet:scans';
const EARTH_RADIUS_KM = 6371;

/** Valide une adresse de scan : seules les pages HTTPS sont acceptées. */
export function parseScanUrl(text: string): string | null {
  try {
    const url = new URL(text.trim());
    return url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
}

function isScan(value: unknown): value is Scan {
  const s = value as Scan;
  return (
    typeof s === 'object' &&
    s !== null &&
    typeof s.name === 'string' &&
    typeof s.lat === 'number' &&
    typeof s.lng === 'number' &&
    typeof s.url === 'string' &&
    parseScanUrl(s.url) !== null
  );
}

/** Ne garde que les entrées bien formées d'une liste d'origine incertaine. */
export function sanitizeScans(value: unknown): Scan[] {
  return Array.isArray(value) ? value.filter(isScan) : [];
}

/** Scans situés à moins de `radiusKm` d'un point, du plus proche au plus lointain. */
export function scansNear(
  scans: readonly Scan[],
  lat: number,
  lng: number,
  radiusKm: number,
): Scan[] {
  return scans
    .map((scan) => ({
      scan,
      km: angularDistance(lat, lng, scan.lat, scan.lng) * EARTH_RADIUS_KM,
    }))
    .filter((entry) => entry.km <= radiusKm)
    .sort((a, b) => a.km - b.km)
    .map((entry) => entry.scan);
}

/** Catalogue des scans : ceux livrés avec l'application et ceux ajoutés par l'utilisateur. */
export class ScanLibrary {
  private builtIn: Scan[] = [];
  private custom: Scan[] = [];

  async load(): Promise<void> {
    try {
      this.custom = sanitizeScans(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]'));
    } catch {
      this.custom = [];
    }
    try {
      const res = await fetch(`${import.meta.env.BASE_URL}data/scans.json`);
      if (res.ok) this.builtIn = sanitizeScans(await res.json());
    } catch {
      this.builtIn = [];
    }
  }

  get all(): Scan[] {
    return [...this.builtIn, ...this.custom];
  }

  isCustom(scan: Scan): boolean {
    return this.custom.includes(scan);
  }

  add(scan: Scan): void {
    this.custom.push(scan);
    this.save();
  }

  remove(scan: Scan): void {
    this.custom = this.custom.filter((s) => s !== scan);
    this.save();
  }

  private save(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.custom));
    } catch {
      // Stockage indisponible (navigation privée) : les ajouts durent la session.
    }
  }
}
