import DefaultPlaylistCover from '@renderer/assets/images/webp/playlist_cover_default.webp';
import DefaultSongCover from '@renderer/assets/images/webp/song_cover_default.webp';
import Img from '@renderer/components/Img';
import { cdCoverUrl } from '@renderer/utils/cdCanvas';
import { useMemo } from 'react';

import './cdLibrary.css';

/** Printed disc, reflective rim and transparent hub. Pure CSS, no WebGL texture pipeline. */
export function CDArtwork({
  cover,
  fallback = DefaultSongCover,
  thumbnailSize,
  compact = false
}: {
  cover?: string;
  fallback?: string;
  thumbnailSize?: number;
  compact?: boolean;
}) {
  const source = useMemo(
    () => (thumbnailSize ? cdCoverUrl(cover, thumbnailSize) : cover),
    [cover, thumbnailSize]
  );
  return (
    <span className={`cd-artwork ${compact ? 'is-compact' : ''}`} aria-hidden="true">
      <img
        key={source}
        src={source || fallback}
        className="cd-artwork__print"
        alt=""
        loading="lazy"
        decoding="async"
        draggable={false}
        onError={({ currentTarget }) => {
          if (currentTarget.dataset.fallback) return;
          currentTarget.dataset.fallback = 'true';
          currentTarget.src = fallback;
        }}
      />
      {!compact && (
        <>
          <span className="cd-artwork__foil" />
          <span className="cd-artwork__hub" />
        </>
      )}
    </span>
  );
}

/** The exposed disc sits behind the printed insert and a clear, ribbed jewel-case spine. */
export function CDSleeve({
  cover,
  fallback = DefaultPlaylistCover,
  className = ''
}: {
  cover?: string;
  fallback?: string;
  className?: string;
}) {
  return (
    <span className={`cd-sleeve ${className}`} aria-hidden="true">
      <span className="cd-sleeve__disc">
        <CDArtwork cover={cover} fallback={fallback} />
      </span>
      <span className="cd-sleeve__case">
        <Img
          src={cover}
          fallbackSrc={fallback}
          className="cd-sleeve__insert"
          alt=""
          loading="lazy"
          enableImgFadeIns={false}
        />
        <span className="cd-sleeve__spine" />
        <span className="cd-sleeve__reflection" />
      </span>
    </span>
  );
}
