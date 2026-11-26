import { Icon } from './PlaybackControls';

type RecentTrack = { id: number; title: string; artist: string; artwork: string; duration: number };
function readRecent(): RecentTrack[] {
  try { const value = JSON.parse(localStorage.getItem('volo:paper-recent') || '[]'); return Array.isArray(value) ? value.filter(t => typeof t.id === 'number' && typeof t.title === 'string').slice(0, 3) : []; } catch { return []; }
}
export function rememberTrack(song: AudioPlayerData) {
  const track = { id: song.songId, title: song.title, artist: song.artists?.map(a => a.name).join(' / ') || '未知歌手', artwork: song.artworkPath || '', duration: song.duration || 0 };
  try { localStorage.setItem('volo:paper-recent', JSON.stringify([track, ...readRecent().filter(t => t.id !== track.id)].slice(0, 3))); } catch { /* Storage may be unavailable. Playback can continue. */ }
}
export function PaperRecent({ version: _version, onPlay }: { version: number; onPlay: (id: number) => void }) {
  const tracks = readRecent();
  return <section className="paper-recent" aria-label="最近在听"><span className="paper-eyebrow">THE LISTENING ROOM</span><h1>最近在听<span>。</span></h1><p className="paper-intro">熟悉的旋律，刚刚好的此刻。</p><div className="paper-recent-list">{tracks.length ? tracks.map((t, index) => <button className="paper-recent-row" key={t.id} onClick={() => onPlay(t.id)} aria-label={`播放 ${t.title}`}><span className="paper-index">{String(index + 1).padStart(2, '0')}</span><span className="paper-recent-art">{t.artwork ? <img src={t.artwork} alt="" onError={e => { e.currentTarget.style.visibility = 'hidden'; }} /> : <Icon name="music_note" />}</span><span className="paper-recent-meta"><strong>{t.title}</strong><small>{t.artist}</small></span><time>{Math.floor(t.duration / 60)}:{String(Math.floor(t.duration % 60)).padStart(2, '0')}</time><Icon name="play_arrow" /></button>) : <div className="paper-recent-empty">让喜欢的声音，填满这一刻。<small>从下面的音乐库选择一首，播放记录会留在这里。</small></div>}</div></section>;
}
