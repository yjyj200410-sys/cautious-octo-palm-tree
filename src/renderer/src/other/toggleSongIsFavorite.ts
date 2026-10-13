import { currentNcmUid } from '../contexts/NcmUserContext';
import { NeteaseSyncService } from '../ncm/NeteaseSyncService';
import { FavoriteService, type SongIdentity } from '../utils/unifiedStorage';

const toggleSongIsFavorite = async (
  songId: number,
  isCurrentSongAFavorite: boolean,
  isFavorite?: boolean,
  onlyChangeCurrentSongData = false
) => {
  const target = isFavorite ?? !isCurrentSongAFavorite;
  const isNcm = songId < 0;
  const owner = currentNcmUid;
  const identity: SongIdentity = isNcm
    ? { source: 'netease', sourceId: String(-songId) }
    : { source: 'local', sourceId: String(songId) };
  try {
    // Publish the state only after its authoritative store confirms the write.
    // This also prevents a list refresh racing an optimistic cloud mutation.
    if (!onlyChangeCurrentSongData) {
      if (isNcm) {
        await NeteaseSyncService.toggleFavoriteSong(-songId, owner, target);
        if (owner !== currentNcmUid) return undefined;
      } else if (isCurrentSongAFavorite !== target) {
        const result = await window.api.playerControls.toggleLikeSongs([songId], target);
        if (!(target ? result?.likes : result?.dislikes)?.includes(songId)) {
          throw new Error('本地收藏未保存，请重试');
        }
      }
    }
    if (target) FavoriteService.addFavorite(identity);
    else FavoriteService.removeFavorite(identity);
    return target;
  } catch (error) {
    console.error('Favorite save failed:', error);
    window.dispatchEvent(
      new CustomEvent('volo-error', { detail: '喜欢操作失败，请检查登录、网络或本地曲库' })
    );
    return undefined;
  }
};
export default toggleSongIsFavorite;
