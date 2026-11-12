import { describe, expect, it } from 'vitest';
import { parseScanUrl, sanitizeScans, scansNear, type Scan } from './scans';

describe('parseScanUrl', () => {
  it('accepte uniquement les adresses HTTPS', () => {
    expect(parseScanUrl(' https://superspl.at/s?id=abc ')).toBe('https://superspl.at/s?id=abc');
    expect(parseScanUrl('http://exemple.fr/scan')).toBeNull();
    expect(parseScanUrl('javascript:alert(1)')).toBeNull();
    expect(parseScanUrl('pas une adresse')).toBeNull();
  });
});

describe('sanitizeScans', () => {
  it('écarte les entrées mal formées', () => {
    const good = { name: 'Hameau', url: 'https://exemple.fr/s', lat: 48.8, lng: 2.1 };
    expect(sanitizeScans([good, { name: 'x' }, null, { ...good, url: 'ftp://x' }])).toEqual([good]);
    expect(sanitizeScans('rien')).toEqual([]);
  });
});

describe('scansNear', () => {
  const paris: Scan = { name: 'Paris', url: 'https://a.fr', lat: 48.8566, lng: 2.3522 };
  const versailles: Scan = { name: 'Versailles', url: 'https://b.fr', lat: 48.8049, lng: 2.1204 };
  const tokyo: Scan = { name: 'Tokyo', url: 'https://c.fr', lat: 35.68, lng: 139.69 };

  it('trie par distance et respecte le rayon', () => {
    const near = scansNear([tokyo, paris, versailles], 48.8, 2.13, 30);
    expect(near.map((s) => s.name)).toEqual(['Versailles', 'Paris']);
  });
});
