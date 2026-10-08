import { getAllSongs } from '@main/db/queries/songs';
import { getNcmSong } from '../ncm-server/ncm-registry';

import logger from '../logger';
import { convertToSongData } from '../utils/convert';

function ncmEntryToSongData(entry: ReturnType<typeof getNcmSong>): SongData {
  return {
    songId: entry!.songId,
    title: entry!.title,
    duration: entry!.duration,
    artists: entry!.artists ?? [],
    album: entry!.album,
    path: entry!.path,
    artworkPaths: {
      isDefaultArtwork: !entry!.artworkPath,
      artworkPath: entry!.artworkPath ?? '',
      optimizedArtworkPath: entry!.artworkPath ?? ''
    },
    isAFavorite: entry!.isAFavorite ?? false,
    isBlacklisted: entry!.isBlacklisted ?? false,
    isArtworkAvailable: !!entry!.artworkPath,
    addedDate: 0
  };
}

const getSongInfo = async (
  songIds: number[],
  sortType?: SongSortTypes,
  filterType?: SongFilterTypes,
  _limit = songIds.length,
  preserveIdOrder = false,
  noBlacklistedSongs = false
): Promise<SongData[]> => {
  if (songIds.length > 0) {
    const t0 = Date.now();
    // Split IDs: positive → DB query, negative → NCM registry
    const localIds = songIds.filter((id) => id > 0);
    const ncmIds = songIds.filter((id) => id < 0);

    // 1. Query local DB for positive IDs
    let localSongs: SongData[] = [];
    if (localIds.length > 0) {
      const songsDataResponse = await getAllSongs({
        sortType,
        filterType,
        songIds: localIds,
        preserveIdOrder
      });
      const dbMs = Date.now() - t0;
      const songsData = songsDataResponse.data;
      if (Array.isArray(songsData) && songsData.length > 0) {
        localSongs = songsData.map((x) => convertToSongData(x));
        logger.info(
          `[GET_SONG_INFO_TIME] localIds=${localIds.length} db=${dbMs}ms convert=${Date.now() - t0 - dbMs}ms`
        );
      }
    }

    // 2. Fetch NCM songs from in-memory registry
    const ncmSongs: SongData[] = [];
    const ncmFound: number[] = [];
    const ncmMissing: number[] = [];
    for (const nid of ncmIds) {
      const entry = getNcmSong(nid);
      if (entry) {
        ncmSongs.push(ncmEntryToSongData(entry));
        ncmFound.push(nid);
      } else {
        ncmMissing.push(nid);
      }
    }

    logger.debug(
      `[QUEUE_META_TRACE] getSongInfo ` +
      `requested=${songIds.length} ` +
      `localIds=${localIds.length} ` +
      `ncmIds=${ncmIds.length} ` +
      `localFound=${localSongs.length} ` +
      `ncmFound=${ncmFound.length} ` +
      `ncmMissing=${ncmMissing.length} ` +
      `missingFirst20=${JSON.stringify(ncmMissing.slice(0, 20))}`
    );

    // 3. Merge and sort
    let results = [...localSongs, ...ncmSongs];

    if (preserveIdOrder) {
      // Sort by original songIds order
      const idIndex = new Map(songIds.map((id, i) => [id, i]));
      results.sort((a, b) => (idIndex.get(a.songId) ?? 0) - (idIndex.get(b.songId) ?? 0));
    }

    if (noBlacklistedSongs)
      results = results.filter((result) => !result.isBlacklisted);

    if (results.length > 0) {
      logger.info(`[GET_SONG_INFO_RETURN] local=${localIds.length} ncm=${ncmIds.length} result=${results.length}`);
      return results;
    }

    logger.info(`[GET_SONG_INFO_RETURN] local=${localIds.length} ncm=${ncmIds.length} result=0`);
    logger.error(`Failed to get songs info from get-song-info function. songs data are empty.`);
    return [];
  }
  logger.info(`[GET_SONG_INFO_RETURN] local=0 ncm=0 result=0`);
  logger.warn(`App made a request to get-song-info function with an empty array of song ids.`);
  return [];
};

export default getSongInfo;