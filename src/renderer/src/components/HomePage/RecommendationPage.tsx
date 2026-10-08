import { ncmApi } from '@renderer/api/ncm-client';
import { useNcmUser } from '@renderer/contexts/NcmUserContext';
import { adaptPlaylistList, adaptSong } from '@renderer/ncm/adapters';
import { NcmHomeRepository } from '@renderer/ncm/home/NcmHomeRepository';
import type { NcmPlaylist, NcmSong } from '@renderer/ncm/types';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';

import { HomePlaylistCard, HomeSectionTitle, HomeSongGrid } from './HomeContentCards';

type Block = {
  blockCode?: string;
  uiElement?: { title?: string; subTitle?: { title?: string } };
  creatives?: Array<{
    uiElement?: {
      mainTitle?: { title?: string };
      subTitle?: { title?: string };
      image?: { imageUrl?: string };
    };
    resources?: Array<{
      resourceId?: number;
      resourceExtInfo?: {
        playlistData?: Record<string, unknown>;
        songData?: Record<string, unknown>;
      };
      playlistData?: Record<string, unknown>;
      songData?: Record<string, unknown>;
      uiElement?: { mainTitle?: { title?: string }; image?: { imageUrl?: string } };
    }>;
  }>;
  data?: { blocks?: Block[] };
};

function titleOf(block: Block): string {
  return block.uiElement?.subTitle?.title || block.uiElement?.title || '';
}

function playlistsOf(block: Block | undefined): NcmPlaylist[] {
  if (!block) return [];
  const found: NcmPlaylist[] = [];
  for (const creative of block.creatives || []) {
    for (const resource of creative.resources || []) {
      const raw = resource.resourceExtInfo?.playlistData || resource.playlistData || {};
      const id = Number(raw.id || resource.resourceId);
      const name = String(
        raw.name ||
          creative.uiElement?.mainTitle?.title ||
          resource.uiElement?.mainTitle?.title ||
          ''
      );
      if (!id || !name) continue;
      const playlist = adaptPlaylistList({
        result: [
          {
            ...raw,
            id,
            name,
            coverImgUrl:
              raw.coverImgUrl ||
              raw.picUrl ||
              resource.uiElement?.image?.imageUrl ||
              creative.uiElement?.image?.imageUrl,
            copywriter: raw.copywriter || creative.uiElement?.subTitle?.title || ''
          }
        ]
      })[0];
      if (playlist) found.push(playlist);
    }
  }
  return Array.from(new Map(found.map((playlist) => [playlist.playlistId, playlist])).values());
}

function songsOf(block: Block | undefined): NcmSong[] {
  if (!block) return [];
  const songs: NcmSong[] = [];
  for (const creative of block.creatives || []) {
    for (const resource of creative.resources || []) {
      const raw = resource.resourceExtInfo?.songData || resource.songData;
      if (raw?.id) songs.push(adaptSong(raw));
    }
  }
  return songs;
}

type RecommendationData = {
  dailySongs: NcmSong[];
  recommendSongs: NcmSong[];
  recommendTitle: string;
  playlists: NcmPlaylist[];
  radars: NcmPlaylist[];
  songBlock: { title: string; songs: NcmSong[] } | null;
};

// Renderer lifetime only: a new app process fetches a fresh recommendation set.
const recommendationCache = new Map<number, RecommendationData>();
const recommendationRequests = new Map<number, Promise<RecommendationData>>();
const recommendationScroll = new Map<number, number>();

function loadRecommendationData(userId: number): Promise<RecommendationData> {
  const cached = recommendationCache.get(userId);
  if (cached) return Promise.resolve(cached);
  const pending = recommendationRequests.get(userId);
  if (pending) return pending;

  const request = (async (): Promise<RecommendationData> => {
    const [dailySongs, recommended, homepage, fixedRadars] = await Promise.all([
      NcmHomeRepository.getDailySongs().catch(() => [] as NcmSong[]),
      NcmHomeRepository.getRecommendSongs()
        .then((songs) => ({ songs, title: NcmHomeRepository.getRecommendSongsTitle() }))
        .catch(() => ({ songs: [] as NcmSong[], title: '根据你喜爱的歌曲推荐' })),
      ncmApi.getHomepageBlocks(true).catch(() => null),
      NcmHomeRepository.getRadarPlaylists(8).catch(() => [] as NcmPlaylist[])
    ]);
    const blocks = homepage ? ((homepage as Block).data?.blocks || []) : [];
    const primaryPlaylists = playlistsOf(
      blocks.find((block) => block.blockCode === 'HOMEPAGE_BLOCK_PLAYLIST_RCMD')
    );
    const supplementalPlaylists = primaryPlaylists.length < 15
      ? await NcmHomeRepository.getRecommendPlaylists(15).catch(() => [] as NcmPlaylist[])
      : [];
    const playlists = Array.from(new Map(
      [...primaryPlaylists, ...supplementalPlaylists]
        .map((playlist) => [playlist.playlistId, playlist])
    ).values()).slice(0, 15);
    const homepageRadars = playlistsOf(
      blocks.find((block) => block.blockCode === 'HOMEPAGE_BLOCK_MGC_PLAYLIST')
    ).filter((playlist) => playlist.name.includes('雷达'));
    const radars = Array.from(new Map(
      [...homepageRadars, ...fixedRadars]
        .map((playlist) => [playlist.playlistId, playlist])
    ).values());
    const styleBlock = blocks.find((block) => block.blockCode === 'HOMEPAGE_BLOCK_STYLE_RCMD');
    const styleSongs = songsOf(styleBlock);
    const data: RecommendationData = {
      dailySongs,
      recommendSongs: recommended.songs,
      recommendTitle: recommended.title,
      playlists,
      radars,
      songBlock: styleSongs.length ? { title: titleOf(styleBlock || {}), songs: styleSongs } : null
    };
    recommendationCache.set(userId, data);
    return data;
  })();
  recommendationRequests.set(userId, request);
  void request.finally(() => recommendationRequests.delete(userId)).catch(() => {});
  return request;
}

export default function RecommendationPage({
  onOpenPlaylist,
  onOpenDaily
}: {
  onOpenPlaylist: (playlist: NcmPlaylist) => void;
  onOpenDaily: (cover: string) => void;
}) {
  const { isLoggedIn, activeUserId } = useNcmUser();
  const userId = activeUserId ?? 0;
  const [data, setData] = useState<RecommendationData | null>(
    () => recommendationCache.get(userId) || null
  );
  const scrollRef = useRef<HTMLDivElement>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [calendarDay, setCalendarDay] = useState(() => new Date().getDate());

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const updateDay = () => {
      clearTimeout(timer);
      const now = new Date();
      setCalendarDay(now.getDate());
      const nextMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
      timer = setTimeout(updateDay, nextMidnight.getTime() - now.getTime() + 1000);
    };
    updateDay();
    window.addEventListener('focus', updateDay);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('focus', updateDay);
    };
  }, []);

  useEffect(() => {
    if (!isLoggedIn) return;
    let live = true;
    setData(recommendationCache.get(userId) || null);
    const load = async () => {
      try {
        const next = await loadRecommendationData(userId);
        if (live) setData(next);
      } catch {
        if (live) setData(null);
      }
    };
    void load();
    return () => {
      live = false;
    };
  }, [isLoggedIn, userId]);

  useLayoutEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = recommendationScroll.get(userId) || 0;
  }, [userId, data]);

  const refreshSongs = async () => {
    setRefreshing(true);
    try {
      const songs = await NcmHomeRepository.refreshRecommendSongs();
      const current = recommendationCache.get(userId);
      if (!current) return;
      const next = { ...current, recommendSongs: songs, recommendTitle: NcmHomeRepository.getRecommendSongsTitle() };
      recommendationCache.set(userId, next);
      setData(next);
    } catch {
      // Keep the visible batch when a refresh fails.
    } finally {
      setRefreshing(false);
    }
  };

  const dailySongs = data?.dailySongs || [];
  const recommendSongs = data?.recommendSongs || [];
  const recommendTitle = data?.recommendTitle || '根据你喜爱的歌曲推荐';
  const playlists = data?.playlists || [];
  const radars = data?.radars || [];
  const songBlock = data?.songBlock;

  return (
    <div
      ref={scrollRef}
      className="home-feed-scroll"
      aria-label="推荐音乐"
      onScroll={(event) => recommendationScroll.set(userId, event.currentTarget.scrollTop)}
    >
      <div className="home-feed-inner">
        <h1 className="home-page-title">推荐音乐</h1>
        <div className="home-featured-grid">
          <button
            type="button"
            className="home-feature-card"
            onClick={() => onOpenDaily(dailySongs[0]?.coverUrl || '')}
            disabled={!dailySongs.length}
          >
            <span className="home-daily-calendar" aria-hidden="true">
              <span className="material-icons-round-outlined">calendar_today</span>
              <span className="home-daily-calendar-date">{calendarDay}</span>
            </span>
            <span>
              <strong>每日推荐</strong>
              <small>{dailySongs.length ? `${dailySongs.length} 首歌曲` : '加载中'}</small>
            </span>
          </button>
          {radars[0] && <HomePlaylistCard featured contextMenu playlist={radars[0]} onOpen={onOpenPlaylist} />}
        </div>

        {recommendSongs.length > 0 && (
          <section className="home-feed-section">
            <HomeSectionTitle
              title={recommendTitle}
              action={
                <button
                  type="button"
                  className="home-text-action"
                  onClick={refreshSongs}
                  disabled={refreshing}
                >
                  换一批
                </button>
              }
            />
            <HomeSongGrid songs={recommendSongs} />
          </section>
        )}

        {playlists.length > 0 && (
          <section className="home-feed-section">
            <HomeSectionTitle title="推荐歌单" />
            <div className="home-playlist-grid">
              {playlists.map((playlist) => (
                <HomePlaylistCard
                  key={playlist.playlistId}
                  playlist={playlist}
                  onOpen={onOpenPlaylist}
                  contextMenu
                />
              ))}
            </div>
          </section>
        )}

        {songBlock && (
          <section className="home-feed-section">
            <HomeSectionTitle title={songBlock.title} />
            <HomeSongGrid songs={songBlock.songs} />
          </section>
        )}

        {radars.length > 0 && (
          <section className="home-feed-section">
            <HomeSectionTitle title="雷达歌单" />
            <div className="home-playlist-grid">
              {radars.map((playlist) => (
                <HomePlaylistCard
                  key={playlist.playlistId}
                  playlist={playlist}
                  onOpen={onOpenPlaylist}
                  contextMenu
                />
              ))}
            </div>
          </section>
        )}
        {!data && <p className="home-feed-status">正在加载推荐内容…</p>}
        {data && !playlists.length && !recommendSongs.length && (
          <p className="home-feed-status">推荐内容暂时不可用</p>
        )}
      </div>
    </div>
  );
}
