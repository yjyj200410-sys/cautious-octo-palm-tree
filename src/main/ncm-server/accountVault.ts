import { safeStorage } from 'electron';
import Store from 'electron-store';
import type { NcmAccountSnapshot, SavedNcmAccount } from '../../common/ncmAccount';

interface EncryptedAccount extends SavedNcmAccount {
  encryptedCookie: string;
}

interface VaultData {
  accounts: EncryptedAccount[];
  activeUserId: number | null;
}

const vault = new Store<VaultData>({
  name: 'ncm-accounts',
  defaults: { accounts: [], activeUserId: null },
});

function accounts(): EncryptedAccount[] {
  const value = vault.get('accounts');
  return Array.isArray(value) ? value : [];
}

export function listNcmAccounts(): NcmAccountSnapshot {
  return {
    accounts: accounts().map(({ userId, nickname, avatarUrl }) => ({ userId, nickname, avatarUrl })),
    activeUserId: vault.get('activeUserId'),
  };
}

export function saveNcmAccount(account: SavedNcmAccount, cookie: string) {
  if (!Number.isSafeInteger(account.userId) || account.userId <= 0 || !cookie.includes('MUSIC_U=')) {
    throw new Error('Invalid NCM account or cookie');
  }
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('Secure account storage is unavailable');
  }

  const record: EncryptedAccount = {
    userId: account.userId,
    nickname: account.nickname,
    avatarUrl: account.avatarUrl,
    encryptedCookie: safeStorage.encryptString(cookie).toString('base64'),
  };
  vault.set('accounts', [...accounts().filter((item) => item.userId !== account.userId), record]);
  vault.set('activeUserId', account.userId);
  return listNcmAccounts();
}

export function getNcmAccountCookie(userId: number): string | null {
  const record = accounts().find((account) => account.userId === userId);
  if (!record) return null;
  try {
    return safeStorage.decryptString(Buffer.from(record.encryptedCookie, 'base64'));
  } catch {
    return null;
  }
}

export function setActiveNcmAccount(userId: number | null) {
  if (userId !== null && !accounts().some((account) => account.userId === userId)) {
    throw new Error('NCM account not found');
  }
  vault.set('activeUserId', userId);
  return listNcmAccounts();
}

export function removeNcmAccount(userId: number) {
  vault.set('accounts', accounts().filter((account) => account.userId !== userId));
  if (vault.get('activeUserId') === userId) vault.set('activeUserId', null);
  return listNcmAccounts();
}
