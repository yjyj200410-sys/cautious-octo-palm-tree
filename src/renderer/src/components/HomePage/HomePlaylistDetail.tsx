import DefaultPlaylistCover from '@renderer/assets/images/webp/playlist_cover_default.webp';
import { CDSleeve } from '@renderer/components/CDLibrary/CDArtwork';
import FloatingPanel from '@renderer/components/FloatingChrome/FloatingPanel';
import LibraryContent from '@renderer/components/LibraryPanel/LibraryContent';
import { useNcmUser } from '@renderer/contexts/NcmUserContext';
import { proxyCoverUrl } from '@renderer/ncm';
import { NcmRepository } from '@renderer/ncm/repository';
import { useEffect, useState } from 'react';

const displayCover = (cover: string) =>
  cover.startsWith('http://127.0.0.1:25884/cover?') ? cover : proxyCoverUrl(cover);

export type HomeDetail = {
  kind: 'ncm' | 'favorites' | 'daily';
  id?: number;
  title: string;
  cover: string;
  description?: string;
  creator?: string;
  trackCount?: number;
};

export default function HomePlaylistDetail({
  detail,
  onBack
}: {
  detail: HomeDetail;
  onBack: () => void;
}) {
  const { profile } = useNcmUser();
  const [metadata, setMetadata] = useState(detail);

  useEffect(() => {
    setMetadata(detail);
    let live = true;
    const load = async () => {
      let id = detail.id;
      if (detail.kind === 'favorites' && profile?.userId) {
        const playlists = await NcmRepository.getUserPlaylists(profile.userId);
        id = Math.abs(
          playlists.find((playlist) => playlist.name.includes('喜欢的音乐'))?.playlistId || 0
        );
      }
      if (!id || detail.kind === 'daily') return;
      const result = await NcmRepository.playlistDetail(Math.abs(id));
      if (live)
        setMetadata({
          ...detail,
          cover: result.coverUrl || detail.cover,
          description: result.description || detail.description,
          creator: result.creatorName || detail.creator,
          trackCount: result.trackCount || detail.trackCount
        });
    };
    load().catch(() => {});
    return () => {
      live = false;
    };
  }, [detail, profile?.userId]);

  return (
    <div className="home-detail-layout">
      <button type="button" className="home-back-button" onClick={onBack}>
        <span className="material-icons-round" aria-hidden="true">
          arrow_back
        </span>
        返回
      </button>
      <FloatingPanel panel="sidebar" title="歌单侧栏" icon="album" className="floating-sidebar">
        <aside className="home-detail-aside">
          <CDSleeve
            cover={displayCover(metadata.cover)}
            fallback={DefaultPlaylistCover}
            className="home-detail-sleeve"
          />
          <h1>{metadata.title}</h1>
          {(metadata.creator || metadata.trackCount !== undefined) && (
            <p className="home-detail-meta">
              {[
                metadata.creator,
                metadata.trackCount === undefined ? '' : `${metadata.trackCount} 首`
              ]
                .filter(Boolean)
                .join(' · ')}
            </p>
          )}
          {metadata.description && (
            <p className="home-detail-description">{metadata.description}</p>
          )}
        </aside>
      </FloatingPanel>
      <section className="library-content-surface home-detail-songs" aria-label="歌曲列表">
        <LibraryContent
          kind={detail.kind}
          id={detail.id}
          title={detail.title}
          cover={displayCover(detail.cover)}
        />
      </section>
    </div>
  );
}
