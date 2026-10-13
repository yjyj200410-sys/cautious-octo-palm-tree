import { app, BrowserWindow, ipcMain, powerMonitor, shell } from 'electron';

import type { SavedNcmAccount } from '../common/ncmAccount';
import { initializeStemSeparationIPC } from './audio/stemSeparation';
import addSongsFromFolderStructures from './core/addMusicFolder';
import changeAppTheme from './core/changeAppTheme';
import checkForNewSongs from './core/checkForNewSongs';
import checkForStartUpSongs from './core/checkForStartUpSongs';
import fetchAlbumData from './core/fetchAlbumData';
import fetchArtistData from './core/fetchArtistData';
import { getAllFavoriteSongs } from './core/getAllFavoriteSongs';
import getAllSongs, { getAllSongIds } from './core/getAllSongs';
import { getFolderStructures } from './core/getFolderStructures';
import getGenresInfo from './core/getGenresInfo';
import getMusicFolderData from './core/getMusicFolderData';
import getSongInfo from './core/getSongInfo';
import getSongLyrics from './core/getSongLyrics';
import removeMusicFolder from './core/removeMusicFolder';
import { searchSongIds } from './core/searchSongIds';
import sendAudioData from './core/sendAudioData';
import sendAudioDataFromPath from './core/sendAudioDataFromPath';
import sendPlaylistData from './core/sendPlaylistData';
import toggleLikeSongs from './core/toggleLikeSongs';
import { getUserSettings, saveUserSettings } from './db/queries/settings';
import {
  getUserKeyboardShortcuts,
  saveUserKeyboardShortcuts,
  getUserEqualizerPreset,
  saveUserEqualizerPreset
} from './db/queries/userPreferences';
import { getBlacklistData } from './filesystem';
import logger from './logger';
import {
  getNcmAccountCookie,
  listNcmAccounts,
  removeNcmAccount,
  saveNcmAccount,
  setActiveNcmAccount
} from './ncm-server/accountVault';
import { registerNcmSong, getNcmSong } from './ncm-server/ncm-registry';
import { callNcmApi } from './ncm-server/ncm-server';

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
  ) => Promise<void>;
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
import search from './search';
import { getQueueInfo } from './utils/getQueueInfo';

export function initializeIPC(mainWindow: BrowserWindow, _abortSignal: AbortSignal, svc: MainSvc) {
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

    ipcMain.handle('app/getQueueInfo', (_, queueType: QueueTypes, id: string) =>
      getQueueInfo(queueType, id)
    );

    ipcMain.handle('app/resyncSongsLibrary', async () => {
      await checkForNewSongs();
      svc.sendMessageToRenderer({ messageCode: 'RESYNC_SUCCESSFUL' });
    });

    ipcMain.handle('app/getBlacklistData', getBlacklistData);

    ipcMain.on('app/openInBrowser', (_, url: string) => shell.openExternal(url));

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

    ipcMain.handle('app/svc.toggleAutoLaunch', (_, autoLaunchState: boolean) =>
      svc.toggleAutoLaunch(autoLaunchState)
    );

    ipcMain.handle('app/getFolderData', (_, folderPaths?: string[], sortType?: FolderSortTypes) =>
      getMusicFolderData(folderPaths, sortType)
    );

    ipcMain.on('app/networkStatusChange', (_: unknown, isConnected: boolean) => {
      logger.info(
        isConnected
          ? `App connected to the internet successfully`
          : `App disconnected from the internet`
      );
      // isConnectedToInternet = isConnected;
    });

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

    ipcMain.handle('app/getFolderStructures', getFolderStructures);
    ipcMain.handle('app/searchSongIds', (_, keyword: string) => searchSongIds(keyword));

    // NCM IPC handlers
    ipcMain.handle(
      'ncm/request',
      (_event, requestPath: string, query: Record<string, string>, cookie: string) =>
        callNcmApi(requestPath, query, cookie)
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
