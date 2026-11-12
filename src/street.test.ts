import { describe, expect, it } from 'vitest';
import { nearestPhoto, parsePhoto, type StreetPhoto } from './street';

const item = {
  id: 'abc',
  geometry: { coordinates: [5.9285, 43.1245] },
  properties: {
    datetime: '2025-06-01T10:00:00Z',
    'geovisio:producer': 'Testeur',
    license: 'CC-BY-SA-4.0',
    'pers:interior_orientation': { field_of_view: 360 },
  },
  assets: {
    hd: { href: 'https://img.test/hd.jpg', roles: ['data'], type: 'image/jpeg' },
    sd: { href: 'https://img.test/sd.jpg', roles: ['visual'], type: 'image/jpeg' },
    thumb: { href: 'https://img.test/thumb.jpg', roles: ['thumbnail'], type: 'image/jpeg' },
  },
  links: [
    { rel: 'next', type: 'application/geo+json', href: 'https://api.test/items/def' },
    { rel: 'license', href: 'https://creativecommons.org/' },
  ],
};

describe('parsePhoto', () => {
  it('lit position, image allégée, auteur et enchaînement', () => {
    expect(parsePhoto(item)).toEqual({
      id: 'abc',
      lat: 43.1245,
      lng: 5.9285,
      imageUrl: 'https://img.test/sd.jpg',
      fov: 360,
      date: '2025-06-01',
      author: 'Testeur',
      license: 'CC-BY-SA-4.0',
      prev: undefined,
      next: 'https://api.test/items/def',
    });
  });

  it('suppose un champ de vision classique quand il est inconnu', () => {
    expect(parsePhoto({ ...item, properties: {} })?.fov).toBe(70);
  });

  it('se rabat sur l’image d’origine faute de version allégée', () => {
    const photo = parsePhoto({ ...item, assets: { hd: item.assets.hd } });
    expect(photo?.imageUrl).toBe('https://img.test/hd.jpg');
  });

  it('rejette un élément sans image ou sans position', () => {
    expect(parsePhoto({ ...item, assets: {} })).toBeNull();
    expect(parsePhoto({ ...item, geometry: {} })).toBeNull();
  });
});

describe('nearestPhoto', () => {
  const at = (id: string, lat: number, lng: number) => ({ id, lat, lng }) as StreetPhoto;

  it('choisit la photo la plus proche', () => {
    const photos = [at('loin', 43.2, 6), at('près', 43.1246, 5.9286), at('moyen', 43.13, 5.93)];
    expect(nearestPhoto(photos, 43.1244, 5.9284)?.id).toBe('près');
    expect(nearestPhoto([], 0, 0)).toBeNull();
  });
});
