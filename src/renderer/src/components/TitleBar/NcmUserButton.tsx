import { lazy, memo, useState, useRef, useCallback, useEffect } from 'react';

import { useNcmUser } from '../../contexts/NcmUserContext';
import type { NcmPlaylist } from '../../ncm';
import LoginDialog from '../LoginDialog/LoginDialog';
import NcmLogoutConfirmDialog from './NcmLogoutConfirmDialog';

const NcmPlaylistsPage = lazy(() => import('../NcmPlaylistsPage'));
const NcmPlaylistDetailPage = lazy(() => import('../NcmPlaylistDetailPage'));

type Page = 'menu' | 'playlists' | 'detail';

const NcmUserButton = memo(() => {
  const {
    isLoggedIn, profile, loading, savedAccounts, activeUserId,
    switchAccount, removeAccount, logout,
  } = useNcmUser();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [logoutConfirmOpen, setLogoutConfirmOpen] = useState(false);
  const [removeUserId, setRemoveUserId] = useState<number | null>(null);
  const [switchingUserId, setSwitchingUserId] = useState<number | null>(null);
  const [accountError, setAccountError] = useState('');
  const btnRef = useRef<HTMLButtonElement>(null);
  const accountMenuRef = useRef<HTMLDivElement>(null);

  // 歌单导航
  const [ncmPage, setNcmPage] = useState<Page>('menu');
  const [ncmPageOpen, setNcmPageOpen] = useState(false);
  const [selectedPlaylist, setSelectedPlaylist] = useState<NcmPlaylist | null>(null);

  const openMenu = useCallback(() => {
    setMenuOpen(true);
  }, []);

  const closeMenu = useCallback(() => setMenuOpen(false), []);

  // Keep the menu interactive without placing a full-window button above the
  // app. The title bar is a native drag region, so a fixed backdrop can steal
  // pointer events from both the menu and the controls underneath it.
  useEffect(() => {
    if (!menuOpen) return;

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (target && !accountMenuRef.current?.contains(target)) closeMenu();
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      closeMenu();
      btnRef.current?.focus();
    };

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [closeMenu, menuOpen]);

  useEffect(() => {
    const openLogin = () => {
      if (isLoggedIn || savedAccounts.length > 0) openMenu();
      else setDialogOpen(true);
    };
    window.addEventListener('open-ncm-login', openLogin);
    return () => window.removeEventListener('open-ncm-login', openLogin);
  }, [isLoggedIn, openMenu, savedAccounts.length]);

  const requestLogout = useCallback(() => {
    setMenuOpen(false);
    setLogoutConfirmOpen(true);
  }, []);

  const confirmLogout = useCallback(async () => {
    await logout();
    setLogoutConfirmOpen(false);
  }, [logout]);

  const handleAddAccount = useCallback(() => {
    setMenuOpen(false);
    setAccountError('');
    setDialogOpen(true);
  }, []);

  const handleSwitchAccount = useCallback(async (userId: number) => {
    if (switchingUserId !== null || (isLoggedIn && activeUserId === userId)) return;
    setSwitchingUserId(userId);
    setAccountError('');
    try {
      await switchAccount(userId);
      setMenuOpen(false);
    } catch (error) {
      setAccountError(error instanceof Error ? error.message : '切换账号失败，请稍后重试');
    } finally {
      setSwitchingUserId(null);
    }
  }, [activeUserId, isLoggedIn, switchAccount, switchingUserId]);

  const confirmRemoveAccount = useCallback(async () => {
    if (removeUserId === null) return;
    await removeAccount(removeUserId);
    setRemoveUserId(null);
  }, [removeAccount, removeUserId]);

  const closeDialog = useCallback(() => setDialogOpen(false), []);

  const openDetail = useCallback((pl: NcmPlaylist) => {
    setSelectedPlaylist(pl);
    setNcmPage('detail');
  }, []);

  const closeNcm = useCallback(() => {
    setNcmPageOpen(false);
    setNcmPage('menu');
    setSelectedPlaylist(null);
  }, []);

  if (loading) return null;

  return (
    <>
      {isLoggedIn || savedAccounts.length > 0 ? (
        <div
          ref={accountMenuRef}
          className="pointer-events-auto relative [-webkit-app-region:no-drag]"
        >
          <button
            ref={btnRef}
            type="button"
            onClick={() => setMenuOpen((isOpen) => !isOpen)}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            aria-label={profile?.nickname ? `账号：${profile.nickname}` : '网易云账号'}
            className="ncm-account-button flex h-11 items-center gap-2 rounded-full px-3 text-xs"
            title={profile?.nickname || '选择网易云账号'}
          >
            {profile?.avatarUrl ? (
              <img
                src={profile.avatarUrl.replace(/^http:/, 'https:') + '?param=40y40'}
                alt=""
                className="h-6 w-6 shrink-0 rounded-full object-cover"
              />
            ) : null}
            <span className="ncm-account-label text-font-color-black/70 dark:text-font-color-white/70 max-w-[96px] truncate">
              {profile?.nickname || '网易云账号'}
            </span>
            <span
              className={`material-icons-round text-font-color-black/45 dark:text-font-color-white/55 text-base leading-none transition-transform ${menuOpen ? 'rotate-180' : ''}`}
              aria-hidden="true"
            >
              expand_more
            </span>
          </button>
          <div
            role="menu"
            aria-label="网易云账号菜单"
            aria-hidden={!menuOpen}
            inert={!menuOpen}
            data-open={menuOpen}
            className="ncm-account-menu pointer-events-auto absolute top-full right-0 z-[51] mt-1 w-[264px] overflow-hidden rounded-xl [-webkit-app-region:no-drag]"
          >
            <div className="border-b border-black/8 px-4 py-3 dark:border-white/10">
              <div className="text-font-color-black/90 dark:text-font-color-white/92 text-sm font-semibold">
                网易云账号
              </div>
              <div className="text-font-color-black/48 dark:text-font-color-white/52 mt-0.5 text-xs">
                {isLoggedIn ? `当前登录：${profile?.nickname || '网易云用户'}` : '选择账号或扫码添加'}
              </div>
            </div>
            <div className="ncm-account-list p-1.5" aria-label="已保存账号">
              {savedAccounts.map((account) => {
                const active = isLoggedIn && account.userId === activeUserId;
                return (
                  <div key={account.userId} className="ncm-account-row flex items-center rounded-lg" data-active={active}>
                    <button
                      type="button"
                      role="menuitem"
                      disabled={switchingUserId !== null}
                      onClick={() => void handleSwitchAccount(account.userId)}
                      className="ncm-account-menu-action flex min-w-0 flex-1 items-center gap-2 rounded-lg px-2.5 py-2 text-left"
                      aria-label={`${active ? '当前账号' : '切换到'} ${account.nickname}`}
                    >
                      {account.avatarUrl ? (
                        <img src={account.avatarUrl.replace(/^http:/, 'https:') + '?param=40y40'} alt="" className="h-8 w-8 shrink-0 rounded-full object-cover" />
                      ) : (
                        <span className="material-icons-round-outlined flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-black/6 text-xl dark:bg-white/10">account_circle</span>
                      )}
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-xs font-medium">{account.nickname || `UID ${account.userId}`}</span>
                        <span className="block truncate text-[11px] opacity-55">UID {account.userId}</span>
                      </span>
                      {active && <span className="material-icons-round text-base opacity-75" aria-label="当前账号">check</span>}
                      {switchingUserId === account.userId && <span className="text-[11px] opacity-65">验证中…</span>}
                    </button>
                    {!active && (
                      <button
                        type="button"
                        role="menuitem"
                        disabled={switchingUserId !== null}
                        onClick={() => { setMenuOpen(false); setRemoveUserId(account.userId); }}
                        className="ncm-account-remove mr-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg"
                        aria-label={`移除 ${account.nickname} 的保存信息`}
                        title="移除已保存账号"
                      >
                        <span className="material-icons-round-outlined text-base">close</span>
                      </button>
                    )}
                  </div>
                );
              })}
              {accountError && <p className="ncm-account-error px-2.5 py-2 text-xs" role="alert">{accountError}</p>}
            </div>
            <div className="border-t border-black/8 p-1.5 dark:border-white/10">
              <button
                type="button"
                role="menuitem"
                onClick={handleAddAccount}
                className="ncm-account-menu-action text-font-color-black/78 dark:text-font-color-white/82 flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm"
              >
                <span className="material-icons-round-outlined text-lg opacity-70">
                  person_add
                </span>
                <span>添加账号</span>
              </button>
              {isLoggedIn && (
                <button
                  type="button"
                  role="menuitem"
                  onClick={requestLogout}
                  className="ncm-account-menu-action text-font-color-crimson flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm"
                >
                  <span className="material-icons-round-outlined text-lg opacity-80">logout</span>
                  退出登录
                </button>
              )}
            </div>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setDialogOpen(true)}
          aria-label="登录网易云"
          className="ncm-account-button flex h-11 items-center gap-2 rounded-full px-3 text-xs"
          title="登录网易云"
        >
          <span className="material-icons-round-outlined text-lg leading-none">account_circle</span>
          <span className="ncm-account-label text-font-color-black dark:text-font-color-white">
            登录网易云
          </span>
        </button>
      )}

      <LoginDialog open={dialogOpen} onClose={closeDialog} />
      <NcmLogoutConfirmDialog
        open={logoutConfirmOpen || removeUserId !== null}
        mode={removeUserId !== null ? 'remove' : 'logout'}
        nickname={removeUserId !== null
          ? savedAccounts.find((account) => account.userId === removeUserId)?.nickname || `UID ${removeUserId}`
          : profile?.nickname || '当前账号'}
        onClose={() => { setLogoutConfirmOpen(false); setRemoveUserId(null); }}
        onConfirm={removeUserId !== null ? confirmRemoveAccount : confirmLogout}
      />

      {/* 歌单页面浮层 */}
      {ncmPageOpen && (
        <div className="fixed inset-0 z-[20000] flex items-center justify-center">
          <button
            type="button"
            aria-label="关闭网易云歌单"
            className="absolute inset-0 cursor-default bg-black/60"
            onClick={closeNcm}
          />
          <div className="relative max-h-[85vh] w-[640px] overflow-y-auto rounded-xl bg-[#111118] shadow-2xl">
            {ncmPage === 'playlists' && (
              <NcmPlaylistsPage onSelectPlaylist={openDetail} onBack={closeNcm} />
            )}
            {ncmPage === 'detail' && selectedPlaylist && (
              <NcmPlaylistDetailPage
                playlist={selectedPlaylist}
                onBack={() => setNcmPage('playlists')}
              />
            )}
          </div>
        </div>
      )}
    </>
  );
});

NcmUserButton.displayName = 'NcmUserButton';
export default NcmUserButton;
