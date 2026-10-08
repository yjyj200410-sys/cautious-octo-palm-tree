import { describe, expect, it } from 'vitest';
import { adaptSong } from '../../../../../src/renderer/src/ncm/adapters';

describe('VIP song metadata', () => {
  it.each([1, 8])('marks membership fee %s as VIP', fee => {
    expect(adaptSong({ id: 1, fee }).isVip).toBe(true);
  });
  it.each([0, 4, undefined])('does not mark non-membership fee %s as VIP', fee => {
    expect(adaptSong({ id: 1, fee }).isVip).toBe(false);
  });
  it('uses privilege fee when the top-level fee is absent', () => {
    expect(adaptSong({ id: 1, privilege: { fee: 1 } }).isVip).toBe(true);
  });
});