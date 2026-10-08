import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';

import { app, BrowserWindow, desktopCapturer, ipcMain, powerMonitor, shell } from 'electron';

import type { SavedNcmAccount } from '../common/ncmAccount';
import type { NcmSongQuality } from '../common/ncmQuality';
import { initializeStemSeparationIPC } from './audio/stemSeparation';
import addArtworkToAPlaylist from './core/addArtworkToAPlaylist';
import addSongsFromFolderStructures from './core/addMusicFolder';
import addNewPlaylist from './core/addNewPlaylist';
import addSongsToPlaylist from './core/addSongsToPlaylist';
import {
  selectCustomBackground,
  listBackgrounds,
  deleteBackground,
  saveRecordedBackground
} from './core/backgroundManager';
import blacklistFolders from './core/blacklistFolders';
import blacklistSongs from './core/blacklistSongs';
import changeAppTheme from './core/changeAppTheme';
import checkForNewSongs from './core/checkForNewSongs';
import checkForStartUpSongs from './core/checkForStartUpSongs';
import clearSearchHistoryResults from './core/clearSeachHistoryResults';
import clearSongHistory from './core/clearSongHistory';
import deleteSongsFromSystem from './core/deleteSongsFromSystem';
import { downloadNcmSongs } from './core/downloadNcmSongs';
import exportAppData from './core/exportAppData';
import exportPlaylist from './core/exportPlaylist';
import fetchAlbumData from './core/fetchAlbumData';
import fetchArtistData from './core/fetchArtistData';
import fetchSongInfoFromLastFM from './core/fetchSongInfoFromLastFM';
import { getFontFileLocation } from './core/fontManager';
import { getAllFavoriteSongs } from './core/getAllFavoriteSongs';
import { getAllHistorySongs } from './core/getAllHistorySongs';
import getAllSongs, { getAllSongIds } from './core/getAllSongs';
import getArtistInfoFromNet from './core/getArtistInfoFromNet';
import getArtworksForMultipleArtworksCover from './core/getArtworksForMultipleArtworksCover';
import { getArtistDuplicates } from './core/getDuplicates';
import { getFolderStructures } from './core/getFolderStructures';
import getGenresInfo from './core/getGenresInfo';
import { getListeningData } from './core/getListeningData';
import getMusicFolderData from './core/getMusicFolderData';
import getSongInfo from './core/getSongInfo';
import getSongLyrics from './core/getSongLyrics';
import getStorageUsage from './core/getStorageUsage';
import { getWallpaperEngineWallpapers } from './core/getWallpaperEngineWallpapers';
import importAppData from './core/importAppData';
import importPlaylist from './core/importPlaylist';
import removeMusicFolder from './core/removeMusicFolder';
import removePlaylists from './core/removePlaylists';
import removeSongFromPlaylist from './core/removeSongFromPlaylist';
import renameAPlaylist from './core/renameAPlaylist';
import { resolveArtistDuplicates } from './core/resolveDuplicates';
import resolveFeaturingArtists from './core/resolveFeaturingArtists';
import { resolveSeparateArtists } from './core/resolveSeparateArtists';
import restoreBlacklistedFolders from './core/restoreBlacklistedFolder';
import restoreBlacklistedSongs from './core/restoreBlacklistedSongs';
import saveArtworkToSystem from './core/saveArtworkToSystem';
import sendAudioData from './core/sendAudioData';
import sendAudioDataFromPath from './core/sendAudioDataFromPath';
import sendPlaylistData from './core/sendPlaylistData';
import sendSongID3Tags from './core/sendSongMetadata';
import toggleBlacklistFolders from './core/toggleBlacklistFolders';
import toggleLikeArtists from './core/toggleLikeArtists';
import toggleLikeSongs from './core/toggleLikeSongs';
import updateSongListeningData from './core/updateSongListeningData';
import {
  launchWEWindow,
  closeWEWindow,
  getWindowSources,
  installDisplayMediaHandler
} from './core/weRecorder';
import { prepareSceneForRecording } from './core/weScenePrepare';
import {
  hideCursor,
  showCursor,
  getWindowRectByTitle,
  setWindowRectByTitle,
  nudgeWindowByTitle
} from './core/win32Window';
import {
  addIgnoredArtist,
  addIgnoredDuplicate,
  addIgnoredFeaturingArtist,
  getIgnoredArtists,
  getIgnoredDuplicateMetadata,
  getIgnoredFeaturingArtists,
  removeIgnoredArtist,
  removeIgnoredFeaturingArtist
} from './db/queries/ignoredItems';
import { getDatabaseMetrics } from './db/queries/other';
import { getUserSettings, saveUserSettings } from './db/queries/settings';
import {
  getUserKeyboardShortcuts,
  saveUserKeyboardShortcuts,
  getUserEqualizerPreset,
  saveUserEqualizerPreset
} from './db/queries/userPreferences';
import { getBlacklistData } from './filesystem';
import { removeDefaultAppProtocolFromFilePath } from './fs/resolveFilePaths';
import logger, { logFilePath } from './logger';
import {
  getNcmAccountCookie,
  listNcmAccounts,
  removeNcmAccount,
  saveNcmAccount,
  setActiveNcmAccount
} from './ncm-server/accountVault';
import { registerNcmSong, getNcmSong } from './ncm-server/ncm-registry';
import { callNcmApi } from './ncm-server/ncm-server';
import { registerWallpaper, getWallpaperUrl } from './wallpaperServer';
// Services injected by main.ts — avoids circular import main.ts ↔ ipc.ts
interface MainSvc {
  allowScreenSleeping: () => void;
  changePlayerType: (type: PlayerTypes) => Promise<void>;
  getFolderLocation: () => Promise<string>;
  getImagefileLocation: () => Promise<string>;
  getRendererLogs: (
    mes: string | Error,
    data?: Record<string, unknown>,
    messageType?: LogMessageTypes,
    forceWindowRestart?: boolean,
    forceMainRestart?: boolean
  ) => Promise<undefined>;
  IS_DEVELOPMENT: boolean;
  resetApp: (isRestartApp?: boolean) => Promise<void>;
  restartApp: (reason: string, noQuitEvents?: boolean) => void;
  restartRenderer: () => void;
  revealSongInFileExplorer: (songId: number) => Promise<void>;
  sendMessageToRenderer: (props: MessageToRendererProps) => void;
  stopScreenSleeping: () => void;
  toggleAudioPlayingState: (isPlaying: boolean) => void;
  toggleAutoLaunch: (autoLaunchState: boolean) => Promise<void>;
  toggleMiniPlayerAlwaysOnTop: (isMiniPlayerAlwaysOnTop: boolean) => void;
  toggleOnBatteryPower: () => void;
  toggleMainWindowMaximize: () => Promise<void>;
  isMainWindowMaximized: () => boolean;
}
import { setDiscordRpcActivity } from './other/discordRPC';
import { generatePalettes } from './other/generatePalette';
import getAlbumInfoFromLastFM from './other/lastFm/getAlbumInfoFromLastFM';
import getSimilarTracks from './other/lastFm/getSimilarTracks';
import scrobbleSong from './other/lastFm/scrobbleSong';
import sendNowPlayingSongDataToLastFM from './other/lastFm/sendNowPlayingSongDataToLastFM';
import reParseSong from './parseSong/reParseSong';
import saveLyricsToSong from './saveLyricsToSong';
import search from './search';
import updateSongId3Tags, { isMetadataUpdatesPending } from './updateSong/updateSongId3Tags';
import convertLyricsToPinyin from './utils/convertToPinyin';
import convertLyricsToRomaja from './utils/convertToRomaja';
import {
  fetchSongMetadataFromInternet,
  searchSongMetadataResultsInInternet
} from './utils/fetchSongMetadataFromInternet';
import { getQueueInfo } from './utils/getQueueInfo';
import getTranslatedLyrics from './utils/getTranslatedLyrics';
import resetLyrics from './utils/resetLyrics';
import romanizeLyrics from './utils/romanizeLyrics';
import { compare } from './utils/safeStorage';

export function initializeIPC(mainWindow: BrowserWindow, abortSignal: AbortSignal, svc: MainSvc) {
  if (mainWindow) {
    initializeStemSeparationIPC(mainWindow.webContents);
    ipcMain.on('app/close', () => app.quit());

    ipcMain.on('app/minimize', () => mainWindow.minimize());

    ipcMain.on('app/toggleMaximize', () => void svc.toggleMainWindowMaximize());

    ipcMain.handle('app/isMaximized', () => svc.isMainWindowMaximized());

    ipcMain.on('app/hide', () => mainWindow.hide());

    ipcMain.on('app/show', () => mainWindow.show());

    ipcMain.on('app/changeAppTheme', (_, theme?: AppTheme) => changeAppTheme(theme));

    ipcMain.on('app/player/songPlaybackStateChange', (_: unknown, isPlaying: boolean) =>
      svc.toggleAudioPlayingState(isPlaying)
    );

    ipcMain.on('app/setDiscordRpcActivity', (_: unknown, options: unknown) =>
      setDiscordRpcActivity(options)
    );

    ipcMain.on('app/svc.stopScreenSleeping', svc.stopScreenSleeping);
    ipcMain.on('app/svc.allowScreenSleeping', svc.allowScreenSleeping);

    ipcMain.handle('app/checkForStartUpSongs', () => checkForStartUpSongs());

    mainWindow.on('focus', () => {
      mainWindow.webContents.send('app/focused');
      mainWindow.flashFrame(false);
    });
    mainWindow.on('blur', () => mainWindow.webContents.send('app/blurred'));

    powerMonitor.addListener('on-ac', svc.toggleOnBatteryPower);
    powerMonitor.addListener('on-battery', svc.toggleOnBatteryPower);

    // ipcMain.on('app/getSongPosition', (_, position: number) =>
    //   saveUserData('currentSong.stoppedPosition', position)
    // );

    ipcMain.handle('app/addSongsFromFolderStructures', (_, structures: FolderStructure[]) =>
      addSongsFromFolderStructures(structures)
    );

    ipcMain.handle('app/getSong', (_, id: number) => {
      if (id < 0) {
        const cached = getNcmSong(id);
        if (cached) return cached;
      }
      return sendAudioData(id);
    });

    ipcMain.handle('app/getSongFromUnknownSource', (_, songPath: string) =>
      sendAudioDataFromPath(songPath)
    );

    ipcMain.handle('app/toggleLikeSongs', (_, songIds: number[], likeSong?: boolean) =>
      toggleLikeSongs(songIds, likeSong)
    );

    ipcMain.handle('app/toggleLikeArtists', (_, artistIds: number[], likeArtist?: boolean) =>
      toggleLikeArtists(artistIds, likeArtist)
    );

    ipcMain.handle(
      'app/getAllSongs',
      (
        _,
        sortType?: SongSortTypes,
        filterType?: SongFilterTypes,
        paginatingData?: PaginatingData
      ) => getAllSongs(sortType, filterType, paginatingData)
    );

    ipcMain.handle(
      'app/getAllSongIds',
      (
        _,
        sortType?: SongSortTypes,
        filterType?: SongFilterTypes,
        paginatingData?: PaginatingData
      ) => getAllSongIds(sortType, filterType, paginatingData)
    );

    ipcMain.handle(
      'app/getAllHistorySongs',
      (_, sortType?: SongSortTypes, paginatingData?: PaginatingData) =>
        getAllHistorySongs(sortType, paginatingData)
    );

    ipcMain.handle(
      'app/getAllFavoriteSongs',
      (_, sortType?: SongSortTypes, paginatingData?: PaginatingData) =>
        getAllFavoriteSongs(sortType, paginatingData)
    );

    // ipcMain.handle('app/saveUserData', (_, dataType: UserDataTypes, data: string) =>
    //   saveUserData(dataType, data)
    // );
    ipcMain.handle('app/saveUserSettings', (_, settings: Partial<UserSettings>) =>
      saveUserSettings(settings)
    );

    // User Keyboard Shortcuts Handlers
    ipcMain.handle('app/getUserKeyboardShortcuts', async () => {
      const shortcuts = await getUserKeyboardShortcuts();
      return shortcuts.shortcuts;
    });

    ipcMain.handle('app/saveUserKeyboardShortcuts', (_, shortcuts: Record<string, string>) =>
      saveUserKeyboardShortcuts(shortcuts)
    );

    // User Equalizer Preset Handlers
    ipcMain.handle('app/getUserEqualizerPreset', async () => {
      const preset = await getUserEqualizerPreset();
      return preset;
    });

    ipcMain.handle(
      'app/saveUserEqualizerPreset',
      (
        _,
        presetData: {
          presetName?: string;
          frequencyBands?: number[];
          isEnabled?: boolean;
        }
      ) => saveUserEqualizerPreset(presetData)
    );

    // Ignored Items Handlers
    ipcMain.handle('app/getIgnoredArtists', async () => {
      const ignored = await getIgnoredArtists();
      return ignored.map((item) => item.artistId);
    });

    ipcMain.handle('app/addIgnoredArtist', (_, artistId: number) => addIgnoredArtist(artistId));

    ipcMain.handle('app/removeIgnoredArtist', (_, artistId: number) =>
      removeIgnoredArtist(artistId)
    );

    ipcMain.handle('app/getIgnoredFeaturingArtists', async () => {
      const ignored = await getIgnoredFeaturingArtists();
      return ignored.map((item) => item.artistId);
    });

    ipcMain.handle('app/addIgnoredFeaturingArtist', (_, artistId: number) =>
      addIgnoredFeaturingArtist(artistId)
    );

    ipcMain.handle('app/removeIgnoredFeaturingArtist', (_, artistId: number) =>
      removeIgnoredFeaturingArtist(artistId)
    );

    ipcMain.handle('app/getIgnoredDuplicateMetadata', () => getIgnoredDuplicateMetadata());

    ipcMain.handle('app/addIgnoredDuplicate', (_, duplicateGroupId: string, songId: number) =>
      addIgnoredDuplicate(duplicateGroupId, songId)
    );

    ipcMain.handle('app/getStorageUsage', () => getStorageUsage());
    ipcMain.handle('app/getDatabaseMetrics', () => getDatabaseMetrics());

    ipcMain.handle('app/getUserData', async () => await getUserSettings());
    ipcMain.handle('app/getUserSettings', async () => await getUserSettings());

    ipcMain.handle(
      'app/search',
      (
        _,
        searchFilters: SearchFilters,
        value: string,
        updateSearchHistory?: boolean,
        isSimilaritySearchEnabled?: boolean
      ) => search(searchFilters, value, updateSearchHistory, isSimilaritySearchEnabled)
    );

    ipcMain.handle(
      'app/getSongLyrics',
      (
        _,
        trackInfo: LyricsRequestTrackInfo,
        lyricsType?: LyricsTypes,
        lyricsRequestType?: LyricsRequestTypes,
        saveLyricsAutomatically?: AutomaticallySaveLyricsTypes
      ) => getSongLyrics(trackInfo, lyricsType, lyricsRequestType, saveLyricsAutomatically)
    );

    ipcMain.handle('app/getTranslatedLyrics', (_, languageCode: LanguageCodes) =>
      getTranslatedLyrics(languageCode as string)
    );

    ipcMain.handle('app/romanizeLyrics', async () => await romanizeLyrics());

    ipcMain.handle('app/convertLyricsToPinyin', () => convertLyricsToPinyin());

    ipcMain.handle('app/convertLyricsToRomaja', () => convertLyricsToRomaja());

    ipcMain.handle('app/resetLyrics', () => resetLyrics());

    ipcMain.handle('app/saveLyricsToSong', (_, songPath: string, lyrics: SongLyrics) =>
      saveLyricsToSong(songPath, lyrics)
    );

    ipcMain.handle(
      'app/getSongInfo',
      (
        _,
        songIds: number[],
        sortType?: SongSortTypes,
        filterType?: SongFilterTypes,
        limit?: number,
        preserveIdOrder = false
      ) => getSongInfo(songIds, sortType, filterType, limit, preserveIdOrder)
    );

    ipcMain.handle('app/getSimilarTracksForASong', (_, songId: number) => getSimilarTracks(songId));

    ipcMain.handle('app/getAlbumInfoFromLastFM', (_, albumId: number) =>
      getAlbumInfoFromLastFM(albumId)
    );

    ipcMain.handle('app/getSongListeningData', (_, songIds: number[]) => getListeningData(songIds));

    ipcMain.handle(
      'app/updateSongListeningData',
      (_: unknown, songId: number, dataType: ListeningDataEvents, value: number) =>
        updateSongListeningData(songId, dataType, value)
    );

    ipcMain.handle('app/generatePalettes', generatePalettes);

    ipcMain.handle('app/scrobbleSong', (_, songId: number, startTimeInSecs: number) =>
      scrobbleSong(songId, startTimeInSecs)
    );

    ipcMain.handle('app/sendNowPlayingSongDataToLastFM', (_, songId: number) =>
      sendNowPlayingSongDataToLastFM(songId)
    );

    ipcMain.handle('app/getArtistArtworks', (_, artistId: number) =>
      getArtistInfoFromNet(artistId)
    );

    ipcMain.handle('app/fetchSongInfoFromNet', (_, songTitle: string, songArtists: string[]) =>
      fetchSongInfoFromLastFM(songTitle, songArtists)
    );

    ipcMain.handle(
      'app/searchSongMetadataResultsInInternet',
      (_, songTitle: string, songArtists: string[]) =>
        searchSongMetadataResultsInInternet(songTitle, songArtists)
    );

    ipcMain.handle(
      'app/fetchSongMetadataFromInternet',
      (_, source: SongMetadataSource, sourceId: string) =>
        fetchSongMetadataFromInternet(source, sourceId)
    );

    ipcMain.handle(
      'app/getArtistData',
      (
        _,
        artistIdsOrNames?: string[],
        sortType?: ArtistSortTypes,
        filterType?: ArtistFilterTypes,
        start?: number,
        end?: number,
        limit?: number
      ) => fetchArtistData(artistIdsOrNames, sortType, filterType, start, end, limit)
    );

    ipcMain.handle(
      'app/getGenresData',
      (_, genreNamesOrIds?: string[], sortType?: GenreSortTypes, start?: number, end?: number) =>
        getGenresInfo(genreNamesOrIds, sortType, start, end)
    );

    ipcMain.handle(
      'app/getAlbumData',
      (_, albumTitlesOrIds?: string[], sortType?: AlbumSortTypes, start?: number, end?: number) =>
        fetchAlbumData(albumTitlesOrIds, sortType, start, end)
    );

    ipcMain.handle(
      'app/getPlaylistData',
      (_, playlistIds?: string[], sortType?: AlbumSortTypes, start?: number, end?: number) =>
        sendPlaylistData(playlistIds, sortType, start, end)
    );

    ipcMain.handle('app/getArtistDuplicates', (_, artistName: string) =>
      getArtistDuplicates(artistName)
    );

    ipcMain.handle(
      'app/resolveArtistDuplicates',
      (_, selectedArtistId: number, duplicateIds: number[]) =>
        resolveArtistDuplicates(selectedArtistId, duplicateIds)
    );

    ipcMain.handle(
      'app/resolveSeparateArtists',
      (_, separateArtistId: number, separateArtistNames: string[]) =>
        resolveSeparateArtists(separateArtistId, separateArtistNames)
    );

    ipcMain.handle(
      'app/resolveFeaturingArtists',
      (_, songId: number, featArtistNames: string[], removeFeatInfoInTitle?: boolean) =>
        resolveFeaturingArtists(songId, featArtistNames, removeFeatInfoInTitle)
    );

    ipcMain.handle('app/getQueueInfo', (_, queueType: QueueTypes, id: string) =>
      getQueueInfo(queueType, id)
    );

    ipcMain.handle(
      'app/addNewPlaylist',
      (_, playlistName: string, songIds?: string[], artworkPath?: string) =>
        addNewPlaylist(playlistName, songIds, artworkPath)
    );

    ipcMain.handle('app/removePlaylists', (_, playlistIds: number[]) =>
      removePlaylists(playlistIds)
    );

    ipcMain.handle('app/addSongsToPlaylist', (_, playlistId: number, songIds: number[]) =>
      addSongsToPlaylist(playlistId, songIds)
    );

    ipcMain.handle('app/removeSongFromPlaylist', (_, playlistId: number, songId: number) =>
      removeSongFromPlaylist(playlistId, songId)
    );

    ipcMain.handle('app/addArtworkToAPlaylist', (_, playlistId: number, artworkPath: string) =>
      addArtworkToAPlaylist(playlistId, artworkPath)
    );

    ipcMain.handle('app/renameAPlaylist', (_, playlistId: number, newName: string) =>
      renameAPlaylist(playlistId, newName)
    );

    ipcMain.handle('app/clearSongHistory', () => clearSongHistory());

    ipcMain.handle(
      'app/deleteSongsFromSystem',
      (_, absoluteFilePaths: string[], isPermanentDelete: boolean) =>
        deleteSongsFromSystem(absoluteFilePaths, abortSignal, isPermanentDelete)
    );

    ipcMain.handle('app/resyncSongsLibrary', async () => {
      await checkForNewSongs();
      svc.sendMessageToRenderer({ messageCode: 'RESYNC_SUCCESSFUL' });
    });

    ipcMain.handle('app/getBlacklistData', getBlacklistData);

    ipcMain.handle('app/blacklistSongs', (_, songIds: number[]) => blacklistSongs(songIds));

    ipcMain.handle('app/restoreBlacklistedSongs', (_, songIds: number[]) =>
      restoreBlacklistedSongs(songIds)
    );

    ipcMain.handle(
      'app/updateSongId3Tags',
      (_, songIdOrPath: string, tags: SongTags, sendUpdatedData?: boolean, isKnownSource = true) =>
        updateSongId3Tags(songIdOrPath, tags, sendUpdatedData, isKnownSource)
    );

    ipcMain.handle('app/getImgFileLocation', svc.getImagefileLocation);
    ipcMain.handle('app/getFontFileLocation', getFontFileLocation);

    ipcMain.handle('app/selectCustomBackground', selectCustomBackground);
    ipcMain.handle('app/listBackgrounds', listBackgrounds);
    ipcMain.handle('app/deleteBackground', (_e, filePath: string) => deleteBackground(filePath));
    // ipcMain.handle('app/inlineWallpaperHtml', (_e, filePath: string) => inlineWallpaperHtml(filePath));
    ipcMain.handle('app/registerWallpaper', async (_e, sourceDir: string) =>
      registerWallpaper(sourceDir)
    );
    ipcMain.handle('app/getWallpaperUrl', (_e, id: string, file: string) =>
      getWallpaperUrl(id, file)
    );

    ipcMain.handle('app/getWallpaperEngineWallpapers', getWallpaperEngineWallpapers);

    // Wallpaper Engine Scene -> MP4 recording
    // Auto-grant the WE window to getDisplayMedia (WGC backend) so the
    // renderer can capture GPU-rendered scene content DXGI misses.
    installDisplayMediaHandler();
    ipcMain.handle('we:launchWindow', (_e, path: string, width: number, height: number) =>
      launchWEWindow(path, width, height)
    );
    ipcMain.handle('we:closeWindow', (_e, windowTitle: string) => closeWEWindow(windowTitle));
    ipcMain.handle('we:getWindowSources', () => getWindowSources());
    ipcMain.handle('we:hideCursor', () => hideCursor());
    ipcMain.handle('we:showCursor', () => showCursor());
    ipcMain.handle('we:getWindowRect', (_e, windowTitle: string) =>
      getWindowRectByTitle(windowTitle)
    );
    // Pin the WE recording window to an exact rect (top-left) and topmost — WE
    // ignores its own -x/-y/-width/-height at near-fullscreen sizes, so the
    // Win32 rect is what the renderer crops to.
    ipcMain.handle(
      'we:setWindowRect',
      (_e, windowTitle: string, x: number, y: number, width: number, height: number) =>
        setWindowRectByTitle(windowTitle, x, y, width, height)
    );
    // Best-effort time-plugin strip for recording: returns a temp project.json
    // copy (or the original path unchanged if nothing to strip).
    ipcMain.handle('we:prepareScene', (_e, path: string) => prepareSceneForRecording(path));
    // Force DWM to recomposite the WE window (nudge (x,y) → (x+1,y) → (x,y))
    // after pinning it, to avoid the MPO overlay-plane cache.
    ipcMain.handle('we:nudgeWindow', (_e, windowTitle: string, x: number, y: number) =>
      nudgeWindowByTitle(windowTitle, x, y)
    );

    // Save diagnostic PNG snapshots (full capture frame + recorded crop) so a
    // failed recording can be inspected.
    ipcMain.handle('app/saveDebugCapture', (_e, fullPng: string, cropPng: string) => {
      const dir = join(app.getPath('userData'), 'debug');
      mkdirSync(dir, { recursive: true });
      const ts = Date.now();
      const fullPath = join(dir, `we_rec_fail_full_${ts}.png`);
      const cropPath = join(dir, `we_rec_fail_crop_${ts}.png`);
      writeFileSync(fullPath, Buffer.from(fullPng.split(',')[1] || '', 'base64'));
      writeFileSync(cropPath, Buffer.from(cropPng.split(',')[1] || '', 'base64'));
      return { dir, fullPath, cropPath };
    });
    // Save a single named PNG from the recording canvas — success vs failed
    // capture-chain diagnostics (userData/debug/we_capture_*.png).
    ipcMain.handle('app/saveDebugPng', (_e, png: string, name: string) => {
      const dir = join(app.getPath('userData'), 'debug');
      mkdirSync(dir, { recursive: true });
      const filePath = join(dir, name);
      writeFileSync(filePath, Buffer.from(png.split(',')[1] || '', 'base64'));
      return { dir, filePath };
    });

    ipcMain.handle('app/getDesktopSources', async () => {
      const sources = await desktopCapturer.getSources({ types: ['screen'] });
      return sources.map((s) => ({ id: s.id, name: s.name }));
    });

    ipcMain.handle(
      'app/saveRecordedBackground',
      async (
        _e,
        buffer: Uint8Array,
        saveToDesktop: boolean,
        prefix?: string,
        coverDataUrl?: string
      ) => {
        const result = await saveRecordedBackground(buffer, saveToDesktop, prefix, coverDataUrl);
        if (result.success) {
          mainWindow.webContents.send('app/backgroundsChanged');
        }
        return result;
      }
    );

    // Minimize/restore for WE recording (fullscreen exit is in main.ts)
    ipcMain.on('app/minimizeForRecording', () => mainWindow.minimize());
    ipcMain.on('app/restoreFromRecording', () => {
      mainWindow.restore();
      mainWindow.focus();
    });

    ipcMain.handle('app/svc.getFolderLocation', svc.getFolderLocation);

    ipcMain.handle('app/getSongId3Tags', (_, songId: number, isKnownSource = true) =>
      sendSongID3Tags(songId, isKnownSource)
    );

    ipcMain.handle('app/clearSearchHistory', (_, searchText?: string[]) =>
      clearSearchHistoryResults(searchText)
    );

    ipcMain.handle('app/getFolderStructures', () => getFolderStructures());

    ipcMain.handle('app/reParseSong', (_, songPath: string) => reParseSong(songPath));

    ipcMain.on('app/svc.resetApp', () => svc.resetApp(!svc.IS_DEVELOPMENT));

    ipcMain.on('app/openLogFile', () => shell.openPath(logFilePath));

    ipcMain.on('app/svc.revealSongInFileExplorer', (_, songId: number) =>
      svc.revealSongInFileExplorer(songId)
    );

    ipcMain.on('app/revealFolderInFileExplorer', (_, folderPath: string) =>
      shell.showItemInFolder(folderPath)
    );

    ipcMain.on('app/saveArtworkToSystem', (_, artworkPath: string, saveName?: string) =>
      saveArtworkToSystem(artworkPath, saveName)
    );

    ipcMain.on('app/openInBrowser', (_, url: string) => shell.openExternal(url));

    ipcMain.on('app/loginToLastFmInBrowser', () =>
      shell.openExternal(
        `http://www.last.fm/api/auth/?api_key=${import.meta.env.MAIN_VITE_LAST_FM_API_KEY}&cb=nora://auth?service=lastfm`
      )
    );

    ipcMain.handle('app/exportAppData', (_, localStorageData: string) =>
      exportAppData(localStorageData)
    );

    ipcMain.handle('app/exportPlaylist', (_, playlistId: number) => exportPlaylist(playlistId));

    ipcMain.handle('app/importAppData', importAppData);

    ipcMain.handle('app/importPlaylist', (_, targetPlaylistId?: number) =>
      importPlaylist(targetPlaylistId)
    );

    ipcMain.handle(
      'app/svc.getRendererLogs',
      (
        _: unknown,
        mes: string | Error,
        data?: Record<string, unknown>,
        logToConsoleType: LogMessageTypes = 'INFO',
        forceWindowRestart = false,
        forceMainRestart = false
      ) => svc.getRendererLogs(mes, data, logToConsoleType, forceWindowRestart, forceMainRestart)
    );

    ipcMain.handle('app/removeAMusicFolder', (_, absolutePath: string) =>
      removeMusicFolder(absolutePath)
    );

    ipcMain.handle('app/svc.changePlayerType', (_, type: PlayerTypes) =>
      svc.changePlayerType(type)
    );

    ipcMain.handle('app/svc.toggleMiniPlayerAlwaysOnTop', (_, isMiniPlayerAlwaysOnTop: boolean) =>
      svc.toggleMiniPlayerAlwaysOnTop(isMiniPlayerAlwaysOnTop)
    );

    ipcMain.handle('app/svc.toggleAutoLaunch', (_, autoLaunchState: boolean) =>
      svc.toggleAutoLaunch(autoLaunchState)
    );

    ipcMain.handle('app/getFolderData', (_, folderPaths?: string[], sortType?: FolderSortTypes) =>
      getMusicFolderData(folderPaths, sortType)
    );

    ipcMain.handle('app/compareEncryptedData', (_, data: string, encryptedData: string) =>
      compare(data, encryptedData)
    );

    ipcMain.handle('app/isMetadataUpdatesPending', (_, songPath: string) =>
      isMetadataUpdatesPending(removeDefaultAppProtocolFromFilePath(songPath))
    );

    ipcMain.handle('app/blacklistFolders', (_, folderPaths: string[]) =>
      blacklistFolders(folderPaths)
    );

    ipcMain.handle('app/restoreBlacklistedFolders', (_, folderPaths: string[]) =>
      restoreBlacklistedFolders(folderPaths)
    );

    ipcMain.handle(
      'app/toggleBlacklistedFolders',
      (_, folderPaths: string[], isBlacklistFolder?: boolean) =>
        toggleBlacklistFolders(folderPaths, isBlacklistFolder)
    );

    ipcMain.on('app/networkStatusChange', (_: unknown, isConnected: boolean) => {
      logger.info(
        isConnected
          ? `App connected to the internet successfully`
          : `App disconnected from the internet`
      );
      // isConnectedToInternet = isConnected;
    });

    ipcMain.handle('app/getArtworksForMultipleArtworksCover', (_, songIds: number[]) =>
      getArtworksForMultipleArtworksCover(songIds)
    );

    ipcMain.on('app/openDevTools', () => {
      logger.info('User requested for devtools.');
      mainWindow.webContents.openDevTools({
        mode: 'detach',
        activate: true
      });
    });

    ipcMain.on('app/svc.restartRenderer', (_: unknown, reason: string) => {
      logger.info(`Renderer requested a renderer refresh.`, { reason });
      svc.restartRenderer();
    });

    ipcMain.on('app/svc.restartApp', (_: unknown, reason: string) => svc.restartApp(reason));

    // NCM IPC handlers
    ipcMain.handle(
      'ncm/request',
      (_event, requestPath: string, query: Record<string, string>, cookie: string) =>
        callNcmApi(requestPath, query, cookie)
    );
    ipcMain.handle('ncm/downloadSongs', (_event, songs, cookie, quality: NcmSongQuality) =>
      downloadNcmSongs(songs, cookie, quality)
    );
    ipcMain.handle('ncm/accounts/list', () => listNcmAccounts());
    ipcMain.handle('ncm/accounts/save', (_event, account: SavedNcmAccount, cookie: string) =>
      saveNcmAccount(account, cookie)
    );
    ipcMain.handle('ncm/accounts/cookie', (_event, userId: number) => getNcmAccountCookie(userId));
    ipcMain.handle('ncm/accounts/activate', (_event, userId: number | null) =>
      setActiveNcmAccount(userId)
    );
    ipcMain.handle('ncm/accounts/remove', (_event, userId: number) => removeNcmAccount(userId));

    // NCM 歌单封面更新
    ipcMain.handle(
      'ncm/updateCover',
      async (_event, playlistId: number, filePath: string, cookie: string) => {
        const fs = await import('fs');
        const path = await import('path');
        const buf = fs.readFileSync(filePath);
        const ext = path.extname(filePath).slice(1) || 'jpg';
        const imgFile = {
          name: `cover.${ext}`,
          mimetype: `image/${ext === 'png' ? 'png' : 'jpeg'}`,
          data: buf
        };
        return callNcmApi(
          'playlist/cover/update',
          { id: String(playlistId), imgFile } as any,
          cookie
        );
      }
    );

    ipcMain.handle('ncm/registerSong', (_event, entry: Record<string, unknown>) => {
      registerNcmSong(entry as unknown as Parameters<typeof registerNcmSong>[0]);
    });

    ipcMain.handle('ncm/registerSongs', (_event, entries: Record<string, unknown>[]) => {
      for (const entry of entries) {
        registerNcmSong(entry as unknown as Parameters<typeof registerNcmSong>[0]);
      }
    });

    ipcMain.handle('ncm/getSong', (_event, songId: number) => getNcmSong(songId));

    // 节拍检测：读本地文件或代理 HTTP(S) 请求（绕过渲染进程 CSP）
    ipcMain.handle('app/readFileToArrayBuffer', async (_event, url: string) => {
      if (/^https?:\/\//i.test(url)) {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.arrayBuffer();
      }
      const fs = await import('fs');
      const buf = fs.readFileSync(url);
      return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    });
  }
}
