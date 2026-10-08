import type { Subscription } from '@tanstack/react-store';

import { dispatch, store } from '../store/store';
import storage from '../utils/localStorage';
import { getPlaybackEndBehavior } from '../utils/playbackEnd';
import { FavoriteService } from '../utils/unifiedStorage';
import { createPlayTrace, getPlayTrace } from './PlayTrace';
import { equalizerBandHertzData } from './equalizerData';
import {
  Chorus, Compressor, Context as ToneContext, Panner3D, Phaser, Reverb,
  StereoWidener, connect as toneConnect
} from 'tone';
import PlayerQueue, { type QueueSongMeta } from './playerQueue';
import { PrefetchManager } from './PrefetchManager';
import { StemSeparation } from './stemSeparation';
import { isRetroEffect, RetroSoundEffect, type RetroEffectMode } from './retroSoundEffects';
import type { MssPreparedTrack, MssTrack } from '@common/colorosMss';
import { normalizeNcmSongQuality } from '@common/ncmQuality';

const AUDIO_FADE_DURATION = 250;

export type SpecialEffectMode =
  | 'none' | 'studio' | 'spatial' | 'rotate3d' | 'wide' | 'chorus' | 'phaser' | RetroEffectMode;

type PlayerEventType =
  | 'timeUpdate'
  | 'durationChange'
  | 'play'
  | 'pause'
  | 'error'
  | 'seeking'
  | 'seeked'
  | 'repeatOne'
  | 'repeatAll'
  | 'playbackComplete'
  | 'songLoaded'
  | 'loadError'
  | 'recordListening'
  | 'repeatSong'
  | 'repeatModeChange'
  | 'queueChange'
  | 'queueMetadataChange';

type PlayerEventCallback<T = unknown> = (data: T) => void;

/**
 * AudioPlayer class that manages audio playback with integrated queue management. Provides
 * event-based architecture for player state changes. Owns a PlayerQueue instance and automatically
 * reacts to queue position changes.
 */
class AudioPlayer {
  private listeners: Map<PlayerEventType, Set<PlayerEventCallback<unknown>>>;

  audio: HTMLAudioElement;
  queue: PlayerQueue;
  currentVolume: number;

  currentContext: AudioContext;
  equalizerBands: Map<EqualizerBandFilters, BiquadFilterNode>;
  gainNode: GainNode;
  stemSeparation: StemSeparation;
  private mediaSource: MediaElementAudioSourceNode | null = null;
  private toneContext: ToneContext | null = null;
  private compressor: Compressor | null = null;
  private reverb: Reverb | null = null;
  private panner3d: Panner3D | null = null;
  private widener: StereoWidener | null = null;
  private chorus: Chorus | null = null;
  private phaser: Phaser | null = null;
  private rotationTimer: ReturnType<typeof setInterval> | null = null;
  private effectMode: SpecialEffectMode = 'none';
  private retroEffect: RetroSoundEffect | null = null;

  // 离线节拍分析


  unsubscribeFunc: Subscription;

  private repeatMode: 'off' | 'one' | 'all' = 'off';
  private pendingAutoPlay: boolean = false;
  private falseEndCount: number = 0;
  private isCurrentSourceTrial = false;
  private unavailableSourceCount = 0;
  private hasAudioError: boolean = false;
  private currentSongLoadStart = 0; // performance.now() for [SWITCH] log

  // ★ URL 解析/预取单一入口（取代 AudioPrefetchManager）
  private prefetchMgr = PrefetchManager.getInstance();
  // ★ generation：每次 loadSong 自增。旧的 load 若在 resolve 后被更新的请求取代，
  //   则不触碰 audio.src / store —— 解决快速连点下旧请求干扰新歌曲的问题。
  private playRequestId = 0;
  private playbackIntent = false;
  private playbackActionId = 0;
  private currentMssTrack:MssTrack|null=null;
  private currentMssRequestId=0;
  private nextMssGeneration=0;
  private nextMssKey='';


  constructor(queue: PlayerQueue) {
    this.listeners = new Map();

    this.audio = new Audio();
    this.queue = queue;

    this.audio.preload = 'auto';
    this.audio.defaultPlaybackRate = 1.0;

    this.currentContext = new window.AudioContext({ sampleRate: 48000 });
    this.stemSeparation = new StemSeparation(this.currentContext);
    this.stemSeparation.onEnabledChange=(enabled)=>{if(enabled)void this.prepareNextMss();else{++this.nextMssGeneration;this.nextMssKey='';this.stemSeparation.setNextTrack(null);}};
    this.stemSeparation.onCurrentPrepared=prepared=>this.activatePreparedMss(prepared);
    this.equalizerBands = new Map();
    this.gainNode = this.currentContext.createGain();

    this.currentVolume = this.audio.volume;

    this.unsubscribeFunc = this.subscribeToStoreEvents();
    this.initializeEqualizer();
    this.setupQueueIntegration();
    this.setupAudioEventListeners();

  }

  /**
   * Sets up integration between queue and player. Automatically loads songs when queue position
   * changes. Propagates queue events through player for convenience.
   *
   * ★ 预取窗口：只在此处（positionChange）更新，且必须在 loadSong 之后调用——
   *   loadSong 会同步把当前曲 push 进 PrefetchManager（PLAY_NOW 抢占，activePlayNow=1），
   *   随后 prefetchAround 排队的 NEXT/NEXT_2 在 P0 解析完成前不会启动（不抢当前曲）。
   */
  private setupQueueIntegration() {
    let lastLoadedSongId: number | null = null;
    // ★ 防 auto-skip 级联：网络故障时每首歌都解析失败（各 ~10-20s），若不限制会
    //   沿整列逐首空转（700 首 = 数小时）。连续失败达阈值即停止跳过并派发事件，
    //   由 UI 显示失败原因，而不是静默跳过。
    let consecutiveLoadFailures = 0;
    const MAX_CONSECUTIVE_LOAD_FAILURES = 3;

    // React to queue position changes - load the new song
    this.queue.on('positionChange', () => {
      const songId = this.queue.currentSongId;
      if (songId && songId !== lastLoadedSongId) {
        lastLoadedSongId = songId;
        this.loadSong(songId, { autoPlay: this.pendingAutoPlay })
          .then((loaded) => {
            if (loaded) consecutiveLoadFailures = 0;
          })
          .catch((err) => {
            if (this.queue.currentSongId !== songId) return;
            console.error('[AudioPlayer.positionChange] Failed to load song:', err);
            consecutiveLoadFailures++;
            // Auto-skip to next song on load failure (bounded — 见上注释)
            if (this.queue.hasNext && consecutiveLoadFailures < MAX_CONSECUTIVE_LOAD_FAILURES) {
              console.log(
                `[AudioPlayer.positionChange] Auto-skipping to next song (${consecutiveLoadFailures}/${MAX_CONSECUTIVE_LOAD_FAILURES})`
              );
              this.pendingAutoPlay = true;
              this.queue.moveToNext();
            } else {
              consecutiveLoadFailures = 0;
              console.error(
                '[AudioPlayer.positionChange] Too many consecutive failures — stopped auto-skip'
              );
            }
          });
        this.pendingAutoPlay = false;
      }
      // ★ Update prefetch window AFTER initiating the load (P1/P2 gated behind P0)
      this.prefetchMgr.prefetchAround(this.queue.position, this.queue);
    });

    // Propagate queue change events through player (prefetch window handled on positionChange)
    this.queue.on('queueChange', (data) => {
      this.emit('queueChange', data);
      if(this.queue.currentSongId===this.currentMssTrack?.songId)void this.prepareNextMss();
    });

    // Propagate metadata changes
    this.queue.on('metadataChange', (data) => {
      this.emit('queueMetadataChange', data);
    });
  }

  private mssQuality(){return normalizeNcmSongQuality(store.state.localStorage?.preferences?.ncmPlaybackQuality);}
  private async prepareNextMss(){
    if(!this.stemSeparation.getSnapshot().enabled)return;
    const songId=this.queue.nextSongId,quality=this.mssQuality();
    const key=songId===null?'':`${songId}:${quality}`;
    if(key===this.nextMssKey)return;
    this.nextMssKey=key;const generation=++this.nextMssGeneration;
    this.stemSeparation.setNextTrack(null);
    if(songId===null){this.stemSeparation.setNextTrack(null);return;}
    try{
      const meta=this.queue.getSongMetadata(songId);
      let data=songId<0&&meta?this.buildSongDataFromMeta(meta):await window.api.audioLibraryControls.getSong(songId);
      if(!data||generation!==this.nextMssGeneration)return;
      const cached=await this.stemSeparation.getPrepared(songId,quality,songId>=0?data.path:undefined);
      let trial=cached?.trial??false;
      if(cached)data={...data,path:cached.originalPath};
      else if(songId<0){
        const path=await this.prefetchMgr.prefetch(songId,'NEXT',{meta:{title:data.title,artists:data.artists?.map(artist=>artist.name).join(' / ')??'',durationMs:data.duration?data.duration*1000:undefined}});
        if(!path)return;data={...data,path};trial=!!this.prefetchMgr.getCached(songId)?.isTrial;
      }
      if(generation!==this.nextMssGeneration||!this.stemSeparation.getSnapshot().enabled)return;
      this.stemSeparation.setNextTrack({songId,path:data.path,title:data.title,duration:data.duration||undefined,trial,quality});
    }catch{/* Next track failure must not interrupt current playback. */}
  }
  private activatePreparedMss(prepared:MssPreparedTrack){
    if(this.currentMssRequestId!==this.playRequestId||this.currentMssTrack?.songId!==prepared.songId||this.currentMssTrack.quality!==prepared.quality||this.stemSeparation.getSnapshot().cached||!this.stemSeparation.getSnapshot().enabled)return;
    const requestId=this.playRequestId,position=this.audio.currentTime;
    this.stemSeparation.setCachedSource(true);this.stemSeparation.reset();
    this.audio.crossOrigin='anonymous';this.audio.src=prepared.url;
    const restore=()=>{
      if(requestId!==this.playRequestId)return;
      this.audio.currentTime=Math.min(position,Math.max(0,this.audio.duration-.001));
      if(this.playbackIntent)void this.play().catch(()=>undefined);
    };
    this.audio.addEventListener('canplay',restore,{once:true});this.audio.load();
  }

  /**
   * Sets up audio element event listeners. Emits player events for time updates, playback end,
   * errors, etc. Uses bound handlers so they can be removed/re-added on Audio element swap.
   */
  private boundEnded = () => this.handleSongEnd();
  private boundTimeUpdate = () => this.emit('timeUpdate', this.audio.currentTime);
  private boundLoadedMetadata = () => this.emit('durationChange', this.audio.duration);
  private boundPlay = () => { this.stemSeparation.setPlaying(true); this.retroEffect?.setPlaying(true); this.emit('play'); };
  private boundPause = () => { this.stemSeparation.setPlaying(false); this.retroEffect?.setPlaying(false); this.emit('pause'); };
  private boundError = (e: Event) => {
    this.hasAudioError = true;
    // Error recovery may replace a failed cache URL with the original stereo URL.
    // Stop reading channels 3/4 before that fallback, or pure vocals become silence.
    if (this.stemSeparation.getSnapshot().cached) this.stemSeparation.setCachedSource(false);
    const errorInfo = this.audio.error
      ? { code: this.audio.error.code, message: this.audio.error.message }
      : { code: 'none', message: 'unknown' };
    const buffered = this.getBufferedInfo();
    console.log(`[AUDIO_ERROR] songId=${store.state.currentSongData?.songId} ` +
      `errorCode=${errorInfo.code} msg="${errorInfo.message}" ` +
      `cur=${Math.round(this.audio.currentTime)}s dur=${Math.round(this.audio.duration)}s ` +
      `readyState=${this.audio.readyState} networkState=${this.audio.networkState} ` +
      `buffered=${buffered}`);
    this.emit('error', e);
  };
  private boundStalled = () => {
    const buffered = this.getBufferedInfo();
    console.warn(`[AUDIO_STALLED] songId=${store.state.currentSongData?.songId} ` +
      `cur=${Math.round(this.audio.currentTime)}s dur=${Math.round(this.audio.duration)}s ` +
      `readyState=${this.audio.readyState} networkState=${this.audio.networkState} ` +
      `buffered=${buffered}`);
  };
  private boundWaiting = () => {
    const buffered = this.getBufferedInfo();
    console.warn(`[AUDIO_WAITING] songId=${store.state.currentSongData?.songId} ` +
      `cur=${Math.round(this.audio.currentTime)}s dur=${Math.round(this.audio.duration)}s ` +
      `readyState=${this.audio.readyState} networkState=${this.audio.networkState} ` +
      `buffered=${buffered}`);
  };
  private boundSeeking = () => { this.stemSeparation.reset(); this.emit('seeking'); };
  private boundEmptied = () => this.stemSeparation.reset();
  private boundSeeked = () => { this.stemSeparation.reset(); this.emit('seeked', this.audio.currentTime); };

  private setupAudioEventListeners() {
    this.audio.addEventListener('ended', this.boundEnded);
    this.audio.addEventListener('timeupdate', this.boundTimeUpdate);
    this.audio.addEventListener('loadedmetadata', this.boundLoadedMetadata);
    this.audio.addEventListener('play', this.boundPlay);
    this.audio.addEventListener('pause', this.boundPause);
    this.audio.addEventListener('error', this.boundError);
    this.audio.addEventListener('stalled', this.boundStalled);
    this.audio.addEventListener('waiting', this.boundWaiting);
    this.audio.addEventListener('seeking', this.boundSeeking);
    this.audio.addEventListener('seeked', this.boundSeeked);
    this.audio.addEventListener('emptied', this.boundEmptied);
  }

  /** Remove event listeners from the current audio element */
  private removeAudioEventListeners() {
    this.audio.removeEventListener('ended', this.boundEnded);
    this.audio.removeEventListener('timeupdate', this.boundTimeUpdate);
    this.audio.removeEventListener('loadedmetadata', this.boundLoadedMetadata);
    this.audio.removeEventListener('play', this.boundPlay);
    this.audio.removeEventListener('pause', this.boundPause);
    this.audio.removeEventListener('error', this.boundError);
    this.audio.removeEventListener('stalled', this.boundStalled);
    this.audio.removeEventListener('waiting', this.boundWaiting);
    this.audio.removeEventListener('seeking', this.boundSeeking);
    this.audio.removeEventListener('seeked', this.boundSeeked);
    this.audio.removeEventListener('emptied', this.boundEmptied);
  }

  /** 获取 buffered 范围字符串 */
  private getBufferedInfo(): string {
    try {
      const b = this.audio.buffered;
      if (!b || b.length === 0) return 'none';
      const ranges: string[] = [];
      for (let i = 0; i < b.length; i++) {
        ranges.push(`${Math.round(b.start(i))}-${Math.round(b.end(i))}s`);
      }
      return ranges.join(',');
    } catch { return 'error'; }
  }

  /**
   * Handles song end based on repeat mode. Automatically advances queue or repeats as configured.
   * Auto-resumes playback for the next song.
   */
  private async handleSongEnd() {

    const metaDuration = store.state.currentSongData?.duration || 0;
    const audioDuration = this.audio.duration;
    const duration = (metaDuration > 0 && isFinite(metaDuration) && !isNaN(metaDuration))
      ? metaDuration
      : (audioDuration > 0 && isFinite(audioDuration) && !isNaN(audioDuration))
        ? audioDuration
        : 0;
    const currentTime = this.audio.currentTime;
    const buffered = this.getBufferedInfo();

    const endBehavior = getPlaybackEndBehavior(this.isCurrentSourceTrial, currentTime, duration, this.repeatMode === 'one');
    if (endBehavior === 'recover') {
      this.falseEndCount++;
      // ★ 详细诊断日志
      const ae2 = this.audio;
      console.warn(
        `[ENDED_CHECK] FALSE_END ` +
        `songId=${store.state.currentSongData?.songId} ` +
        `cur=${Math.round(currentTime)}s dur=${Math.round(duration)}s ` +
        `metaDur=${metaDuration}s audioDur=${Math.round(audioDuration)}s ` +
        `paused=${ae2.paused} ` +
        `readyState=${ae2.readyState} networkState=${ae2.networkState} ` +
        `hasError=${this.hasAudioError} ` +
        `errorCode=${ae2.error?.code ?? 'none'} errorMsg="${ae2.error?.message ?? ''}" ` +
        `buffered=[${buffered}] ` +
        `falseEndCount=${this.falseEndCount}`
      );
      if (this.falseEndCount > 3) {
        console.log(`[ENDED_CHECK] too many false ends (error=${this.hasAudioError}), reloading audio`);
        this.falseEndCount = 0;
        this.hasAudioError = false;
        // 重新加载当前源而非直接放弃
        this.audio.load();
        try { await this.audio.play(); } catch { /* ignore */ }
        return;
      }
      console.log(`[ENDED_CHECK] false end cur=${Math.round(currentTime)} dur=${Math.round(duration)}`);
      const savedPos = currentTime;
      try { await this.audio.play(); } catch { /* ignore */ }
      this.audio.currentTime = savedPos;
      return;
    }
    this.falseEndCount = 0;

    console.log(`[AudioPlayer.handleSongEnd] repeat=${this.repeatMode}`);

    if (endBehavior === 'repeat') {
      this.audio.currentTime = 0;
      await this.play();
      this.emit('repeatOne');
      return;
    }

    if (this.queue.hasNext) {
      this.pendingAutoPlay = true;
      this.queue.moveToNext();
      // Song will be auto-loaded via positionChange event with autoPlay
    } else if (this.repeatMode === 'all' && this.queue.length > (this.isCurrentSourceTrial ? 1 : 0)) {
      this.pendingAutoPlay = true;
      this.queue.moveToPosition(0);
      this.emit('repeatAll');
      // Song will be auto-loaded via positionChange event with autoPlay
    } else {
      this.emit('playbackComplete');
    }
  }

  /** 从队列内存元数据拼 AudioPlayerData（NCM 在队歌曲，跳过 app/getSong IPC）。 */
  private buildSongDataFromMeta(meta: QueueSongMeta): AudioPlayerData {
    return {
      songId: meta.songId,
      title: meta.title,
        isVip: meta.isVip,
      duration: meta.duration,
      artists: meta.artists,
      album: meta.album,
      path: '',
      artworkPath: meta.artworkPath,
      isAFavorite: meta.songId < 0
        ? FavoriteService.isFavorite({ source: 'netease', sourceId: String(-meta.songId) })
        : FavoriteService.isFavorite({ source: 'local', sourceId: String(meta.songId) }),
      isKnownSource: meta.isKnownSource,
      isBlacklisted: meta.isBlacklisted,
    };
  }

  /**
   * Loads a song into the audio element. Fetches song data from API if songId is provided, or uses
   * provided songData. Sets up audio source and dispatches events.
   *
   * ★ PrefetchManager 单一 URL 路径（取代 AudioPrefetchManager + NcmPlaybackResolver 直调）：
   *   1. NCM URL 统一经 this.prefetchMgr.prefetch(songId, 'PLAY_NOW') —— 单飞去重 + 缓存命中即返回
   *   2. generation（this.playRequestId）守卫：resolve 完成后若已被更新的播放请求取代，
   *      直接返回 null，不触碰 audio.src / store —— 解决快速连点下旧请求干扰新歌曲的问题
   *   3. URL 在 load 前已缓存（prefetchHit）→ 不做 ?ts= cache-bust（浏览器缓存命中更快）
   *
   * NOTE: Does NOT swap Audio elements — `this.audio` reference remains stable
   * so that App.tsx hooks always reference the correct HTMLAudioElement.
   *
   * @param songIdOrData - The ID of the song to load or the song data object
   * @param options - Optional configuration for song loading
   * @returns Promise resolving to the song data, or null if superseded (stale load)
   */
  private async loadSong(
    songIdOrData: number | AudioPlayerData,
    options?: { autoPlay?: boolean; updateStore?: boolean; resumeTime?: number }
  ): Promise<AudioPlayerData | null> {
    this.currentSongLoadStart = performance.now();
    const requestId = ++this.playRequestId;
    ++this.nextMssGeneration;this.nextMssKey='';
    this.playbackIntent = !!options?.autoPlay;
    ++this.playbackActionId;
    this.stemSeparation.reset();
    const prefetchMgr = this.prefetchMgr;
    const trace = getPlayTrace();
    let isTrial = false;
    let wasCached = false; // NCM URL 在本 load 前已就绪（无需本次网络解析）
    let preparedMss:MssPreparedTrack|null=null;
    const mssQuality=this.mssQuality();

    // ★ 解析 songData：NCM 在队歌曲优先用逻辑队列内存元数据，跳过 app/getSong IPC
    let songData: AudioPlayerData = { songId: typeof songIdOrData === 'number' ? songIdOrData : songIdOrData.songId } as AudioPlayerData;
    try {
      if (typeof songIdOrData === 'number') {
        const meta = this.queue.getSongMetadata(songIdOrData);
        if (songIdOrData < 0 && meta) {
          songData = this.buildSongDataFromMeta(meta);
        } else {
          const fetched = await window.api.audioLibraryControls.getSong(songIdOrData);
          if (!fetched) throw new Error('歌曲元数据不存在');
          songData = fetched;
        }
      } else {
        songData = songIdOrData;
      }

      if (requestId !== this.playRequestId) return null;
      if (!songData) throw new Error('歌曲元数据不存在');
      console.log(`[NCM_PLAYER_LOAD] id=${songData.songId} autoPlay=${options?.autoPlay} requestId=${requestId}`);
      if(this.stemSeparation.getSnapshot().enabled){
        preparedMss=await this.stemSeparation.getPrepared(songData.songId,mssQuality,songData.songId>=0?songData.path:undefined).catch(()=>null);
        if(requestId!==this.playRequestId)return null;
      }

      // ★ NCM：URL 统一走 PrefetchManager
      if(preparedMss){songData={...songData,path:preparedMss.originalPath};isTrial=preparedMss.trial;wasCached=true;}
      else if (songData.songId < 0) {
        wasCached = !!prefetchMgr.getCached(songData.songId);
        trace?.log(wasCached ? 'urlCache=HIT' : 'urlCache=MISS');
        trace?.log('resolve start');
        trace?.start('resolve');
        const artistsStr = songData.artists?.map((a: { name: string }) => a.name).join(' / ') || '';
        const url = await prefetchMgr.prefetch(songData.songId, 'PLAY_NOW', {
          meta: {
            title: songData.title,
            artists: artistsStr,
            album: songData.album?.name,
            // ★ 原曲时长（秒→ms）传给 unlock 原版校验，拒绝加速版/DJ加长版
            durationMs: songData.duration ? songData.duration * 1000 : undefined,
          },
        });
        trace?.end('resolve');
        trace?.log('url_ready');

        // ★ generation 校验：已被更新的播放请求取代则丢弃
        if (requestId !== this.playRequestId) {
          console.log(`[PLAYER_STALE] load songId=${songData.songId} superseded — discarded`);
          return null;
        }
        if (!url) throw new Error('无法获取播放地址');
        // ★ VIP 歌曲解锁全失败 → 官方 30s 试听兜底：通知 UI 提示「会员歌曲」
        const trialRes = prefetchMgr.getCached(songData.songId);
        isTrial = !!trialRes?.isTrial;
        if (isTrial) {
          console.log(`[PLAYER_TRIAL] songId=${songData.songId} — VIP 30s 试听兜底`);
          document.dispatchEvent(
            new CustomEvent('player/trialStarted', { detail: { songId: songData.songId } })
          );
        }
        songData = { ...songData, path: url };
        window.api.ncm?.registerSong(songData).catch(() => {});
      } else if (!songData.path) {
        // 本地歌曲兜底（理论上 getSong 已带回 path）
        const sd = await window.api.audioLibraryControls.getSong(songData.songId);
        if (sd?.path) songData = { ...songData, path: sd.path };
      }

      if (requestId !== this.playRequestId) return null;
      if (!songData.path) throw new Error('歌曲播放路径不存在');
      // Update store with current song data if requested
      if (options?.updateStore !== false) {
        // NCM: refresh isAFavorite from unified store (registry entry is stale after toggle)
        if (songData.songId < 0) {
          songData.isAFavorite = FavoriteService.isFavorite({
            source: 'netease', sourceId: String(-songData.songId)
          });
        }
        dispatch({ type: 'CURRENT_SONG_DATA_CHANGE', data: songData });

        // Update localStorage
        storage.playback.setCurrentSongOptions('songId', songData.songId);
      }

      this.unavailableSourceCount = 0;
      this.isCurrentSourceTrial = isTrial;

      // Reset playback state for new song
      this.falseEndCount = 0;
      this.hasAudioError = false;
      (this as any).__logged30s = false;

      // ★ 打印 setUrl 前的 URL 和元数据
      const urlPreview = songData.path ? songData.path.slice(0, 120) : 'EMPTY';
      console.log(`[PLAYER_SET_URL] songId=${songData.songId} duration=${songData.duration}s ` +
        `url=${urlPreview} hasPath=${!!songData.path}`);

      // ★ 跨域媒体必须走匿名 CORS 模式，否则 WebAudio 图会静音输出（无声音的根因）。
      //   网易云 CDN 返回 Access-Control-Allow-Origin: *，故 crossOrigin='anonymous' 可行。
      //   本地文件（同源）不需要也不应设，避免自定义协议 CORS 校验失败。
      this.stemSeparation.setCachedSource(!!preparedMss);
      this.audio.crossOrigin = preparedMss||songData.songId < 0 ? 'anonymous' : '';

      // Set audio source — URL 在 load 前已缓存则不做 cache-bust（浏览器缓存命中）
      const isPrefetchedUrl = songData.songId < 0 && wasCached;
      if(preparedMss){this.audio.src=preparedMss.url;}
      else if (isPrefetchedUrl) {
        this.audio.src = songData.path as string;
      } else {
        // ★ cache-bust 分隔符按 URL 是否已有查询串选 ? / &：
        //   试听 URL 自带 ?vuutv=... 签名，若一律拼 ?ts= 会破坏签名 → 403。
        //   普通 NCM URL 无查询串，?ts= 正常追加。
        const sep = (songData.path as string).includes('?') ? '&' : '?';
        this.audio.src = `${songData.path}${sep}ts=${Date.now()}`;
      }
      trace?.log('audio_src_set');

      this.audio.load();
      this.currentMssRequestId=requestId;
      this.currentMssTrack={songId:songData.songId,path:songData.path,title:songData.title,duration:songData.duration||undefined,trial:isTrial,quality:mssQuality};
      this.stemSeparation.setCurrentTrack(this.currentMssTrack);
      void this.prepareNextMss();
      if (options?.resumeTime) {
        const restorePosition = () => {
          if (requestId === this.playRequestId) this.audio.currentTime = Math.min(options.resumeTime!, Math.max(0,this.audio.duration-.01));
        };
        this.audio.addEventListener('loadedmetadata',restorePosition,{once:true});
      }
      trace?.log('audio_load');

      // ★ 开始测量浏览器音频管线（src → canplay 真实延迟）
      trace?.start('canplay');

      const loadTime = Math.round(performance.now() - this.currentSongLoadStart);
      console.log(
        `[SWITCH] songId=${songData.songId} prefetchHit=${wasCached} loadTime=${loadTime}ms`
      );

      // Set up auto-play if requested
      if (this.playbackIntent) {
        // Check if audio is already ready to play (cached/buffered)
        if (this.audio.readyState >= 3) {
          // HAVE_FUTURE_DATA or HAVE_ENOUGH_DATA - ready to play
          trace?.start('play_called');
          this.play()
            .then(() => {
              trace?.end('play_called');
              trace?.done();
            })
            .catch((err) =>
              console.error('[AudioPlayer] Immediate auto-play failed:', err)
            );
        } else {
          // Wait for canplay event
          const autoPlayHandler = () => {
            // ★ 该 load 已过期则忽略（防止旧歌曲的 canplay 触发误播放）
            if (requestId !== this.playRequestId || !this.playbackIntent) {
              this.audio.removeEventListener('canplay', autoPlayHandler);
              return;
            }
            trace?.end('canplay');
            trace?.start('play_called');
            this.play()
              .then(() => {
                trace?.end('play_called');
                trace?.done();
              })
              .catch((err) =>
                console.error('[AudioPlayer] Auto-play on canplay failed:', err)
              );
            this.audio.removeEventListener('canplay', autoPlayHandler);
          };
          this.audio.addEventListener('canplay', autoPlayHandler);
        }
      }

      // Dispatch custom track change event
      const trackChangeEvent = new CustomEvent('player/trackchange', {
        detail: songData.songId
      });
      this.audio.dispatchEvent(trackChangeEvent);

      this.emit('songLoaded', songData);
      return songData;
    } catch (error) {
      console.error(
        `Failed to load song (ID: ${songData.songId}):`,
        error instanceof Error ? error.message : error
      );
      // A superseded resolver failure must never skip the user's newer selection.
      if (requestId !== this.playRequestId) return null;
      if (songData.songId < 0 && error instanceof Error && error.message === '无法获取播放地址') {
        this.unavailableSourceCount += 1;
        if (this.queue.currentSongId === songData.songId && this.queue.hasNext && this.unavailableSourceCount < 3) {
          this.audio.pause();
          this.pendingAutoPlay = true;
          this.queue.moveToNext();
          return null;
        }
      }
      this.emit('loadError', { songId: songData.songId, error });
      // ★ 让失败可见：手动点击 / auto-skip 任一失败路径都派发，UI 按 id 去重展示通知
      //   （此前无任何 UI 反馈，网络失败时用户只看到"点了没反应"）
      document.dispatchEvent(
        new CustomEvent('player/loadFailed', {
          detail: {
            songId: songData.songId,
            error: error instanceof Error ? error.message : String(error),
          },
        })
      );
      throw error; // Re-throw for caller to handle
    }
  }

  /** Cleans up resources and event listeners. Should be called when player is no longer needed. */
  destroy() {
    ++this.nextMssGeneration;
    ++this.playRequestId;
    ++this.playbackActionId;
    this.playbackIntent = false;
    if (this.unsubscribeFunc) this.unsubscribeFunc.unsubscribe();
    this.queue.removeAllListeners();
    this.removeAllListeners();
    this.removeAudioEventListeners();
    this.audio.pause();
    this.audio.src = '';
    this.stemSeparation.destroy();
    this.retroEffect?.dispose();
    this.currentContext.close();
    this.prefetchMgr.clear();
  }

  /**
   * Subscribe to an event.
   *
   * @param eventType - The type of event to listen for
   * @param callback - Function to call when event is emitted
   */
  on<T = unknown>(eventType: PlayerEventType, callback: PlayerEventCallback<T>): void {
    if (!this.listeners.has(eventType)) {
      this.listeners.set(eventType, new Set());
    }
    this.listeners.get(eventType)?.add(callback as PlayerEventCallback<unknown>);
  }

  /**
   * Remove an event listener.
   *
   * @param eventType - The type of event
   * @param callback - The callback to remove
   */
  off<T = unknown>(eventType: PlayerEventType, callback: PlayerEventCallback<T>): void {
    this.listeners.get(eventType)?.delete(callback as PlayerEventCallback<unknown>);
  }

  /**
   * Emit an event to all listeners.
   *
   * @param eventType - The type of event to emit
   * @param data - The data to pass to listeners
   */
  protected emit<T = unknown>(eventType: PlayerEventType, data?: T): void {
    const callbacks = this.listeners.get(eventType);
    if (callbacks) {
      callbacks.forEach((callback) => {
        callback(data);
      });
    }
  }

  /** Remove all listeners for all events. */
  removeAllListeners(): void {
    this.listeners.clear();
  }

  private fadeOutAudio(): Promise<void> {
    return new Promise((resolve) => {
      const actionId = this.playbackActionId;
      const currentTime = this.currentContext.currentTime;
      this.gainNode.gain.cancelScheduledValues(currentTime);
      const targetVolume = 0.001; // Very low but not zero to avoid clicks
      const fadeDuration = AUDIO_FADE_DURATION / 1000; // Convert to seconds

      this.gainNode.gain.setValueAtTime(this.gainNode.gain.value, currentTime);
      this.gainNode.gain.exponentialRampToValueAtTime(targetVolume, currentTime + fadeDuration);

      // Schedule pause after fade completes
      setTimeout(() => {
        if (actionId === this.playbackActionId) this.audio.pause();
        resolve(undefined);
      }, AUDIO_FADE_DURATION);
    });
  }

  private fadeInAudio(): Promise<void> {
    return new Promise((resolve) => {
      const currentTime = this.currentContext.currentTime;
      this.gainNode.gain.cancelScheduledValues(currentTime);
      const targetVolume = Math.max(this.currentVolume / 100, 0.001);
      const fadeDuration = AUDIO_FADE_DURATION / 1000; // Convert to seconds

      this.gainNode.gain.setValueAtTime(this.gainNode.gain.value, currentTime);
      this.gainNode.gain.exponentialRampToValueAtTime(targetVolume, currentTime + fadeDuration);

      // Resolve after fade completes
      setTimeout(() => {
        resolve(undefined);
      }, AUDIO_FADE_DURATION);
    });
  }

  private initializeEqualizer() {
    for (const [filterName, hertzValue] of Object.entries(equalizerBandHertzData)) {
      const equalizerFilterName = filterName as EqualizerBandFilters;
      const equalizerBand = this.currentContext.createBiquadFilter();

      equalizerBand.type = 'peaking';
      equalizerBand.frequency.value = hertzValue;
      equalizerBand.Q.value = 1;
      equalizerBand.gain.value = 0;

      this.equalizerBands.set(equalizerFilterName, equalizerBand);
    }

    // Connect filter chain: filter0 → filter1 → ... → filterN
    const filterMapKeys = [...this.equalizerBands.keys()];
    for (let i = 0; i < filterMapKeys.length - 1; i++) {
      const current = this.equalizerBands.get(filterMapKeys[i])!;
      const next = this.equalizerBands.get(filterMapKeys[i + 1])!;
      current.connect(next);
    }

    // Last filter → gainNode
    const lastKey = filterMapKeys[filterMapKeys.length - 1];
    const lastFilter = this.equalizerBands.get(lastKey);
    if (lastFilter) lastFilter.connect(this.gainNode);

    // Connect gain node to destination
    this.gainNode.connect(this.currentContext.destination);

    // Connect audio source to first filter
    this.connectAudioSource(this.audio);
  }

  /** Apply EQ gains to the live audio graph and route optional Tone.js effects. */
  setSoundEffects(enabled: boolean, mode: SpecialEffectMode, gains: number[]): void {
    const bands = [...this.equalizerBands.values()];
    bands.forEach((band, index) => {
      const gain = enabled ? Math.max(-12, Math.min(12, gains[index] ?? 0)) : 0;
      band.gain.setTargetAtTime(gain, this.currentContext.currentTime, 0.015);
    });

    const nextMode = enabled ? mode : 'none';
    if (nextMode === this.effectMode) return;
    const lastFilter = bands.at(-1);
    if (!lastFilter) return;
    lastFilter.disconnect();
    if (this.rotationTimer) clearInterval(this.rotationTimer);
    this.rotationTimer = null;
    this.compressor?.dispose();
    this.reverb?.dispose();
    this.panner3d?.dispose();
    this.widener?.dispose();
    this.chorus?.dispose();
    this.phaser?.dispose();
    this.retroEffect?.dispose();
    this.retroEffect = null;
    this.compressor = null;
    this.reverb = null;
    this.panner3d = null;
    this.widener = null;
    this.chorus = null;
    this.phaser = null;

    if (isRetroEffect(nextMode)) {
      this.retroEffect = new RetroSoundEffect(this.currentContext, nextMode);
      lastFilter.connect(this.retroEffect.input);
      this.retroEffect.output.connect(this.gainNode);
      this.retroEffect.setPlaying(!this.audio.paused);
    } else if (nextMode === 'studio') {
      this.toneContext ??= new ToneContext(this.currentContext);
      this.compressor = new Compressor({
        context: this.toneContext,
        threshold: -22,
        ratio: 2.5,
        attack: 0.01,
        release: 0.2,
        knee: 12
      });
      toneConnect(lastFilter, this.compressor);
      this.compressor.connect(this.gainNode);
    } else if (nextMode === 'spatial') {
      this.toneContext ??= new ToneContext(this.currentContext);
      this.reverb = new Reverb({
        context: this.toneContext,
        decay: 1.5,
        preDelay: 0.02,
        wet: 0.16
      });
      void this.reverb.ready.catch((error) => console.error('Failed to prepare spatial effect', error));
      toneConnect(lastFilter, this.reverb);
      this.reverb.connect(this.gainNode);
    } else if (nextMode === 'rotate3d') {
      this.toneContext ??= new ToneContext(this.currentContext);
      this.panner3d = new Panner3D({
        context: this.toneContext,
        panningModel: 'HRTF',
        distanceModel: 'linear',
        refDistance: 1,
        maxDistance: 2,
        rolloffFactor: 0,
        positionX: 0,
        positionY: 0,
        positionZ: -1.2
      });
      toneConnect(lastFilter, this.panner3d);
      this.panner3d.connect(this.gainNode);
      const startedAt = performance.now();
      this.rotationTimer = setInterval(() => {
        const angle = (performance.now() - startedAt) * (Math.PI * 2 / 8000);
        this.panner3d?.setPosition(1.2 * Math.sin(angle), 0, -1.2 * Math.cos(angle));
      }, 40);
    } else if (nextMode === 'wide') {
      this.toneContext ??= new ToneContext(this.currentContext);
      this.widener = new StereoWidener({ context: this.toneContext, width: 0.8 });
      toneConnect(lastFilter, this.widener);
      this.widener.connect(this.gainNode);
    } else if (nextMode === 'chorus') {
      this.toneContext ??= new ToneContext(this.currentContext);
      this.chorus = new Chorus({
        context: this.toneContext, frequency: 0.8, delayTime: 3.5, depth: 0.45, wet: 0.3
      }).start();
      toneConnect(lastFilter, this.chorus);
      this.chorus.connect(this.gainNode);
    } else if (nextMode === 'phaser') {
      this.toneContext ??= new ToneContext(this.currentContext);
      this.phaser = new Phaser({
        context: this.toneContext, frequency: 0.35, octaves: 3, baseFrequency: 400, wet: 0.3
      });
      toneConnect(lastFilter, this.phaser);
      this.phaser.connect(this.gainNode);
    } else {
      lastFilter.connect(this.gainNode);
    }
    this.effectMode = nextMode;
  }

  /**
   * Connects the Audio element to the equalizer chain.
   * Called once during initialization. The Audio element reference
   * stays stable — never swapped.
   */
  private connectAudioSource(audioElement: HTMLAudioElement): void {
    if (this.mediaSource) {
      try { this.mediaSource.disconnect(); } catch { /* already disconnected */ }
      this.mediaSource = null;
    }

    this.mediaSource = this.currentContext.createMediaElementSource(audioElement);

    // Connect to first filter
    const firstKey = [...this.equalizerBands.keys()][0];
    const firstFilter = this.equalizerBands.get(firstKey);
    if (firstFilter) {
      this.stemSeparation.attach(this.mediaSource, firstFilter);
    } else {
      this.stemSeparation.attach(this.mediaSource, this.gainNode);
    }
  }

  // ? PLAYER RELATED STORE UPDATES HANDLING
  private updatePlayerVolume(volume: PlayerVolume) {
    this.volume = volume.value / 100;
    this.audio.muted = volume.isMuted;
  }

  private updatePlaybackRate(playbackRate: number) {
    if (this.audio.playbackRate !== playbackRate) {
      this.audio.playbackRate = playbackRate;
    }
  }

  private subscribeToStoreEvents() {
    const unsubscribeFunction = store.subscribe(() => {
      if (store) {
        const { player } = store.state;

        this.updatePlayerVolume(player.volume);
        this.updatePlaybackRate(player.playbackRate);
        this.syncRepeatModeFromStore(player.isRepeating);
        if(this.nextMssKey&&!this.nextMssKey.endsWith(`:${this.mssQuality()}`))void this.prepareNextMss();
      }
    });

    return unsubscribeFunction;
  }

  private syncRepeatModeFromStore(isRepeating: RepeatTypes) {
    // Convert store's RepeatTypes to AudioPlayer's repeat mode format
    const newMode = isRepeating === 'repeat-1' ? 'one' : isRepeating === 'repeat' ? 'all' : 'off';
    if (this.repeatMode !== newMode) {
      this.repeatMode = newMode;
    }
  }

  // ========== PUBLIC PLAYBACK CONTROLS ==========

  /** Starts or resumes audio playback with fade-in effect. */
  async play() {
    this.playbackIntent = true;
    const actionId = ++this.playbackActionId;
    if (actionId !== this.playbackActionId || !this.playbackIntent) return;
    await this.audio.play();
    if (actionId !== this.playbackActionId) return;
    return this.fadeInAudio();
  }

  /** Pauses audio playback with fade-out effect. */
  pause() {
    this.playbackIntent = false;
    ++this.playbackActionId;
    return this.fadeOutAudio();
  }

  /**
   * Toggles playback between play and pause.
   *
   * @param forcePlay - If true, always play; if false, always pause; if undefined, toggle
   * @returns Promise that resolves when fade completes
   */
  async togglePlayback(forcePlay?: boolean): Promise<void> {
    const shouldPlay = forcePlay !== undefined ? forcePlay : this.audio.paused;

    if (shouldPlay) {
      if (this.audio.readyState > 0) {
        await this.play();
      }
    } else {
      await this.pause();
    }
  }

  /**
   * Seeks to a specific time position in the current song.
   *
   * @param time - Time in seconds to seek to
   */
  seek(time: number) {
    this.audio.currentTime = time;
  }

  /**
   * Loads and optionally plays a song by ID. This is the public API for loading songs - handles
   * store updates, localStorage, and analytics.
   *
   * @param songId - The ID of the song to load
   * @param options - Configuration options
   * @returns Promise that resolves when song is loaded and optionally playing
   */
  async playSongById(
    songId: number,
    options: {
      autoPlay?: boolean;
      recordListening?: boolean;
      onError?: (error: unknown) => void;
    } = {}
  ): Promise<void> {
    const { autoPlay = true, recordListening = true, onError } = options;

    try {
      console.log(`[NCM_PLAYER_LOAD] playSongById id=${songId} autoPlay=${autoPlay}`);

      // ★ Sync queue position BEFORE loading — ensures prev/next work correctly
      const queueIndex = this.queue.moveToSong(songId);
      if (queueIndex >= 0) {
        console.log(`[PLAYER_SYNC] queue position synced to ${queueIndex} for song ${songId}`);
      }

      // ★ 创建播放耗时追踪
      const trace = createPlayTrace();

      // Start the request generation before any asynchronous metadata fetch.
      const loaded = await this.loadSong(songId, { autoPlay, updateStore: true });
      // ★ loadSong 返回 null = 已被更新的播放请求取代（不记录、不校验）
      if (!loaded) {
        console.log(`[PLAYER_SKIP] playSongById songId=${songId} superseded — skip recordListening`);
        return;
      }

      // ★ Verify consistency after load
      const posSongId = this.queue.songIds[this.queue.position];
      console.log('[PLAYER_CONSISTENCY]', {
        playedSongId: songId,
        currentIndex: this.queue.position,
        queueSongId: posSongId,
        match: songId === posSongId
      });

      // Record listening data if requested
      if (recordListening) {
        // Note: Listening data recording will be handled by the hook until fully migrated
        this.emit('recordListening', { songId, duration: loaded.duration });
      }

      // ★ 更新预取窗口（moveToSong 不触发 positionChange，这里补齐 next/next+1）
      this.prefetchMgr.prefetchAround(this.queue.position, this.queue);
    } catch (error) {
      if (onError) {
        onError(error);
      } else {
        throw error;
      }
    }
  }

  // ========== QUEUE NAVIGATION ==========

  /**
   * Skips forward to the next song in the queue. Handles repeat modes and automatically loads/plays
   * the next song.
   *
   * @param reason - Why the skip occurred ('USER_SKIP' or 'PLAYER_SKIP')
   */
  async skipForward(reason: SongSkipReason = 'USER_SKIP'): Promise<void> {

    // Handle repeat-one mode (only auto-repeat, not on user skip)
    if (this.repeatMode === 'one' && reason !== 'USER_SKIP') {
      this.audio.currentTime = 0;
      await this.play();

      // Emit event for listening data recording (repetition)
      if (store.state.currentSongData?.songId) {
        this.emit('repeatSong', {
          songId: store.state.currentSongData.songId,
          duration: store.state.currentSongData.duration
        });
      }
      return;
    }

    // Move to next song or restart queue if repeat-all
    if (this.queue.hasNext) {
      this.pendingAutoPlay = true; // Auto-play next song on manual skip
      this.queue.moveToNext();
    } else if (this.repeatMode === 'all' && this.queue.length > (this.isCurrentSourceTrial ? 1 : 0)) {
      this.pendingAutoPlay = true; // Auto-play when restarting queue
      this.queue.moveToStart();
    }
    // else: at end without repeat, do nothing (song ends)
  }

  /** Switches to the previous song without restarting the current song. */
  skipBackward(): void {
    if (this.queue.hasPrevious) {
      this.pendingAutoPlay = true;
      this.queue.moveToPrevious();
    } else if (this.queue.currentSongId === null && this.queue.length > 0) {
      this.pendingAutoPlay = true;
      this.queue.moveToStart();
    }
  }

  /**
   * Plays the next song in the queue. Delegates to queue's moveToNext() which triggers song
   * loading.
   *
   * @deprecated Use skipForward() instead for better control
   */
  playNext() {
    if (this.queue.hasNext) {
      this.queue.moveToNext();
    }
  }

  /**
   * Plays the previous song in the queue. Delegates to queue's moveToPrevious() which triggers song
   * loading.
   *
   * @deprecated Use skipBackward() instead for better control
   */
  playPrevious() {
    if (this.queue.hasPrevious) {
      this.queue.moveToPrevious();
    }
  }

  /**
   * Plays a song at a specific position in the queue.
   *
   * @param position - The queue position (0-indexed)
   */
  playSongAtPosition(position: number) {
    this.pendingAutoPlay = true; // Auto-play when manually selecting a position
    const moved = this.queue.moveToPosition(position);
    if (!moved) {
      console.error('[AudioPlayer.playSongAtPosition] Failed to move to position:', position);
    }
    // Song will be auto-loaded via queue's positionChange event
  }

  // ========== REPEAT MODE MANAGEMENT ==========

  /**
   * Sets the repeat mode.
   *
   * @param mode - 'off' | 'one' | 'all'
   */
  setRepeatMode(mode: 'off' | 'one' | 'all') {
    this.repeatMode = mode;
    this.emit('repeatModeChange', mode);
  }

  /** Gets the current repeat mode. */
  getRepeatMode(): 'off' | 'one' | 'all' {
    return this.repeatMode;
  }

  // ========== GETTERS FOR CURRENT STATE ==========

  /** Gets the current song ID from the queue. */
  get currentSongId(): number | null {
    return this.queue.currentSongId;
  }

  /** Gets the current playback time in seconds. */
  get currentTime(): number {
    return this.audio.currentTime;
  }

  /** Sets the current playback time in seconds. */
  set currentTime(time: number) {
    this.audio.currentTime = time;
  }

  /** Gets the duration of the current song in seconds. */
  get duration(): number {
    return this.audio.duration;
  }

  /** Gets whether the audio is currently paused. */
  get paused(): boolean {
    return this.audio.paused;
  }

  /** Gets the current volume (0-1). */
  get volume(): number {
    return this.currentVolume / 100;
  }

  /** Sets the volume (0-1). */
  set volume(volume: number) {
    this.currentVolume = volume * 100;
    this.audio.volume = volume;
    this.gainNode.gain.value = volume;
  }

  /** Gets the muted state. */
  get muted(): boolean {
    return this.audio.muted;
  }

  /** Sets the muted state. */
  set muted(value: boolean) {
    this.audio.muted = value;
    this.gainNode.gain.value = value ? 0 : this.volume;
  }

  /** Gets the current playback rate. */
  get playbackRate(): number {
    return this.audio.playbackRate;
  }

  /** Sets the playback rate. */
  set playbackRate(value: number) {
    this.audio.playbackRate = value;
  }
}

export default AudioPlayer;
