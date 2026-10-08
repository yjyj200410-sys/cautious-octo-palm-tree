/**
 * useNcmPlaylistActions — NCM 歌单操作按钮共享 hook。
 * 首页歌单详情和「歌单」页的 NCM 歌单复用同一套收藏/重命名/删除逻辑。
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { NcmRepository } from './repository';
import { NeteaseSyncService } from './NeteaseSyncService';
import { useNcmUser, currentNcmUid } from '../contexts/NcmUserContext';
import type { NcmPlaylist } from './types';

export interface TitleButtonDef {
  label: string;
  iconName: string;
  clickHandler: () => void;
  isDisabled?: boolean;
  iconClassName?: string;
}

interface UseNcmPlaylistActionsOptions {
  /** 网易云原始歌单 ID（正数） */
  ncmPlaylistId: number;
  /** 歌单详情（可能为 null/loading） */
  detail: NcmPlaylist | null;
  /** 通知回调 */
  addNotification: (content: string, icon?: string) => void;
  /** 可选：重命名回调（用于打开重命名弹窗） */
  onRenameRequest?: () => void;
  /** 可选：删除回调（用于打开删除确认弹窗） */
  onDeleteRequest?: () => void;
}

export function useNcmPlaylistActions({ ncmPlaylistId, detail, addNotification, onRenameRequest, onDeleteRequest }: UseNcmPlaylistActionsOptions) {
  const { isLoggedIn, profile } = useNcmUser();
  const uid = profile?.userId || currentNcmUid || 0;
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [subscribing, setSubscribing] = useState(false);

  // 检查收藏状态
  useEffect(() => {
    if (!isLoggedIn || !uid) return;
    NcmRepository.getUserPlaylists(uid)
      .then((pls) => setIsSubscribed(pls.some((pl) => pl.playlistId === -(ncmPlaylistId))))
      .catch(() => {});
  }, [ncmPlaylistId, isLoggedIn, uid]);

  const isOwnPlaylist = detail ? (detail.creatorId > 0 && detail.creatorId === uid) : false;

  // 收藏/取消收藏
  const handleToggleSubscribe = useCallback(async () => {
    if (subscribing) return;
    setSubscribing(true);
    try {
      if (isSubscribed) {
        await NeteaseSyncService.unsubscribePlaylist(ncmPlaylistId, uid);
        setIsSubscribed(false);
        addNotification('已取消收藏', 'favorite_border');
      } else {
        await NeteaseSyncService.subscribePlaylist(ncmPlaylistId, uid);
        setIsSubscribed(true);
        addNotification('已收藏歌单', 'favorite');
      }
    } catch (err) {
      addNotification(String(err), 'error');
    } finally {
      setSubscribing(false);
    }
  }, [isSubscribed, subscribing, ncmPlaylistId, uid, addNotification]);

  // 重命名（需调用方提供 onRenameRequest 打开弹窗）
  const handleRename = useCallback(() => {
    if (onRenameRequest) { onRenameRequest(); return; }
    addNotification('重命名功能不可用', 'error');
  }, [addNotification, onRenameRequest]);

  // 删除（需调用方提供 onDeleteRequest 打开确认弹窗）
  const handleDelete = useCallback(() => {
    if (onDeleteRequest) { onDeleteRequest(); return; }
    addNotification('删除功能不可用', 'error');
  }, [addNotification, onDeleteRequest]);

  // 构建标题按钮
  const titleButtons = useMemo<TitleButtonDef[]>(() => {
    const btns: TitleButtonDef[] = [];
    if (isOwnPlaylist && isLoggedIn) {
      btns.push({ label: '重命名', iconName: 'edit', clickHandler: handleRename });
      btns.push({ label: '删除歌单', iconName: 'delete', clickHandler: handleDelete });
    } else {
      btns.push({
        label: subscribing ? '处理中...'
          : !isLoggedIn ? '登录后可收藏'
          : isSubscribed ? '取消收藏' : '收藏歌单',
        iconName: 'favorite',
        iconClassName: isSubscribed
          ? 'material-icons-round'
          : 'material-icons-round-outlined',
        clickHandler: !isLoggedIn
          ? () => addNotification('请先在标题栏点击网易云图标登录', 'info')
          : handleToggleSubscribe,
        isDisabled: !isLoggedIn || subscribing,
      });
    }
    return btns;
  }, [isOwnPlaylist, isLoggedIn, subscribing, isSubscribed, handleRename, handleDelete, handleToggleSubscribe, addNotification]);

  return { titleButtons, isOwnPlaylist, isSubscribed };
}
