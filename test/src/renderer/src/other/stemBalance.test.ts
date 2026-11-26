import { describe, expect, it } from 'vitest';

import {
  mixToStemBalance,
  stemBalanceMix
} from '../../../../../src/renderer/src/components/Volo/stemBalance';

describe('cassette stem crossfader', () => {
  it('isolates vocals on the left and accompaniment on the right', () => {
    expect(stemBalanceMix(-100)).toEqual({ vocals: 100, accompaniment: 0 });
    expect(stemBalanceMix(100)).toEqual({ vocals: 0, accompaniment: 100 });
    expect(stemBalanceMix(0)).toEqual({ vocals: 100, accompaniment: 100 });
  });
  it('recovers the persisted slider position without changing gains or amplifying stems', () => {
    for (let position = -100; position <= 100; position++) {
      const mix = stemBalanceMix(position);
      expect(mixToStemBalance(mix.vocals, mix.accompaniment)).toBe(position);
      expect(Math.max(mix.vocals, mix.accompaniment)).toBe(100);
    }
  });
  it('clamps invalid UI values to a safe mix', () => {
    expect(stemBalanceMix(Infinity)).toEqual(stemBalanceMix(0));
    expect(stemBalanceMix(-200)).toEqual(stemBalanceMix(-100));
    expect(stemBalanceMix(200)).toEqual(stemBalanceMix(100));
  });
});
