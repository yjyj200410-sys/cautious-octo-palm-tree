import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const data = new Map<string, unknown>();
  return { data, encryptionAvailable: true };
});

vi.mock('electron-store', () => ({
  default: class {
    constructor(options: { defaults: Record<string, unknown> }) {
      for (const [key, value] of Object.entries(options.defaults)) {
        if (!mocks.data.has(key)) mocks.data.set(key, value);
      }
    }
    get(key: string) { return mocks.data.get(key); }
    set(key: string, value: unknown) { mocks.data.set(key, value); }
  },
}));

vi.mock('electron', () => ({
  safeStorage: {
    isEncryptionAvailable: () => mocks.encryptionAvailable,
    encryptString: (value: string) => Buffer.from(`sealed:${value}`),
    decryptString: (value: Buffer) => {
      const text = value.toString();
      if (!text.startsWith('sealed:')) throw new Error('Invalid encrypted data');
      return text.slice('sealed:'.length);
    },
  },
}));

import {
  getNcmAccountCookie, listNcmAccounts, removeNcmAccount,
  saveNcmAccount, setActiveNcmAccount,
} from '../../../../src/main/ncm-server/accountVault';

beforeEach(() => {
  mocks.data.set('accounts', []);
  mocks.data.set('activeUserId', null);
  mocks.encryptionAvailable = true;
});

describe('NCM account vault', () => {
  const alice = { userId: 101, nickname: 'Alice', avatarUrl: 'https://example.com/a.png' };
  const bob = { userId: 202, nickname: 'Bob', avatarUrl: 'https://example.com/b.png' };

  it('saves encrypted cookies and exposes only account metadata in the list', () => {
    const snapshot = saveNcmAccount(alice, 'MUSIC_U=alice-secret');
    expect(snapshot).toEqual({ accounts: [alice], activeUserId: 101 });
    expect(getNcmAccountCookie(101)).toBe('MUSIC_U=alice-secret');
    expect(JSON.stringify(mocks.data.get('accounts'))).not.toContain('MUSIC_U=alice-secret');
  });

  it('keeps multiple accounts and switches without erasing the previous credential', () => {
    saveNcmAccount(alice, 'MUSIC_U=alice-secret');
    saveNcmAccount(bob, 'MUSIC_U=bob-secret');
    expect(setActiveNcmAccount(101).activeUserId).toBe(101);
    expect(getNcmAccountCookie(202)).toBe('MUSIC_U=bob-secret');
    expect(listNcmAccounts().accounts).toEqual([alice, bob]);
  });

  it('removes only the selected account and clears active selection when necessary', () => {
    saveNcmAccount(alice, 'MUSIC_U=alice-secret');
    saveNcmAccount(bob, 'MUSIC_U=bob-secret');
    expect(removeNcmAccount(101)).toEqual({ accounts: [bob], activeUserId: 202 });
    expect(removeNcmAccount(202)).toEqual({ accounts: [], activeUserId: null });
  });

  it('does not save plaintext when secure storage is unavailable', () => {
    mocks.encryptionAvailable = false;
    expect(() => saveNcmAccount(alice, 'MUSIC_U=alice-secret')).toThrow();
    expect(listNcmAccounts().accounts).toEqual([]);
  });
});
