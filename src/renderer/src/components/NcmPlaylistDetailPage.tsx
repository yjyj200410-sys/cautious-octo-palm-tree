import { useCallback, useContext, useEffect, useRef, useState } from 'react';
import { NcmRepository, proxyCoverUrl, type NcmPlaylist, type NcmSong } from '../ncm';
import { PlaybackBridge } from '../ncm/playback/PlaybackBridge';
import { NeteaseSyncService } from '../ncm/NeteaseSyncService';
import { useNcmUser, currentNcmUid } from '../contexts/NcmUserContext';
import { AppUpdateContext } from '../contexts/AppUpdateContext';

interface Props {
  playlist: NcmPlaylist;
  onBack: () => void;
}

export default function NcmPlaylistDetailPage({ playlist, onBack }: Props) {
  const { isLoggedIn, profile } = useNcmUser();
  const uid = profile?.userId || currentNcmUid || 0;
  const { changePromptMenuData } = useContext(AppUpdateContext);

  const [detail, setDetail] = useState<NcmPlaylist | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [playingId, setPlayingId] = useState<number | null>(null);
  const [playError, setPlayError] = useState('');
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [subscribing, setSubscribing] = useState(false);
  const [showMoreMenu, setShowMoreMenu] = useState(false);
  const [deleting] = useState(false);
  const moreBtnRef = useRef<HTMLButtonElement>(null);

  const display = detail || playlist;
  // 实际网易云歌单 ID（正数）
  const rawPlaylistId = -display.playlistId;
  // 系统歌单（喜欢的音乐等）不显示操作按钮
  const isSpecialLike = display.name === '我喜欢的音乐' || display.name.includes('喜欢的音乐');
  // 是否是自己创建的歌单
  const isOwnPlaylist = !isSpecialLike && display.creatorId > 0 && display.creatorId === uid;

  // 加载歌单详情 + 检查收藏状态
  useEffect(() => {
    setLoading(true);
    setError('');
    const detailId = -playlist.playlistId;
    Promise.all([
      NcmRepository.playlistDetail(detailId).catch(() => null),
      isLoggedIn && uid
        ? NcmRepository.getUserPlaylists(uid).then((pls) => {
            return pls.some((pl) => pl.playlistId === playlist.playlistId);
          }).catch(() => false)
        : Promise.resolve(false),
    ]).then(([det, subbed]) => {
      if (det) setDetail(det);
      setIsSubscribed(subbed);
      setLoading(false);
    }).catch((err) => {
      setError(err instanceof Error ? err.message : String(err));
      setLoading(false);
    });
  }, [playlist.playlistId, isLoggedIn, uid]);

  // 收藏/取消收藏
  const handleToggleSubscribe = useCallback(async () => {
    if (subscribing) return;
    setSubscribing(true);
    try {
      if (isSubscribed) {
        await NeteaseSyncService.unsubscribePlaylist(rawPlaylistId, uid);
        setIsSubscribed(false);
      } else {
        await NeteaseSyncService.subscribePlaylist(rawPlaylistId, uid);
        setIsSubscribed(true);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubscribing(false);
    }
  }, [isSubscribed, subscribing, rawPlaylistId, uid]);

  // 删除歌单
  const handleDelete = useCallback(() => {
    import('../components/SensitiveActionConfirmPrompt').then((mod) => {
      changePromptMenuData(true, <mod.default
        title="删除歌单"
        content={<p>确定要删除歌单「{display.name}」吗？</p>}
        confirmButton={{
          label: '删除',
          iconName: 'delete',
          clickHandler: () => {
            NeteaseSyncService.deletePlaylist(rawPlaylistId, uid)
              .then(() => onBack())
              .catch((err) => setError(err instanceof Error ? err.message : String(err)));
          },
        }}
      />);
    });
    setShowMoreMenu(false);
  }, [rawPlaylistId, uid, display.name, onBack, changePromptMenuData]);

  // 重命名歌单
  const handleRename = useCallback(() => {
    import('../ncm/NcmRenamePrompt').then((mod) => {
      changePromptMenuData(true, <mod.default name={display.name} playlistId={rawPlaylistId} uid={uid} onSuccess={() => { NcmRepository.playlistDetail(rawPlaylistId).then(setDetail).catch(() => {}); }} />);
    });
  }, [rawPlaylistId, uid, display.name, changePromptMenuData]);

  const handlePlayAll = async () => {
    if (detail && detail.tracks.length > 0) {
      setPlayError('');
      try {
        await PlaybackBridge.playSongs(detail.tracks, 0);
        setPlayingId(detail.tracks[0].songId);
      } catch (err) {
        setPlayError(err instanceof Error ? err.message : String(err));
      }
    }
  };

  const handlePlaySong = async (song: NcmSong, index: number) => {
    if (detail && detail.tracks.length > 0) {
      setPlayError('');
      try {
        await PlaybackBridge.playSongs(detail.tracks, index);
        setPlayingId(song.songId);
      } catch (err) {
        setPlayError(err instanceof Error ? err.message : String(err));
      }
    }
  };

  // 从歌单移除歌曲
  const handleRemoveSong = useCallback((song: NcmSong) => {
    import('../components/SensitiveActionConfirmPrompt').then((mod) => {
      changePromptMenuData(true, <mod.default
        title="移除歌曲"
        content={<p>确定从歌单中移除「{song.title}」吗？</p>}
        confirmButton={{
          label: '移除',
          iconName: 'remove',
          clickHandler: () => {
            NeteaseSyncService.removeSongsFromPlaylist(rawPlaylistId, [song.ncmId])
              .then(async () => {
                NcmRepository.invalidatePlaylist(rawPlaylistId);
                const det = await NcmRepository.playlistDetail(rawPlaylistId);
                if (det) setDetail(det);
              })
              .catch((err) => setError(err instanceof Error ? err.message : String(err)));
          },
        }}
      />);
    });
  }, [rawPlaylistId, changePromptMenuData]);

  const formatDuration = (ms: number) => {
    const s = Math.floor(ms / 1000);
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  };

  // 点击外部关闭更多菜单
  useEffect(() => {
    if (!showMoreMenu) return;
    const handler = (e: MouseEvent) => {
      if (moreBtnRef.current && !moreBtnRef.current.contains(e.target as Node)) {
        setShowMoreMenu(false);
      }
    };
    document.addEventListener('click', handler);
    return () => document.removeEventListener('click', handler);
  }, [showMoreMenu]);

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center p-8">
        <span className="text-sm text-gray-400">加载歌单中...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-8">
        <div className="rounded-md bg-red-900/30 px-4 py-3 text-sm text-red-300">{error}</div>
        <button onClick={onBack} className="mt-4 text-sm text-purple-400">← 返回</button>
      </div>
    );
  }

  return (
    <div className="p-6">
      {/* 头部 */}
      <div className="mb-6 flex gap-4">
        <button onClick={onBack} className="text-sm text-purple-400">←</button>
        <img
          src={proxyCoverUrl(display.coverUrl)}
          alt=""
          className="h-24 w-24 rounded-lg"
          style={{ objectFit: 'cover' }}
        />
        <div className="flex flex-col justify-center">
          <h2 className="text-lg font-semibold">{display.name}</h2>
          <div className="mt-1 text-xs text-gray-400">
            {display.trackCount} 首 · {display.creatorName || '未知'}
            {display.playCount > 0 ? ` · ${Math.floor(display.playCount / 10000)}万次播放` : ''}
          </div>
          {display.description && (
            <div className="mt-1 line-clamp-2 text-xs text-gray-500">{display.description}</div>
          )}

          {/* 操作按钮栏 */}
          <div className="mt-3 flex items-center gap-2">
            {detail && detail.tracks.length > 0 && (
              <button
                onClick={handlePlayAll}
                className="flex items-center gap-1 rounded-md bg-purple-600 px-3 py-1.5 text-xs text-white hover:bg-purple-500"
              >
                <span className="material-icons-round text-sm">play_arrow</span>
                播放全部
              </button>
            )}

            {/* 自己的歌单 → 编辑按钮（系统歌单除外） */}
            {isLoggedIn && isOwnPlaylist && !isSpecialLike && (
              <>
                <button
                  onClick={handleRename}
                  className="flex items-center gap-1 rounded-md border border-gray-500 px-3 py-1.5 text-xs text-gray-300 hover:bg-white/10"
                >
                  <span className="material-icons-round text-sm">edit</span>
                  编辑
                </button>
                <div className="relative">
                  <button
                    ref={moreBtnRef}
                    onClick={() => setShowMoreMenu(!showMoreMenu)}
                    className="flex items-center gap-1 rounded-md border border-gray-500 px-2 py-1.5 text-xs text-gray-300 hover:bg-white/10"
                  >
                    <span className="material-icons-round text-sm">more_horiz</span>
                  </button>
                  {showMoreMenu && (
                    <div className="absolute left-0 top-full z-50 mt-1 min-w-[120px] rounded-md border border-gray-600 bg-gray-800 py-1 shadow-lg">
                      <button
                        onClick={() => { setShowMoreMenu(false); handleDelete(); }}
                        disabled={deleting}
                        className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-red-400 hover:bg-white/10 disabled:opacity-50"
                      >
                        <span className="material-icons-round text-sm">delete</span>
                        {deleting ? '删除中...' : '删除歌单'}
                      </button>
                    </div>
                  )}
                </div>
              </>
            )}

            {/* 别人的歌单 → 收藏/取消收藏（系统歌单除外） */}
            {isLoggedIn && !isOwnPlaylist && !isSpecialLike && (
              <button
                onClick={handleToggleSubscribe}
                disabled={subscribing}
                className={`flex items-center gap-1 rounded-md border px-3 py-1.5 text-xs transition-colors disabled:opacity-50 ${
                  isSubscribed
                    ? 'border-red-500/50 text-red-400 hover:bg-red-500/10'
                    : 'border-pink-500/50 text-pink-400 hover:bg-pink-500/10'
                }`}
              >
                <span className="material-icons-round text-sm">
                  {isSubscribed ? 'favorite' : 'favorite_border'}
                </span>
                {subscribing ? '处理中...' : isSubscribed ? '取消收藏' : '收藏歌单'}
              </button>
            )}
          </div>

          {playError && (
            <div className="mt-2 rounded bg-red-900/30 px-3 py-1 text-xs text-red-400">{playError}</div>
          )}
        </div>
      </div>

      {/* 歌曲列表 */}
      {detail && detail.tracks.length === 0 ? (
        <div className="py-12 text-center text-sm text-gray-500">歌单为空</div>
      ) : (
        <div className="space-y-1">
          {(detail?.tracks || []).map((song, i) => (
            <div
              key={song.songId}
              className={`group flex cursor-pointer items-center gap-3 rounded-md px-3 py-2 transition-colors hover:bg-white/10 ${
                playingId === song.songId ? 'bg-purple-900/30' : ''
              }`}
            >
              <span
                onClick={() => handlePlaySong(song, i)}
                className="w-6 text-center text-xs tabular-nums text-gray-500 group-hover:hidden"
              >
                {i + 1}
              </span>
              <span
                onClick={() => handlePlaySong(song, i)}
                className="material-icons-round hidden w-6 text-center text-sm text-purple-400 group-hover:block"
              >
                play_arrow
              </span>
              <img
                src={proxyCoverUrl(song.coverUrl)}
                alt=""
                className="h-9 w-9 rounded"
                style={{ objectFit: 'cover' }}
                onClick={() => handlePlaySong(song, i)}
              />
              <div className="min-w-0 flex-1" onClick={() => handlePlaySong(song, i)}>
                <div className="truncate text-sm">{song.title}</div>
                <div className="truncate text-xs text-gray-400">
                  {song.artists.map((a) => a.name).join(' / ')}
                  {song.album.name ? ` · ${song.album.name}` : ''}
                </div>
              </div>
              <div className="text-xs tabular-nums text-gray-500" onClick={() => handlePlaySong(song, i)}>
                {formatDuration(song.duration)}
              </div>
              {/* 自己的歌单显示移除按钮（系统歌单除外） */}
              {isOwnPlaylist && !isSpecialLike && (
                <button
                  onClick={(e) => { e.stopPropagation(); handleRemoveSong(song); }}
                  className="ml-2 opacity-0 group-hover:opacity-100 transition-opacity"
                  title="从歌单移除"
                >
                  <span className="material-icons-round text-sm text-gray-400 hover:text-red-400">close</span>
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
