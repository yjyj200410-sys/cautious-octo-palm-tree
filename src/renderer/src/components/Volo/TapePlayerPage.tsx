import './perspective-lyrics.css';
import { useStore } from '@tanstack/react-store';
import { memo, useContext, useEffect, useState, useRef, useSyncExternalStore, type CSSProperties } from 'react';

import { AppUpdateContext } from '../../contexts/AppUpdateContext';
import { LyricsStore, type LyricsState } from '../../hooks/LyricsStore';
import { useAudioPlayer } from '../../hooks/useAudioPlayer';
import { store } from '../../store/store';
import ManagementDialog from '../ManagementDialog';
import { Icon, Key, QueuePanel } from './PlaybackControls';
import { mixToStemBalance, stemBalanceMix } from './stemBalance';

function DownloadPanel() {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('选择音轨，保存为 WAV 音频');
  return (
    <div className="deck-extra">
      <div className="extra-heading">
        <strong>下载当前音乐</strong>
        <span role="status">{message}</span>
      </div>
      {(['original', 'vocals', 'accompaniment'] as const).map((kind) => (
        <button
          key={kind}
          className="plain-button"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setMessage('正在准备下载…');
            try {
              const saved = await window.api.stemSeparation.exportTrack(kind);
              setMessage(saved ? '已保存' : '已取消');
            } catch (error) {
              setMessage(error instanceof Error ? error.message : '下载失败');
            } finally {
              setBusy(false);
            }
          }}
        >
          {kind === 'original' ? '原声' : kind === 'vocals' ? '人声' : '伴奏'}
        </button>
      ))}
    </div>
  );
}

function useTapeLyrics() {
  const [lyrics, setLyrics] = useState<LyricsState>(LyricsStore.getState);
  useEffect(() => {
    LyricsStore.start();
    const unsubscribe = LyricsStore.subscribe((next) => {
      if (document.hidden) return;
      setLyrics((old) =>
        old.songId === next.songId && old.index === next.index && old.lines === next.lines
          ? old
          : next
      );
    });
    return () => {
      unsubscribe();
      LyricsStore.stop();
    };
  }, []);
  return lyrics;
}

const AlbumArtwork = memo(function AlbumArtwork() {
  const song = useStore(store, (state) => state.currentSongData);
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [song.artworkPath]);
  return (
    <div className="album-artwork">
      {song.artworkPath && !failed ? (
        <img
          src={song.artworkPath}
          alt={`${song.title} 专辑封面`}
          onError={() => setFailed(true)}
        />
      ) : (
        <div className="artwork-placeholder">
          <Icon name="graphic_eq" />
          <span>
            vo<span>lo</span>
          </span>
          <small>YOUR DAILY SOUND</small>
        </div>
      )}
    </div>
  );
});

function StemFader() {
  const songId = useStore(store, (s) => s.currentSongData.songId);
  const { stemSeparation: stem } = useAudioPlayer();
  const state = useSyncExternalStore(stem.subscribe, stem.getSnapshot);
  const balance = mixToStemBalance(state.vocals, state.accompaniment);
  const status =
    state.error ||
    state.cacheError ||
    (state.loading
      ? '分轨准备中…'
      : state.enabled
        ? state.currentPreparing
          ? `准备当前歌曲 ${state.currentProgress}%`
          : '分轨已开启'
        : '分轨已关闭');
  return (
    <div className="machine-fader stem-fader">
      <div className="fader-caption">
        <span>分轨</span>
        <button
          className={`stem-power ${state.enabled ? 'enabled' : ''}`}
          title={status}
          aria-label={state.enabled ? '关闭分轨' : '开启分轨'}
          aria-pressed={state.enabled}
          disabled={!songId || state.loading}
          onClick={() => void stem.setEnabled(!state.enabled)}
        >
          <Icon name="power_settings_new" />
        </button>
      </div>
      <input
        type="range"
        min="-100"
        max="100"
        step="1"
        value={balance}
        disabled={!state.enabled || state.loading}
        aria-label="分轨混音"
        title="向左偏人声，向右偏伴奏"
        aria-valuetext={
          balance === -100
            ? '纯人声'
            : balance === 100
              ? '纯伴奏'
              : balance === 0
                ? '人声与伴奏混合'
                : balance < 0
                  ? `偏人声 ${-balance}%`
                  : `偏伴奏 ${balance}%`
        }
        onChange={(e) => {
          const mix = stemBalanceMix(Number(e.target.value));
          stem.setMix(mix.vocals, mix.accompaniment);
        }}
      />
      <span
        className={`fader-status ${state.error || state.cacheError || state.loading || state.currentPreparing ? '' : 'sr-only'}`}
        role="status"
      >
        {status}
      </span>
    </div>
  );
}

function VolumeFader() {
  const volume = useStore(store, (s) => s.player.volume);
  const c = useContext(AppUpdateContext);
  return (
    <div className="machine-fader volume-fader">
      <div className="fader-caption">
        <span>音量</span>
        <button
          className="stem-power"
          aria-label={volume.isMuted ? '取消静音' : '静音'}
          aria-pressed={volume.isMuted}
          title={volume.isMuted ? '取消静音' : '静音'}
          onClick={() => c.toggleMutedState()}
        >
          <Icon name={volume.isMuted ? 'volume_off' : 'volume_up'} />
        </button>
      </div>
      <input
        type="range"
        min="0"
        max="100"
        value={volume.value}
        aria-label="音量"
        onChange={(e) => c.updateVolume(Number(e.target.value))}
      />
    </div>
  );
}

type PlayerIconName = 'play' | 'pause' | 'prev' | 'next' | 'chevron' | 'heart';
function PlayerIcon({ name }: { name: PlayerIconName }) {
  const paths = { play:'m9 5 11 7-11 7z', pause:'M8 5v14M16 5v14', prev:'M5 5v14m14-14L8 12l11 7z', next:'M19 5v14M5 5l11 7L5 19z', chevron:'m6 9 6 6 6-6', heart:'M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z' };
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d={paths[name]} /></svg>;
}
function PaperTimeline() {
  const player = useAudioPlayer();
  const duration = useStore(store, s => s.currentSongData.duration) || 0;
  const { updateSongPosition } = useContext(AppUpdateContext);
  const [position, setPosition] = useState(player.currentTime || 0);
  const dragging = useRef(false);
  const valueRef = useRef(position);
  useEffect(() => {
    const sync = () => { if (!dragging.current) setPosition(player.currentTime || 0); };
    for (const event of ['timeupdate', 'seeked', 'loadedmetadata', 'emptied']) player.audio.addEventListener(event, sync);
    return () => { for (const event of ['timeupdate', 'seeked', 'loadedmetadata', 'emptied']) player.audio.removeEventListener(event, sync); };
  }, [player]);
  const fmt = (n: number) => `${Math.floor(n / 60)}:${String(Math.floor(n % 60)).padStart(2,'0')}`;
  return <div className="player-timeline"><div className="paper-seek"><span className="paper-seek-rail" aria-hidden="true"><span style={{width:`${duration ? position / duration * 100 : 0}%`}} /></span><input id="seekRange" type="range" min="0" max={duration || 1} value={Math.min(position, duration || 1)} step="0.1" disabled={!duration} aria-label="播放进度" style={{'--seek':`${duration ? position / duration * 100 : 0}%`} as CSSProperties}
    onPointerDown={e => { dragging.current=true; valueRef.current=position; e.currentTarget.setPointerCapture(e.pointerId); }}
    onChange={e => { const next=Number(e.target.value); valueRef.current=next; setPosition(next); if (!dragging.current) updateSongPosition(next); }}
    onPointerUp={() => { if (dragging.current) { dragging.current=false; updateSongPosition(valueRef.current); } }}
    onPointerCancel={() => { dragging.current=false; setPosition(player.currentTime || 0); }} />
    </div><div className="timestamps"><span>{fmt(position)}</span><span>{fmt(duration)}</span></div></div>;
}

export default function TapePlayerPage({ onClose }: { onClose: () => void }) {
  const song = useStore(store, s => s.currentSongData);
  const playing = useStore(store, s => s.player.isCurrentSongPlaying);
  const shuffle = useStore(store, s => s.player.isShuffling);
  const repeat = useStore(store, s => s.player.isRepeating);
  const c = useContext(AppUpdateContext);
  const lyrics = useTapeLyrics();
  const [showLyrics, setShowLyrics] = useState(true);
  const [panel, setPanel] = useState<'lyrics' | 'queue' | 'download' | 'options' | null>(null);
  const pageRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const closing = useRef(false);
  const close = () => {
    if (closing.current) return;
    closing.current = true;
    if (matchMedia('(prefers-reduced-motion: reduce)').matches || !pageRef.current) { onClose(); return; }
    const animation = pageRef.current.animate([{ opacity:1, transform:pageRef.current.style.transform || 'translateY(0)' }, { opacity:0, transform:'translateY(35px)' }], { duration:300, easing:'cubic-bezier(.16,1,.3,1)', fill:'forwards' });
    void animation.finished.then(onClose, onClose);
  };
  useEffect(() => { closeRef.current?.focus({preventScroll:true}); }, []);
  useEffect(() => { const open = () => setPanel('queue'); window.addEventListener('open-queue-popup',open); return () => window.removeEventListener('open-queue-popup',open); }, []);
  return <><div className="player-native-drag" aria-hidden="true" /><section ref={pageRef} className="player-page open" id="playerPage" role="dialog" aria-modal="true" aria-label="播放页面" aria-hidden="false"
    onContextMenu={e => {e.preventDefault(); e.stopPropagation(); setPanel('options');}}
    onKeyDown={e => {
      if (panel) return;
      if (e.key==='Escape') {e.stopPropagation(); close();}
      if (e.shiftKey && e.key==='F10') {e.preventDefault(); setPanel('options');}
      if (e.key==='Tab') {
        const nodes=pageRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled)');
        const first=nodes?.[0], last=nodes?.[nodes.length-1];
        if (e.shiftKey && document.activeElement===first) {e.preventDefault(); last?.focus();}
        else if (!e.shiftKey && document.activeElement===last) {e.preventDefault(); first?.focus();}
      }
    }}>
    <div className="atmosphere" key={song.artworkPath} aria-hidden="true">{song.artworkPath && <img src={song.artworkPath} alt="" />}</div>
    <div className="atmosphere-shade" />
    <div className="player-top" id="playerDrag"><button ref={closeRef} className="icon-button" id="closePlayer" aria-label="收起播放页" onClick={close}><PlayerIcon name="chevron" /></button><span>此刻，只有音乐</span><span className="player-brand">volo.</span></div>
    <div className="player-inner">
      <div className={`hero-wrap${showLyrics ? " hero-wrap--lyrics" : ""}`} id="heroWrap" title="右键打开播放选项">{showLyrics ? (<section className="perspective-lyrics" aria-label="同步轮播歌词">
        {lyrics.songId === song.songId && lyrics.lines.length ? lyrics.lines.map((line, index) => {
          const distance = index - Math.max(0, lyrics.index);
          if (Math.abs(distance) > 4) return null;
          return <button key={`${song.songId}-${index}`} className="perspective-lyric"
            aria-current={index === lyrics.index ? 'true' : undefined}
            tabIndex={Math.abs(distance) <= 1 ? 0 : -1}
            style={{ transform: `translateY(calc(-50% + ${distance * 58}px)) translateZ(${-Math.abs(distance) * 95}px) rotateX(${distance === 0 ? 0 : 24}deg)`, opacity: Math.max(0, 1 - Math.abs(distance) * .23), zIndex: 5 - Math.abs(distance) }}
            onClick={() => c.updateSongPosition(line.start)}>
            <span>{line.text || '♪'}</span>{line.secondaryText && <small>{line.secondaryText}</small>}
          </button>;
        }) : <p className="perspective-lyrics-empty">{song.songId ? '暂无歌词，静静听音乐' : '选择一首音乐'}</p>}
      </section>) : <div className="hero-disc" id="heroDisc" key={song.songId}><AlbumArtwork /></div>}</div>
      <div className="player-info" id="playerInfo" key={`info-${song.songId}`}><h2 id="playerTitle" title={song.title}>{song.title || '从一首好音乐开始'}</h2><p id="playerArtist">{song.artists?.map(a => a.name).join(' / ') || '在曲库中选择音乐'}{song.album?.name ? `  /  ${song.album.name}` : ''}</p></div>
      <PaperTimeline />
      <div className="player-controls"><button className="icon-button" aria-label="上一首" disabled={!song.songId} onClick={c.handleSkipBackwardClick}><PlayerIcon name="prev" /></button><button className="icon-button player-play" aria-label={playing ? '暂停' : '播放'} disabled={!song.songId} onClick={() => c.toggleSongPlayback()}><PlayerIcon name={playing ? 'pause' : 'play'} /></button><button className="icon-button" aria-label="下一首" disabled={!song.songId} onClick={() => c.handleSkipForwardClick('USER_SKIP')}><PlayerIcon name="next" /></button></div>
      <section className="player-tools" aria-label="播放功能">
        <button className={shuffle ? 'active' : ''} aria-label="随机播放" aria-pressed={shuffle} onClick={() => c.toggleShuffling()}><Icon name="shuffle" /><span>随机</span></button>
        <button className={repeat!=='false' ? 'active' : ''} aria-label={`循环模式：${repeat==='repeat-1' ? '单曲' : repeat==='repeat' ? '列表' : '关闭'}`} aria-pressed={repeat!=='false'} onClick={() => c.toggleRepeat()}><Icon name={repeat==='repeat-1' ? 'repeat_one' : 'repeat'} /><span>{repeat==='repeat-1' ? '单曲' : '循环'}</span></button>
        <button aria-label="下载当前音乐" disabled={!song.songId} onClick={() => setPanel('download')}><Icon name="download" /><span>下载</span></button>
        <button aria-label={showLyrics ? "显示封面" : "显示透视歌词"} aria-pressed={showLyrics} onClick={() => setShowLyrics(value => !value)}><Icon name="notes" /><span>{showLyrics ? "封面" : "歌词"}</span></button>
        <button aria-label="队列" onClick={() => setPanel('queue')}><Icon name="queue_music" /><span>队列</span></button>
      </section>
      <section className="player-faders" aria-label="分轨与音量"><StemFader /><VolumeFader /></section>
      <div className="player-bottom"><span className="listening-mark"><i /><span>{playing ? '声音在流动' : '让时间慢下来'}</span></span><button className="icon-button favorite-button" aria-label={song.isAFavorite ? '取消收藏当前歌曲' : '收藏当前歌曲'} aria-pressed={song.isAFavorite} disabled={!song.songId} onClick={() => c.toggleIsFavorite(!song.isAFavorite)}><PlayerIcon name="heart" /></button></div>
    </div>
    {panel && <ManagementDialog open label={panel==='options' ? '播放选项' : panel==='lyrics' ? '完整歌词' : panel==='queue' ? '播放队列' : '下载音乐'} onClose={() => setPanel(null)} className="volo-modal tape-detail-dialog">
      <div className="modal-heading"><h2>{panel==='options' ? '播放选项' : panel==='lyrics' ? '完整歌词' : panel==='queue' ? '播放队列' : '下载音乐'}</h2><Key label="关闭" icon="close" onClick={() => setPanel(null)} /></div>
      <div className="modal-body">{panel==='options' ? <div className="paper-playback-options"><div className="paper-option-buttons"><Key label="完整歌词" icon="notes" onClick={() => setPanel('lyrics')} /><Key label="队列" icon="queue_music" onClick={() => setPanel('queue')} /><Key label="下载当前音乐" icon="download" onClick={() => setPanel('download')} /><Key label="随机播放" icon="shuffle" active={shuffle} onClick={() => c.toggleShuffling()} /><Key label="循环模式" icon={repeat==='repeat-1' ? 'repeat_one':'repeat'} active={repeat!=='false'} onClick={() => c.toggleRepeat()} /></div><StemFader /><VolumeFader /></div> : panel==='download' ? <DownloadPanel /> : panel==='queue' ? <QueuePanel /> : <div className="full-lyrics">{lyrics.songId===song.songId && lyrics.lines.length ? lyrics.lines.map((line,index) => <button key={`${line.start}-${index}`} aria-current={index===lyrics.index ? 'true':undefined} onClick={() => c.updateSongPosition(line.start)}>{line.text}</button>) : <p>暂无歌词</p>}</div>}</div>
    </ManagementDialog>}
  </section></>;
}
