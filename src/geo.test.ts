import { describe, expect, it } from 'vitest';
import {
  angularDistance,
  countAtLeast,
  flagEmoji,
  formatCoords,
  GLOBE_RADIUS,
  inBBox,
  minPopulationForAltitude,
  normalize,
  toXYZ,
} from './geo';

describe('toXYZ', () => {
  it('place le pôle Nord sur l’axe y', () => {
    const out = [0, 0, 0];
    toXYZ(90, 0, 0, out);
    expect(out[0]).toBeCloseTo(0);
    expect(out[1]).toBeCloseTo(GLOBE_RADIUS);
    expect(out[2]).toBeCloseTo(0);
  });

  it('place (0°, 0°) sur l’axe z et tient compte de l’altitude', () => {
    const out = new Float32Array(6);
    toXYZ(0, 0, 0.5, out, 3);
    expect(out[3]).toBeCloseTo(0);
    expect(out[4]).toBeCloseTo(0);
    expect(out[5]).toBeCloseTo(GLOBE_RADIUS * 1.5);
  });
});

describe('inBBox', () => {
  it('gère une boîte classique', () => {
    expect(inBBox([-5, 41, 10, 51], 2.35, 48.85)).toBe(true);
    expect(inBBox([-5, 41, 10, 51], 13.4, 52.5)).toBe(false);
  });

  it('gère le franchissement de l’antiméridien', () => {
    const fiji: [number, number, number, number] = [177, -19, -178, -16];
    expect(inBBox(fiji, 179, -17)).toBe(true);
    expect(inBBox(fiji, -179, -17)).toBe(true);
    expect(inBBox(fiji, 0, -17)).toBe(false);
  });
});

describe('normalize', () => {
  it('retire accents, casse et ponctuation', () => {
    expect(normalize('  Saint-Étienne ')).toBe('saint etienne');
    expect(normalize("Côte d'Ivoire")).toBe('cote d ivoire');
  });

  it('conserve les écritures non latines', () => {
    expect(normalize('東京')).toBe('東京');
  });
});

describe('formatage', () => {
  it('convertit un code ISO en drapeau', () => {
    expect(flagEmoji('FR')).toBe('🇫🇷');
    expect(flagEmoji('')).toBe('🏳️');
  });

  it('formate des coordonnées', () => {
    expect(formatCoords(48.8566, 2.3522)).toBe('48,8566° N, 2,3522° E');
    expect(formatCoords(-33.45, -70.6667)).toBe('33,4500° S, 70,6667° O');
  });
});

describe('niveau de détail', () => {
  it('montre toutes les villes de très près et moins de villes de loin', () => {
    expect(minPopulationForAltitude(0.05)).toBe(0);
    expect(minPopulationForAltitude(2)).toBeGreaterThan(minPopulationForAltitude(1));
    expect(minPopulationForAltitude(1)).toBe(400_000);
  });

  it('compte les valeurs au-dessus d’un seuil dans un tableau décroissant', () => {
    const pops = [900, 500, 500, 100, 10];
    expect(countAtLeast(pops, 1000)).toBe(0);
    expect(countAtLeast(pops, 500)).toBe(3);
    expect(countAtLeast(pops, 0)).toBe(5);
    expect(countAtLeast([], 5)).toBe(0);
  });
});

describe('angularDistance', () => {
  it('vaut π/2 entre l’équateur et le pôle', () => {
    expect(angularDistance(0, 0, 90, 0)).toBeCloseTo(Math.PI / 2);
    expect(angularDistance(10, 20, 10, 20)).toBe(0);
  });
});
