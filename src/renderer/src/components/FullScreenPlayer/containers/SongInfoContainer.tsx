import { useStore } from '@tanstack/react-store';
import { store } from '../../../store/store';
import DefaultSongCover from '../../../assets/images/webp/song_cover_default.webp';
import Img from '../../Img';

type Props = { lyricsMode: 'cover' | 'lyrics' | 'both'; };
export default function SongInfoContainer({ lyricsMode }: Props) {
  const artwork = useStore(store, state => state.currentSongData.artworkPath);
  if (lyricsMode === 'lyrics') return null;
  return <div className="simple-player-cover" style={{ width: lyricsMode === 'both' ? '50%' : '100%' }}>
    <Img src={artwork} fallbackSrc={DefaultSongCover} loading="eager" alt="歌曲封面" className="simple-player-cover-image" />
  </div>;
}
