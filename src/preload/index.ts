import { contextBridge, ipcRenderer, webUtils } from 'electron';

import type {
  MssCacheStatus,
  MssPacket,
  MssPreparedTrack,
  MssResult,
  MssRuntimeInfo,
  MssTrack
} from '../common/colorosMss';
import type { NcmAccountSnapshot, SavedNcmAccount } from '../common/ncmAccount';
// const { contextBridge, ipcRenderer } = require('electron');
const properties = {
  isInDevelopment: process.env.NODE_ENV === 'development' || process.env.DEBUG_PROD === 'true',
  commandLineArgs: process.argv,
  platform: process.platform
};

const windowControls = {
  minimizeApp: (): void => ipcRenderer.send('app/minimize'),
  toggleMaximizeApp: (): void => ipcRenderer.send('app/toggleMaximize'),
  isMaximizedApp: (): Promise<boolean> => ipcRenderer.invoke('app/isMaximized'),
  onWindowMaximize: (callback: () => void): (() => void) => {
    ipcRenderer.on('app/maximized', callback);
    return () => ipcRenderer.removeListener('app/maximized', callback);
  },
  onWindowUnmaximize: (callback: () => void): (() => void) => {
    ipcRenderer.on('app/unmaximized', callback);
    return () => ipcRenderer.removeListener('app/unmaximized', callback);
  },
  closeApp: (): void => ipcRenderer.send('app/close'),
  hideApp: (): void => ipcRenderer.send('app/hide'),
  showApp: (): void => ipcRenderer.send('app/show'),
  changePlayerType: (type: PlayerTypes): Promise<void> =>
    ipcRenderer.invoke('app/svc.changePlayerType', type),
  onWindowFocus: (callback: (e: unknown) => void): (() => void) => {
    ipcRenderer.on('app/focused', callback);
    return () => ipcRenderer.removeListener('app/focused', callback);
  },
  onWindowBlur: (callback: (e: unknown) => void): (() => void) => {
    ipcRenderer.on('app/blurred', callback);
    return () => ipcRenderer.removeListener('app/blurred', callback);
  }
};

const theme = {
  listenForSystemThemeChanges: (
    callback: (e: unknown, isDarkMode: boolean, usingSystemTheme: boolean) => void
  ) => ipcRenderer.on('app/systemThemeChange', callback),
  changeAppTheme: (appTheme?: AppTheme): void => ipcRenderer.send('app/changeAppTheme', appTheme),
  stoplisteningForSystemThemeChanges: (
    callback: (e: unknown, isDarkMode: boolean, usingSystemTheme: boolean) => void
  ) => ipcRenderer.removeListener('app/systemThemeChange', callback)
};

const playerControls = {
  songPlaybackStateChange: (isPlaying: boolean): void =>
    ipcRenderer.send('app/player/songPlaybackStateChange', isPlaying),
  toggleSongPlayback: (callback: (e: unknown) => void) =>
    ipcRenderer.on('app/player/toggleSongPlaybackState', callback),
  skipForwardToNextSong: (callback: (e: unknown) => void) =>
    ipcRenderer.on('app/player/skipForward', callback),
  skipBackwardToPreviousSong: (callback: (e: unknown) => void) =>
    ipcRenderer.on('app/player/skipBackward', callback),
  sendSongPosition: (position: number): void => ipcRenderer.send('app/getSongPosition', position),
  setDiscordRpcActivity: (options: unknown): void =>
    ipcRenderer.send('app/setDiscordRpcActivity', options),

  toggleLikeSongs: (
    songIds: number[],
    isLikeSong?: boolean
  ): Promise<ToggleLikeSongReturnValue | undefined> =>
    ipcRenderer.invoke('app/toggleLikeSongs', songIds, isLikeSong),

  removeTogglePlaybackStateEvent: (callback: (e: unknown) => void) =>
    ipcRenderer.removeListener('app/player/toggleSongPlaybackState', callback),
  removeSkipBackwardToPreviousSongEvent: (callback: (e: unknown) => void) =>
    ipcRenderer.removeListener('app/player/skipBackward', callback),
  removeSkipForwardToNextSongEvent: (callback: (e: unknown) => void) =>
    ipcRenderer.removeListener('app/player/skipForward', callback)
};

const audioLibraryControls = {
  checkForStartUpSongs: (): Promise<AudioPlayerData | undefined> =>
    ipcRenderer.invoke('app/checkForStartUpSongs'),
  addSongsFromFolderStructures: (
    structures: FolderStructure[],
    sortType?: SongSortTypes
  ): Promise<SongData[]> =>
    ipcRenderer.invoke('app/addSongsFromFolderStructures', structures, sortType),
  getSong: (songId: number, updateListeningRate = true): Promise<AudioPlayerData> =>
    ipcRenderer.invoke('app/getSong', songId, updateListeningRate),
  getAllSongs: (
    sortType?: SongSortTypes,
    filterType?: SongFilterTypes,
    paginatingData?: PaginatingData
  ): Promise<PaginatedResult<AudioInfo, SongSortTypes>> =>
    ipcRenderer.invoke('app/getAllSongs', sortType, filterType, paginatingData),
  getAllSongIds: (
    sortType?: SongSortTypes,
    filterType?: SongFilterTypes,
    paginatingData?: PaginatingData
  ): Promise<PaginatedResult<{ id: number; isBlacklisted: boolean }, SongSortTypes>> =>
    ipcRenderer.invoke('app/getAllSongIds', sortType, filterType, paginatingData),
  getSongInfo: (
    songIds: number[],
    sortType?: SongSortTypes,
    filterType?: SongFilterTypes,
    limit?: number,
    preserveIdOrder = false
  ): Promise<SongData[] | undefined> =>
    ipcRenderer.invoke('app/getSongInfo', songIds, sortType, filterType, limit, preserveIdOrder),
  getAllFavoriteSongs: (
    sortType?: SongSortTypes,
    paginatingData?: PaginatingData
  ): Promise<PaginatedResult<SongData, SongSortTypes>> =>
    ipcRenderer.invoke('app/getAllFavoriteSongs', sortType, paginatingData),
  resyncSongsLibrary: (): Promise<true> => ipcRenderer.invoke('app/resyncSongsLibrary'),
  getBlacklistData: (): Promise<Blacklist> => ipcRenderer.invoke('app/getBlacklistData')
};

// $ APP PLAYER UNKNOWN SONGS FETCHING APIS
const unknownSource = {
  playSongFromUnknownSource: (callback: (_: unknown, audioPlayerData: AudioPlayerData) => void) =>
    ipcRenderer.on('app/playSongFromUnknownSource', callback),
  getSongFromUnknownSource: (songPath: string): Promise<AudioPlayerData> =>
    ipcRenderer.invoke('app/getSongFromUnknownSource', songPath),
  removePlaySongFromUnknownSourceEvent: (
    callback: (_: unknown, audioPlayerData: AudioPlayerData) => void
  ) => ipcRenderer.removeListener('app/playSongFromUnknownSource', callback)
};

// $ QUIT EVENT HANDLING
const quitEvent = {
  beforeQuitEvent: (callback: (e: unknown) => void) =>
    ipcRenderer.on('app/beforeQuitEvent', callback),
  removeBeforeQuitEventListener: (callback: (...args: unknown[]) => void) =>
    ipcRenderer.removeListener('app/beforeQuitEvent', callback)
};

// $ SYSTEM BATTERY RELATED EVENTS
const battery = {
  listenForBatteryPowerStateChanges: (callback: (_: unknown, isOnBatteryPower: boolean) => void) =>
    ipcRenderer.on('app/isOnBatteryPower', callback),
  stopListeningForBatteryPowerStateChanges: (
    callback: (_: unknown, isOnBatteryPower: boolean) => void
  ) => ipcRenderer.removeListener('app/isOnBatteryPower', callback)
};

// $ APP FULL-SCREEN EVENTS
const fullscreen = {
  enterFullscreen: (): void => ipcRenderer.send('app/enterFullscreen'),
  onEnterFullscreen: (callback: (e: unknown) => void): (() => void) => {
    ipcRenderer.on('app/enteredFullscreen', callback);
    return () => ipcRenderer.removeListener('app/enteredFullscreen', callback);
  },
  onLeaveFullscreen: (callback: (e: unknown) => void): (() => void) => {
    ipcRenderer.on('app/leftFullscreen', callback);
    return () => ipcRenderer.removeListener('app/leftFullscreen', callback);
  },
  onBackgroundsChanged: (callback: (e: unknown) => void) =>
    ipcRenderer.on('app/backgroundsChanged', callback),
  toggleFullscreen: (): void => ipcRenderer.send('app/toggleFullscreen'),
  exitFullscreen: (): void => ipcRenderer.send('app/exitFullscreen'),
  isFullscreen: (): Promise<boolean> => ipcRenderer.invoke('app/isFullscreen')
};

// $ APP SEARCH
const search = {
  songIds: (keyword: string): Promise<number[]> => ipcRenderer.invoke('app/searchSongIds', keyword),
  search: (
    filter: SearchFilters,
    value: string,
    updateSearchHistory?: boolean,
    isSimilaritySearchEnabled?: boolean
  ): Promise<SearchResult> =>
    ipcRenderer.invoke('app/search', filter, value, updateSearchHistory, isSimilaritySearchEnabled),
  clearSearchHistory: (searchText?: string[]): Promise<boolean> =>
    ipcRenderer.invoke('app/clearSearchHistory', searchText)
};

// $ SONG LYRICS
const lyrics = {
  getSongLyrics: (
    songInfo: LyricsRequestTrackInfo,
    lyricsType?: LyricsTypes,
    lyricsRequestType?: LyricsRequestTypes,
    saveLyricsAutomatically?: AutomaticallySaveLyricsTypes
  ): Promise<SongLyrics | undefined> =>
    ipcRenderer.invoke(
      'app/getSongLyrics',
      songInfo,
      lyricsType,
      lyricsRequestType,
      saveLyricsAutomatically
    )
};

// $ APP MESSAGES
const messages = {
  getMessageFromMain: (
    callback: (event: unknown, messageCode: MessageCodes, data: Record<string, unknown>) => void
  ) => ipcRenderer.on('app/sendMessageToRendererEvent', callback),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  removeMessageToRendererEventListener: (callback: (...args: any[]) => void) =>
    ipcRenderer.removeListener('app/sendMessageToRendererEvent', callback)
};

// $ APP DATA UPDATE EVENTS
const dataUpdates = {
  dataUpdateEvent: (callback: (e: unknown, dataEvents: DataUpdateEvent[]) => void) =>
    ipcRenderer.on('app/dataUpdateEvent', callback),
  removeDataUpdateEventListeners: () => ipcRenderer.removeAllListeners('app/dataUpdateEvent')
};

// $ APP USER DATA
const userData = {
  getUserData: (): Promise<UserData> => ipcRenderer.invoke('app/getUserData'),
  saveUserData: (dataType: UserDataTypes, data: unknown) =>
    ipcRenderer.invoke('app/saveUserData', dataType, data)
};

//  $ USER SETTINGS
const settings = {
  getUserSettings: (): Promise<UserSettings> => ipcRenderer.invoke('app/getUserSettings'),
  saveUserSettings: (settings: Partial<UserSettings>): Promise<void> =>
    ipcRenderer.invoke('app/saveUserSettings', settings),

  updateDiscordRpcState: (enableDiscordRpc: boolean): Promise<void> =>
    ipcRenderer.invoke('app/saveUserSettings', {
      enableDiscordRPC: enableDiscordRpc
    }),
  updateSongScrobblingToLastFMState: (enableScrobbling: boolean): Promise<void> =>
    ipcRenderer.invoke('app/saveUserSettings', {
      sendSongScrobblingDataToLastFM: enableScrobbling
    }),
  updateSongFavoritesToLastFMState: (enableFavorites: boolean): Promise<void> =>
    ipcRenderer.invoke('app/saveUserSettings', {
      sendSongFavoritesDataToLastFM: enableFavorites
    }),
  updateNowPlayingSongDataToLastFMState: (enableNowPlaying: boolean): Promise<void> =>
    ipcRenderer.invoke('app/saveUserSettings', {
      sendNowPlayingSongDataToLastFM: enableNowPlaying
    }),
  updateSaveLyricsInLrcFilesForSupportedSongs: (enableSave: boolean): Promise<void> =>
    ipcRenderer.invoke('app/saveUserSettings', {
      saveLyricsInLrcFilesForSupportedSongs: enableSave
    }),
  updateCustomLrcFilesSaveLocation: (location: string): Promise<void> =>
    ipcRenderer.invoke('app/saveUserSettings', {
      customLrcFilesSaveLocation: location
    }),
  updateOpenWindowAsHiddenOnSystemStart: (enable: boolean): Promise<void> =>
    ipcRenderer.invoke('app/saveUserSettings', {
      openWindowAsHiddenOnSystemStart: enable
    }),
  updateHideWindowOnCloseState: (enable: boolean): Promise<void> =>
    ipcRenderer.invoke('app/saveUserSettings', { hideWindowOnClose: enable }),
  updateSaveVerboseLogs: (enable: boolean): Promise<void> =>
    ipcRenderer.invoke('app/saveUserSettings', { saveVerboseLogs: enable })
};

// $ FOLDER DATA
const folderData = {
  getFolderData: (folderPaths: string[], sortType?: FolderSortTypes): Promise<MusicFolder[]> =>
    ipcRenderer.invoke('app/getFolderData', folderPaths, sortType),
  blacklistFolders: (folderPaths: string[]): Promise<void> =>
    ipcRenderer.invoke('app/blacklistFolders', folderPaths),
  restoreBlacklistedFolders: (folderPaths: string[]): Promise<void> =>
    ipcRenderer.invoke('app/restoreBlacklistedFolders', folderPaths),
  toggleBlacklistedFolders: (folderPaths: string[], isBlacklistFolder?: boolean): Promise<void> =>
    ipcRenderer.invoke('app/toggleBlacklistedFolders', folderPaths, isBlacklistFolder),
  revealFolderInFileExplorer: (folderPath: string): void =>
    ipcRenderer.send('app/revealFolderInFileExplorer', folderPath),
  getFolderStructures: (): Promise<FolderStructure[]> =>
    ipcRenderer.invoke('app/getFolderStructures'),
  removeAMusicFolder: (absolutePath: string): Promise<void> =>
    ipcRenderer.invoke('app/removeAMusicFolder', absolutePath)
};

// $ ARTISTS DATA
const artistsData = {
  getArtistData: (
    artistIdsOrNames?: (string | number)[],
    sortType?: ArtistSortTypes,
    filterType?: ArtistFilterTypes,
    start?: number,
    end?: number,
    limit?: number
  ): Promise<PaginatedResult<Artist, ArtistSortTypes>> => {
    const stringIds = artistIdsOrNames?.map(String);
    return ipcRenderer.invoke(
      'app/getArtistData',
      stringIds,
      sortType,
      filterType,
      start,
      end,
      limit
    );
  },
  getArtistArtworks: (artistId: number): Promise<ArtistInfoFromNet | undefined> =>
    ipcRenderer.invoke('app/getArtistArtworks', artistId)
};

// $ GENRES DATA
const genresData = {
  getGenresData: (
    genreNamesOrIds?: (string | number)[],
    sortType?: GenreSortTypes,
    start?: number,
    end?: number
  ): Promise<PaginatedResult<Genre, GenreSortTypes>> => {
    const stringIds = genreNamesOrIds?.map(String);
    return ipcRenderer.invoke('app/getGenresData', stringIds, sortType, start, end);
  }
};

// $ ALBUMS DATA
const albumsData = {
  getAlbumData: (
    albumTitlesOrIds?: (string | number)[],
    sortType?: AlbumSortTypes,
    start?: number,
    end?: number
  ): Promise<PaginatedResult<Album, AlbumSortTypes>> => {
    const stringIds = albumTitlesOrIds?.map(String);
    return ipcRenderer.invoke('app/getAlbumData', stringIds, sortType, start, end);
  }
};

// $ PLAYLIST DATA AND CONTROLS
const playlistsData = {
  getPlaylistData: (
    playlistIds?: number[],
    sortType?: PlaylistSortTypes,
    start?: number,
    end?: number,
    onlyMutablePlaylists?: boolean
  ): Promise<PaginatedResult<Playlist, PlaylistSortTypes>> =>
    ipcRenderer.invoke(
      'app/getPlaylistData',
      playlistIds,
      sortType,
      start,
      end,
      onlyMutablePlaylists
    ),
  addNewPlaylist: (
    playlistName: string,
    songIds?: number[],
    artworkPath?: string
  ): Promise<{ success: boolean; message?: string; playlist?: Playlist }> =>
    ipcRenderer.invoke('app/addNewPlaylist', playlistName, songIds, artworkPath),
  addSongsToPlaylist: (playlistId: number, songIds: number[]): PromiseFunctionReturn =>
    ipcRenderer.invoke('app/addSongsToPlaylist', playlistId, songIds),
  addArtworkToAPlaylist: (
    playlistId: number,
    artworkPath: string
  ): Promise<ArtworkPaths | undefined> =>
    ipcRenderer.invoke('app/addArtworkToAPlaylist', playlistId, artworkPath),
  renameAPlaylist: (playlistId: number, newName: string): Promise<void> =>
    ipcRenderer.invoke('app/renameAPlaylist', playlistId, newName),
  removeSongFromPlaylist: (playlistId: number, songId: number): PromiseFunctionReturn =>
    ipcRenderer.invoke('app/removeSongFromPlaylist', playlistId, songId),
  removePlaylists: (playlistIds: number[]) =>
    ipcRenderer.invoke('app/removePlaylists', playlistIds),
  getArtworksForMultipleArtworksCover: (
    songIds: number[]
  ): Promise<{ songId: number; artworkPaths: ArtworkPaths }[]> =>
    ipcRenderer.invoke('app/getArtworksForMultipleArtworksCover', songIds)
};

const queue = {
  getQueueInfo: (queueType: QueueTypes, id: string): Promise<QueueInfo | undefined> =>
    ipcRenderer.invoke('app/getQueueInfo', queueType, id)
};

// $ APP LOGS
const log = {
  sendLogs: (
    mes: string | Error,
    data?: Record<string, unknown>,
    logToConsoleType: LogMessageTypes = 'INFO',
    forceWindowRestart = false,
    forceMainRestart = false
  ): Promise<unknown> => {
    return ipcRenderer.invoke(
      'app/svc.getRendererLogs',
      mes,
      data,
      logToConsoleType,
      forceWindowRestart,
      forceMainRestart
    );
  },
  openLogFile: (): void => ipcRenderer.send('app/openLogFile')
};

// $ APP SETTINGS HELPER FUNCTIONS
const settingsHelpers = {
  getAppLanguage: (lang: LanguageCodes): void => ipcRenderer.send('app/getAppLanguage', lang),
  openInBrowser: (url: string): void => ipcRenderer.send('app/openInBrowser', url),
  toggleAutoLaunch: (autoLaunchState: boolean): Promise<void> =>
    ipcRenderer.invoke('app/svc.toggleAutoLaunch', autoLaunchState),
  openDevtools: () => ipcRenderer.send('app/openDevTools'),
  networkStatusChange: (isConnected: boolean): void =>
    ipcRenderer.send('app/networkStatusChange', isConnected),
  compareEncryptedData: (): Promise<boolean> => ipcRenderer.invoke('app/compareEncryptedData'),
  loginToLastFmInBrowser: () => ipcRenderer.send('app/loginToLastFmInBrowser'),
  getFolderLocation: (): Promise<string> => ipcRenderer.invoke('app/svc.getFolderLocation'),
  selectCustomBackground: (): Promise<string | undefined> =>
    ipcRenderer.invoke('app/selectCustomBackground'),
  listBackgrounds: (): Promise<
    { name: string; path: string; type: 'image' | 'video'; cover?: string }[]
  > => ipcRenderer.invoke('app/listBackgrounds'),
  deleteBackground: (filePath: string): Promise<boolean> =>
    ipcRenderer.invoke('app/deleteBackground', filePath),
  registerWallpaper: (sourceDir: string): Promise<string | null> =>
    ipcRenderer.invoke('app/registerWallpaper', sourceDir),
  getWallpaperUrl: (id: string, file?: string): Promise<string> =>
    ipcRenderer.invoke('app/getWallpaperUrl', id, file || 'index.html'),
  getDesktopSources: (): Promise<{ id: string; name: string }[]> =>
    ipcRenderer.invoke('app/getDesktopSources'),
  saveRecordedBackground: (
    buffer: Uint8Array,
    saveToDesktop: boolean,
    prefix?: string,
    coverDataUrl?: string
  ): Promise<{ success: boolean; path: string; name: string }> =>
    ipcRenderer.invoke('app/saveRecordedBackground', buffer, saveToDesktop, prefix, coverDataUrl),
  exitFullscreen: (): void => ipcRenderer.send('app/exitFullscreen'),
  minimizeForRecording: (): void => ipcRenderer.send('app/minimizeForRecording'),
  restoreFromRecording: (): void => ipcRenderer.send('app/restoreFromRecording'),
  toggleDesktopLyrics: (): Promise<boolean> => ipcRenderer.invoke('desktop-lyrics:toggle'),
  updateDesktopLyrics: (opts: {
    x?: number;
    y?: number;
    opacity?: number;
    scale?: number;
  }): Promise<void> => ipcRenderer.invoke('desktop-lyrics:update', opts),
  getDesktopLyricsState: (): Promise<boolean> => ipcRenderer.invoke('desktop-lyrics:get-state'),
  onDesktopLyricsStateChanged: (callback: (data: { enabled: boolean }) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, data: { enabled: boolean }) =>
      callback(data);
    ipcRenderer.on('desktop-lyrics:state-changed', listener);
    return () => ipcRenderer.removeListener('desktop-lyrics:state-changed', listener);
  },
  sendDesktopLyricsState: (payload: Record<string, unknown>): void =>
    ipcRenderer.send('desktop-lyrics:send-state', payload),
  onDesktopLyricsState: (callback: (data: Record<string, unknown>) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, data: Record<string, unknown>) =>
      callback(data);
    ipcRenderer.on('desktop-lyrics:state', listener);
    return () => ipcRenderer.removeListener('desktop-lyrics:state', listener);
  },
  desktopLyricsReady: (): void => ipcRenderer.send('desktop-lyrics:ready'),
  getFontFileLocation: (): Promise<string> => ipcRenderer.invoke('app/getFontFileLocation'),
  getCurrentLyricsState: (): Promise<Record<string, unknown> | null> =>
    ipcRenderer.invoke('desktop-lyrics:get-current-state'),
  getWallpaperEngineWallpapers: (): Promise<WallpaperEngineResult> =>
    ipcRenderer.invoke('app/getWallpaperEngineWallpapers'),
  weLaunchWindow: (
    path: string,
    width: number,
    height: number
  ): Promise<{
    sourceId: string;
    windowTitle: string;
    rect: { x: number; y: number; width: number; height: number } | null;
  }> => ipcRenderer.invoke('we:launchWindow', path, width, height),
  weCloseWindow: (windowTitle: string): Promise<void> =>
    ipcRenderer.invoke('we:closeWindow', windowTitle),
  weGetWindowSources: (): Promise<{ id: string; name: string }[]> =>
    ipcRenderer.invoke('we:getWindowSources'),
  weHideCursor: (): Promise<void> => ipcRenderer.invoke('we:hideCursor'),
  weShowCursor: (): Promise<void> => ipcRenderer.invoke('we:showCursor'),
  weGetWindowRect: (
    windowTitle: string
  ): Promise<{ x: number; y: number; width: number; height: number } | null> =>
    ipcRenderer.invoke('we:getWindowRect', windowTitle),
  weSetWindowRect: (
    windowTitle: string,
    x: number,
    y: number,
    width: number,
    height: number
  ): Promise<{ x: number; y: number; width: number; height: number } | null> =>
    ipcRenderer.invoke('we:setWindowRect', windowTitle, x, y, width, height),
  wePrepareScene: (path: string): Promise<string> => ipcRenderer.invoke('we:prepareScene', path),
  weNudgeWindow: (windowTitle: string, x: number, y: number): Promise<void> =>
    ipcRenderer.invoke('we:nudgeWindow', windowTitle, x, y),
  saveDebugCapture: (
    fullPng: string,
    cropPng: string
  ): Promise<{ dir: string; fullPath: string; cropPath: string }> =>
    ipcRenderer.invoke('app/saveDebugCapture', fullPng, cropPng),
  saveDebugPng: (png: string, name: string): Promise<{ dir: string; filePath: string }> =>
    ipcRenderer.invoke('app/saveDebugPng', png, name),
  getUserKeyboardShortcuts: (): Promise<Record<string, string>> =>
    ipcRenderer.invoke('app/getUserKeyboardShortcuts'),
  saveUserKeyboardShortcuts: (shortcuts: Record<string, string>): Promise<void> =>
    ipcRenderer.invoke('app/saveUserKeyboardShortcuts', shortcuts),
  getUserEqualizerPreset: (): Promise<{
    presetName: string;
    frequencyBands: number[];
    isEnabled: boolean;
  }> => ipcRenderer.invoke('app/getUserEqualizerPreset'),
  saveUserEqualizerPreset: (presetData: {
    presetName?: string;
    frequencyBands?: number[];
    isEnabled?: boolean;
  }): Promise<void> => ipcRenderer.invoke('app/saveUserEqualizerPreset', presetData),
  removeIgnoredFeaturingArtist: (artistId: number): Promise<void> =>
    ipcRenderer.invoke('app/removeIgnoredFeaturingArtist', artistId)
};

// $ APP RESTART OR RESET
const appControls = {
  restartRenderer: (reason: string): void => ipcRenderer.send('app/svc.restartRenderer', reason),
  restartApp: (reason: string): void => ipcRenderer.send('app/svc.restartApp', reason),
  resetApp: (): void => {
    ipcRenderer.removeAllListeners('app/beforeQuitEvent');
    ipcRenderer.send('app/svc.resetApp');
  },
  stopScreenSleeping: () => ipcRenderer.send('app/svc.stopScreenSleeping'),

  allowScreenSleeping: () => ipcRenderer.send('app/svc.allowScreenSleeping')
};

// $ OTHER
const utils = {
  showFilePath: (file: File) => {
    const path = webUtils.getPathForFile(file);
    return path;
  },
  path: {
    join: (...args: string[]) => args.join('/')
  },
  getExtension: (dir: string) => {
    const regex = /(?<name>.+)\.(?<ext>[\w\d]+)(?<search>\?.+)?$/;
    const match = dir.match(regex);
    const ext = match?.groups?.ext || '';
    return ext;
  },
  getBaseName: (dir: string) => {
    const base =
      dir
        .split(/[/\\]/)
        .filter((x) => x)
        .at(-1) || '';
    return base;
  },
  readFileToArrayBuffer: (filePath: string): Promise<ArrayBuffer> =>
    ipcRenderer.invoke('app/readFileToArrayBuffer', filePath),
  removeDefaultAppProtocolFromFilePath: (filePath: string) => {
    return filePath.replace(/nora:[/\\]{1,2}localfiles[/\\]{1,2}|\?[\w+=\w+&?]+$/gm, '');
  }
};

const ncm = {
  request: (path: string, params: Record<string, string>, cookie: string): Promise<unknown> =>
    ipcRenderer.invoke('ncm/request', path, params, cookie),
  listAccounts: (): Promise<NcmAccountSnapshot> => ipcRenderer.invoke('ncm/accounts/list'),
  saveAccount: (account: SavedNcmAccount, cookie: string): Promise<NcmAccountSnapshot> =>
    ipcRenderer.invoke('ncm/accounts/save', account, cookie),
  getAccountCookie: (userId: number): Promise<string | null> =>
    ipcRenderer.invoke('ncm/accounts/cookie', userId),
  activateAccount: (userId: number | null): Promise<NcmAccountSnapshot> =>
    ipcRenderer.invoke('ncm/accounts/activate', userId),
  removeAccount: (userId: number): Promise<NcmAccountSnapshot> =>
    ipcRenderer.invoke('ncm/accounts/remove', userId),
  registerSong: (entry: AudioPlayerData): Promise<AudioPlayerData> =>
    ipcRenderer.invoke('ncm/registerSong', entry),
  registerSongs: (entries: AudioPlayerData[]): Promise<void> =>
    ipcRenderer.invoke('ncm/registerSongs', entries),
  getSong: (songId: number): Promise<AudioPlayerData | undefined> =>
    ipcRenderer.invoke('ncm/getSong', songId)
};

export const api = {
  stemSeparation: {
    clearCache: (): Promise<void> => ipcRenderer.invoke('mss/clearCache'),
    setEnabled: (enabled: boolean): Promise<MssRuntimeInfo | null> =>
      ipcRenderer.invoke('mss/setEnabled', enabled),
    infer: (packet: MssPacket): Promise<MssResult> => ipcRenderer.invoke('mss/infer', packet),
    setCurrent: (track: MssTrack): Promise<void> => ipcRenderer.invoke('mss/current', track),
    setNext: (track: MssTrack | null): Promise<void> => ipcRenderer.invoke('mss/next', track),
    getPrepared: (
      songId: number,
      quality: string,
      path?: string
    ): Promise<MssPreparedTrack | null> =>
      ipcRenderer.invoke('mss/prepared', songId, quality, path),
    setPlaying: (playing: boolean): Promise<void> => ipcRenderer.invoke('mss/playing', playing),
    onCacheStatus: (callback: (status: MssCacheStatus) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, status: MssCacheStatus) =>
        callback(status);
      ipcRenderer.on('mss/cacheStatus', listener);
      return () => ipcRenderer.removeListener('mss/cacheStatus', listener);
    }
  },
  properties,
  windowControls,
  theme,
  playerControls,
  audioLibraryControls,
  unknownSource,
  quitEvent,
  battery,
  fullscreen,
  search,
  lyrics,
  messages,
  dataUpdates,
  userData,
  folderData,
  artistsData,
  genresData,
  albumsData,
  playlistsData,
  log,
  settings,
  settingsHelpers,
  appControls,
  utils,
  queue,
  ncm
};

contextBridge.exposeInMainWorld('api', api);
