import { describe, expect, it } from 'vitest';
import { matchKeys } from './search';

describe('matchKeys', () => {
  const keys = ['paris', 'saint paris', 'parme', 'lyon', 'paray le monial'];

  it('place les préfixes avant les correspondances internes', () => {
    expect(matchKeys(keys, 'par', 10)).toEqual([0, 2, 4, 1]);
  });

  it('respecte la limite', () => {
    expect(matchKeys(keys, 'par', 2)).toEqual([0, 2]);
  });

  it('renvoie une liste vide sans requête ni résultat', () => {
    expect(matchKeys(keys, '', 5)).toEqual([]);
    expect(matchKeys(keys, 'tokyo', 5)).toEqual([]);
  });
});
