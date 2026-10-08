import MainContainer from '@renderer/components/MainContainer';

import PlaylistContent from './PlaylistContent';

type Props = {
  playlist: Playlist;
  songs: SongData[];
  buttons?: React.ComponentProps<typeof PlaylistContent>['buttons'];
  dropdowns?: React.ComponentProps<typeof PlaylistContent>['dropdowns'];
  onPlayClick: (songId: number) => void;
  additionalContextMenuItems?: (item: SongData) => ContextMenuItem[];
  scrollTopOffset?: number;
};

/**
 * 旧 URL 容器:/playlists/favorites、/ncm/daily、/playlists/:id、/ncm/playlist/:id
 * 等路由仍以此渲染整页;实际内容已抽到 PlaylistContent,供 LibraryPanel 复用。
 */
export default function PlaylistPage(props: Props) {
  return (
    <MainContainer
      className="main-container playlist-info-page-container h-full! px-8 pr-0! pb-0!"
      focusable
    >
      <PlaylistContent {...props} />
    </MainContainer>
  );
}
