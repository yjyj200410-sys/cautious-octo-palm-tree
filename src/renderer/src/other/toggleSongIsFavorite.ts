import { FavoriteService, type SongIdentity } from '../utils/unifiedStorage';
import { NeteaseSyncService } from '../ncm/NeteaseSyncService';
import { currentNcmUid } from '../contexts/NcmUserContext';

const toggleSongIsFavorite = async (
  songId: number,
  isCurrentSongAFavorite: boolean,
  isFavorite?: boolean,
  onlyChangeCurrentSongData = false
) => {
  const newFavorite = isFavorite ?? !isCurrentSongAFavorite;
  const isNcm = songId < 0;

  const identity: SongIdentity = isNcm
    ? { source: 'netease', sourceId: String(-songId) }
    : { source: 'local', sourceId: String(songId) };

  // ===== OPTIMISTIC UPDATE =====
  // 立即更新 unified store，无论最终是否成功
  if (newFavorite) {
    FavoriteService.addFavorite(identity);
  } else {
    FavoriteService.removeFavorite(identity);
  }

  // ===== NCM API =====
  if (isNcm && !onlyChangeCurrentSongData) {
    try {
      await NeteaseSyncService.toggleFavoriteSong(-songId, currentNcmUid, newFavorite);
    } catch (err) {
      // ROLLBACK: 恢复 optimistic update
      if (newFavorite) {
        FavoriteService.removeFavorite(identity);
      } else {
        FavoriteService.addFavorite(identity);
      }
      console.error('NCM favorite sync failed:', err);
      return undefined;
    }
  }

  // ===== LOCAL DB =====
  // Local songs: also sync to DB via IPC
  if (!isNcm && isCurrentSongAFavorite !== newFavorite && !onlyChangeCurrentSongData) {
    const res = await window.api.playerControls.toggleLikeSongs([songId], newFavorite);
    if (res && res.likes.length + res.dislikes.length > 0) {
      return newFavorite;
    }
  }

  if (typeof isFavorite === 'boolean') {
    return isFavorite;
  }
  return undefined;
};

export default toggleSongIsFavorite;
