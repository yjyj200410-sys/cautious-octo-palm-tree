import { ncmApi } from '@renderer/api/ncm-client';
import { useNcmUser } from '@renderer/contexts/NcmUserContext';
import { adaptPlaylistList } from '@renderer/ncm/adapters';
import type { NcmPlaylist } from '@renderer/ncm/types';
import { useEffect, useMemo, useState } from 'react';

import { HomePlaylistCard, HomeSectionTitle } from './HomeContentCards';

type Category = { name: string; category: number; hot?: boolean };

export default function DiscoveryPage({
  onOpenPlaylist
}: {
  onOpenPlaylist: (playlist: NcmPlaylist) => void;
}) {
  const { isLoggedIn, activeUserId } = useNcmUser();
  const [categoryNames, setCategoryNames] = useState<Record<string, string>>({});
  const [categories, setCategories] = useState<Category[]>([]);
  const [group, setGroup] = useState<number | null>(null);
  const [selectedCategory, setSelectedCategory] = useState('全部');
  const [rankings, setRankings] = useState<NcmPlaylist[]>([]);
  const [showAllRankings, setShowAllRankings] = useState(false);
  const [playlists, setPlaylists] = useState<NcmPlaylist[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);

  useEffect(() => {
    if (!isLoggedIn) return;
    let live = true;
    Promise.allSettled([ncmApi.getPlaylistCategories(), ncmApi.getToplistDetail()])
      .then(([categoryResult, rankingResult]) => {
        if (!live) return;
        if (categoryResult.status === 'fulfilled') {
          const raw = categoryResult.value as {
            categories?: Record<string, string>;
            sub?: Category[];
          };
          setCategoryNames(raw.categories || {});
          setCategories(raw.sub || []);
        }
        if (rankingResult.status === 'fulfilled') {
          const raw = rankingResult.value as { list?: Record<string, unknown>[] };
          setRankings(adaptPlaylistList({ result: raw.list || [] }));
        }
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [isLoggedIn, activeUserId]);

  useEffect(() => {
    if (!isLoggedIn) return;
    let live = true;
    setLoading(true);
    setPlaylists([]);
    ncmApi
      .topPlaylist(selectedCategory, 'hot', 36, 0)
      .then((raw) => {
        if (!live) return;
        const response = raw as { playlists?: Record<string, unknown>[]; more?: boolean };
        const items = adaptPlaylistList({ result: response.playlists || [] });
        setPlaylists(items);
        setHasMore(response.more ?? items.length === 36);
      })
      .catch(() => {
        if (live) setHasMore(false);
      })
      .finally(() => {
        if (live) setLoading(false);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [isLoggedIn, activeUserId, selectedCategory]);

  const groups = useMemo(
    () => Object.entries(categoryNames).sort(([a], [b]) => Number(a) - Number(b)),
    [categoryNames]
  );
  const visibleCategories =
    group === null
      ? categories.filter((category) => category.hot)
      : categories.filter((category) => category.category === group);

  const loadMore = async () => {
    if (loadingMore || !hasMore) return;
    setLoadingMore(true);
    try {
      const raw = await ncmApi.topPlaylist(selectedCategory, 'hot', 36, playlists.length);
      const response = raw as { playlists?: Record<string, unknown>[]; more?: boolean };
      const next = adaptPlaylistList({ result: response.playlists || [] });
      setPlaylists((current) =>
        Array.from(
          new Map([...current, ...next].map((playlist) => [playlist.playlistId, playlist])).values()
        )
      );
      setHasMore(response.more ?? next.length === 36);
    } catch {
      setHasMore(false);
    } finally {
      setLoadingMore(false);
    }
  };

  return (
    <div className="home-feed-scroll" aria-label="发现音乐">
      <div className="home-feed-inner">
        <h1 className="home-page-title">发现音乐</h1>
        <section className="home-feed-section">
          <HomeSectionTitle
            title="排行榜"
            action={
              rankings.length > 12 && (
                <button
                  type="button"
                  className="home-text-action"
                  onClick={() => setShowAllRankings((value) => !value)}
                >
                  {showAllRankings ? '收起' : '查看全部'}
                </button>
              )
            }
          />
          <div className="home-playlist-grid">
            {rankings.slice(0, showAllRankings ? undefined : 12).map((playlist) => (
              <HomePlaylistCard
                key={playlist.playlistId}
                playlist={playlist}
                onOpen={onOpenPlaylist}
              />
            ))}
          </div>
        </section>
        <section className="home-feed-section">
          <HomeSectionTitle title="歌单广场" />
          <div className="home-category-groups">
            <button
              type="button"
              className={group === null ? 'is-active' : ''}
              onClick={() => setGroup(null)}
            >
              热门
            </button>
            {groups.map(([id, name]) => (
              <button
                key={id}
                type="button"
                className={group === Number(id) ? 'is-active' : ''}
                onClick={() => setGroup(Number(id))}
              >
                {name}
              </button>
            ))}
          </div>
          <div className="home-category-tags">
            <button
              type="button"
              className={selectedCategory === '全部' ? 'is-active' : ''}
              onClick={() => setSelectedCategory('全部')}
            >
              全部
            </button>
            {visibleCategories.map((category) => (
              <button
                key={category.name}
                type="button"
                className={selectedCategory === category.name ? 'is-active' : ''}
                onClick={() => setSelectedCategory(category.name)}
              >
                {category.name}
              </button>
            ))}
          </div>
          <div className="home-playlist-grid">
            {playlists.map((playlist) => (
              <HomePlaylistCard
                key={playlist.playlistId}
                playlist={playlist}
                onOpen={onOpenPlaylist}
              />
            ))}
          </div>
          {loading && <p className="home-feed-status">正在加载歌单…</p>}
          {!loading && playlists.length === 0 && <p className="home-feed-status">该分类暂无歌单</p>}
          {hasMore && playlists.length > 0 && (
            <button
              type="button"
              className="home-load-more"
              disabled={loadingMore}
              onClick={loadMore}
            >
              {loadingMore ? '正在加载…' : '加载更多'}
            </button>
          )}
        </section>
      </div>
    </div>
  );
}
