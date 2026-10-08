import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';

import type { NcmAccountSnapshot, SavedNcmAccount } from '../../../common/ncmAccount';
import { cookieManager, ncmApi, type UserProfile } from '../api/ncm-client';
import { NcmPlaybackResolver } from '../music-source/netease/NcmPlaybackResolver';
import { DiscoverProvider } from '../ncm/discover/DiscoverProvider';
import { NcmHomeRepository } from '../ncm/home/NcmHomeRepository';
import { NcmRepository } from '../ncm/repository';
import { setLibraryPanel } from '../store/routeStateStore';
import { FavoriteService } from '../utils/unifiedStorage';

interface NcmUserState {
  isLoggedIn: boolean;
  profile: UserProfile | null;
  cookieReady: boolean;
  loading: boolean;
  savedAccounts: SavedNcmAccount[];
  activeUserId: number | null;
}

interface NcmUserContextType extends NcmUserState {
  login: (cookie: string, profile: UserProfile) => Promise<void>;
  switchAccount: (userId: number) => Promise<void>;
  removeAccount: (userId: number) => Promise<void>;
  logout: () => Promise<void>;
  restoreSession: () => Promise<void>;
}

const NcmUserContext = createContext<NcmUserContextType | null>(null);

/** 当前登录用户的网易云 uid — 供非 React 代码（如 toggleSongIsFavorite）使用 */
export let currentNcmUid = 0;

function clearAccountCaches() {
  NcmRepository.clearCache();
  NcmHomeRepository.clearAccountCache();
  DiscoverProvider.resetAccount();
  NcmPlaybackResolver.clearCache();
  FavoriteService.clearSource('netease');
  setLibraryPanel({ kind: null });
}

export function NcmUserProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<NcmUserState>({
    isLoggedIn: false,
    profile: null,
    cookieReady: false,
    loading: true,
    savedAccounts: [],
    activeUserId: null,
  });
  const operationRef = useRef(0);

  const establishSession = useCallback(
    (cookie: string, profile: UserProfile, snapshot: NcmAccountSnapshot) => {
      clearAccountCaches();
      cookieManager.set(cookie);
      currentNcmUid = profile.userId;
      setState({
        isLoggedIn: true,
        profile,
        cookieReady: true,
        loading: false,
        savedAccounts: snapshot.accounts,
        activeUserId: profile.userId,
      });
      void NcmHomeRepository.prefetchLikedSongs(profile.userId).catch(() => {});
    },
    [],
  );

  const clearSession = useCallback((snapshot: NcmAccountSnapshot) => {
    clearAccountCaches();
    cookieManager.clear();
    currentNcmUid = 0;
    setState({
      isLoggedIn: false,
      profile: null,
      cookieReady: false,
      loading: false,
      savedAccounts: snapshot.accounts,
      activeUserId: null,
    });
  }, []);

  const login = useCallback(
    async (cookie: string, profile: UserProfile) => {
      if (!profile.userId || !cookie.includes('MUSIC_U=')) {
        throw new Error('未获取到有效的网易云账号，请重新扫码');
      }
      const snapshot = await window.api.ncm.saveAccount(
        { userId: profile.userId, nickname: profile.nickname, avatarUrl: profile.avatarUrl },
        cookie,
      );
      operationRef.current += 1;
      cookieManager.clearLegacyStorage();
      establishSession(cookie, profile, snapshot);
    },
    [establishSession],
  );

  const switchAccount = useCallback(
    async (userId: number) => {
      if (userId === state.activeUserId && state.isLoggedIn) return;
      const cookie = await window.api.ncm.getAccountCookie(userId);
      if (!cookie?.includes('MUSIC_U=')) throw new Error('这个账号的登录信息已失效，请重新扫码添加');

      let result;
      try {
        result = await ncmApi.loginStatus(cookie);
      } catch {
        throw new Error('暂时无法验证账号，请检查网络后重试');
      }
      const profile = result?.data?.profile;
      if (result?.data?.code !== 200 || !profile || profile.userId !== userId) {
        throw new Error('这个账号的登录信息已过期，请重新扫码添加');
      }
      const snapshot = await window.api.ncm.activateAccount(userId);
      operationRef.current += 1;
      establishSession(cookie, profile, snapshot);
    },
    [establishSession, state.activeUserId, state.isLoggedIn],
  );

  const logout = useCallback(async () => {
    const userId = state.activeUserId;
    if (userId === null) return;
    const snapshot = await window.api.ncm.removeAccount(userId);
    try {
      await ncmApi.logout();
    } catch {
      // 远端注销失败时仍移除本机保存的登录信息。
    }
    operationRef.current += 1;
    clearSession(snapshot);
  }, [clearSession, state.activeUserId]);

  const removeAccount = useCallback(
    async (userId: number) => {
      if (userId === state.activeUserId) {
        await logout();
        return;
      }
      const snapshot = await window.api.ncm.removeAccount(userId);
      setState((previous) => ({ ...previous, savedAccounts: snapshot.accounts }));
    },
    [logout, state.activeUserId],
  );

  const restoreSession = useCallback(async () => {
    const operation = ++operationRef.current;
    const legacyCookie = cookieManager.get();
    let snapshot: NcmAccountSnapshot = { accounts: [], activeUserId: null };

    try {
      snapshot = await window.api.ncm.listAccounts();
      if (legacyCookie.includes('MUSIC_U=') && snapshot.accounts.length === 0) {
        const result = await ncmApi.loginStatus(legacyCookie);
        const profile = result?.data?.profile;
        if (result?.data?.code === 200 && profile?.userId) {
          snapshot = await window.api.ncm.saveAccount(
            { userId: profile.userId, nickname: profile.nickname, avatarUrl: profile.avatarUrl },
            legacyCookie,
          );
          if (operation !== operationRef.current) return;
          cookieManager.clearLegacyStorage();
          establishSession(legacyCookie, profile, snapshot);
          return;
        }
      }

      cookieManager.clearLegacyStorage();
      cookieManager.set('');
      if (snapshot.activeUserId !== null) {
        const cookie = await window.api.ncm.getAccountCookie(snapshot.activeUserId);
        if (cookie?.includes('MUSIC_U=')) {
          const result = await ncmApi.loginStatus(cookie);
          const profile = result?.data?.profile;
          if (result?.data?.code === 200 && profile?.userId === snapshot.activeUserId) {
            if (operation !== operationRef.current) return;
            establishSession(cookie, profile, snapshot);
            return;
          }
        }
        snapshot = await window.api.ncm.activateAccount(null);
      }
      if (operation !== operationRef.current) return;
      clearSession(snapshot);
    } catch {
      if (operation !== operationRef.current) return;
      cookieManager.set('');
      currentNcmUid = 0;
      setState({
        isLoggedIn: false,
        profile: null,
        cookieReady: false,
        loading: false,
        savedAccounts: snapshot.accounts,
        activeUserId: null,
      });
    }
  }, [clearSession, establishSession]);

  useEffect(() => {
    void restoreSession();
  }, [restoreSession]);

  return (
    <NcmUserContext.Provider
      value={{ ...state, login, switchAccount, removeAccount, logout, restoreSession }}
    >
      {children}
    </NcmUserContext.Provider>
  );
}

export function useNcmUser(): NcmUserContextType {
  const ctx = useContext(NcmUserContext);
  if (!ctx) throw new Error('useNcmUser must be used within NcmUserProvider');
  return ctx;
}
