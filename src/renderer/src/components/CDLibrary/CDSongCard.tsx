import VipBadge from '@renderer/components/VipBadge';
import type { CanvasPoint } from '@renderer/utils/cdCanvas';
import { memo, useCallback } from 'react';

import { CDArtwork } from './CDArtwork';

/** Camera changes move the shared plane; unchanged discs keep their DOM and artwork. */
const CDSongCard = memo(function CDSongCard({
  song,
  index,
  center,
  register,
  current,
  playing,
  selected,
  selectionMode,
  compact,
  focusable,
  onFocus,
  onNavigate,
  onPlay,
  onSelect,
  onAction,
  onContextMenu
}: {
  song: SongData;
  index: number;
  center: CanvasPoint;
  register: (index: number, node: HTMLDivElement | null) => void;
  current: boolean;
  playing: boolean;
  selected: boolean;
  selectionMode: boolean;
  compact: boolean;
  focusable: boolean;
  onFocus: (index: number) => void;
  onNavigate: (event: React.KeyboardEvent, index: number) => void;
  onPlay: (song: SongData) => void;
  onSelect: (id: number) => void;
  onAction: (action: 'next' | 'queue' | 'favorite', song: SongData) => void;
  onContextMenu: (event: React.MouseEvent, song: SongData) => void;
}) {
  const setNode = useCallback(
    (node: HTMLDivElement | null) => register(index, node),
    [index, register]
  );
  return (
    <div
      ref={setNode}
      className={`cd-song ${current ? 'is-current' : ''} ${selected && selectionMode ? 'is-selected' : ''}`}
      data-cd-index={index}
      data-song-id={song.songId}
      style={{ left: center.x - 80, top: center.y - 80 }}
    >
      <button
        type="button"
        className="cd-song-main"
        tabIndex={focusable ? 0 : -1}
        aria-label={`${selectionMode ? '选择' : current && playing ? '暂停' : '播放'} ${song.title}，${song.artists?.map((artist) => artist.name).join('、') || '未知歌手'}`}
        aria-pressed={selectionMode ? selected : current}
        onFocus={() => onFocus(index)}
        onKeyDown={(event) => onNavigate(event, index)}
        onClick={() => (selectionMode ? onSelect(song.songId) : onPlay(song))}
        onContextMenu={(event) => onContextMenu(event, song)}
      >
        <CDArtwork
          cover={song.artworkPaths?.artworkPath}
          thumbnailSize={compact ? 128 : 512}
          compact={compact}
        />
        {!compact && (
          <>
            <span className="cd-song-indicator material-icons-round" aria-hidden="true">
              {selectionMode
                ? selected
                  ? 'check'
                  : 'add'
                : current && playing
                  ? 'pause'
                  : 'play_arrow'}
            </span>
            <span className="cd-song-copy">
              <strong>
                {song.title} <VipBadge isVip={song.isVip} />
              </strong>
              <small>{song.artists?.map((artist) => artist.name).join('、') || '未知歌手'}</small>
            </span>
          </>
        )}
      </button>
      {!compact && (
        <div className="cd-song-actions" data-canvas-ui>
          <button
            type="button"
            tabIndex={focusable ? 0 : -1}
            aria-label={`下一首播放 ${song.title}`}
            title="下一首播放"
            onClick={() => onAction('next', song)}
          >
            <span className="material-icons-round" aria-hidden="true">
              shortcut
            </span>
          </button>
          <button
            type="button"
            tabIndex={focusable ? 0 : -1}
            aria-label={`加入队列 ${song.title}`}
            title="加入队列"
            onClick={() => onAction('queue', song)}
          >
            <span className="material-icons-round" aria-hidden="true">
              queue_music
            </span>
          </button>
          <button
            type="button"
            tabIndex={focusable ? 0 : -1}
            aria-label={`${song.isAFavorite ? '取消喜欢' : '喜欢'} ${song.title}`}
            title={song.isAFavorite ? '取消喜欢' : '喜欢歌曲'}
            onClick={() => onAction('favorite', song)}
          >
            <span className="material-icons-round-outlined" aria-hidden="true">
              {song.isAFavorite ? 'favorite' : 'favorite_border'}
            </span>
          </button>
        </div>
      )}
    </div>
  );
});
export default CDSongCard;
