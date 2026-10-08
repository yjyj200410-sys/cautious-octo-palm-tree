/**
 * NCM 歌词适配器 — 网易云歌词 JSON → Nora SongLyrics 格式。
 */

import { NcmRepository } from './repository';

// LRC 解析
function parseLrc(lrc: string) {
  const lines: { time: number; text: string }[] = [];
  const regex = /\[(\d+):(\d+(?:\.\d+)?)\](.*)/g;
  let match;
  while ((match = regex.exec(lrc)) !== null) {
    const min = parseInt(match[1], 10);
    const sec = parseFloat(match[2]);
    const text = match[3].trim();
    if (text) lines.push({ time: min * 60 + sec, text });
  }
  return lines;
}

export async function fetchNcmLyric(song: { ncmId: number; title: string; artists: string[]; duration: number }): Promise<SongLyrics | null> {
  try {
    const raw = await NcmRepository.lyric(song.ncmId);
    if (!raw.lyric && !raw.tlyric) return null;

    const lyricLines = raw.lyric ? parseLrc(raw.lyric) : [];
    const tLyricLines = raw.tlyric ? parseLrc(raw.tlyric) : [];

    if (lyricLines.length === 0) return null;

    const parsedLyrics: LyricLine[] = lyricLines.map((l, i) => {
      const tLine = tLyricLines.find((t) => Math.abs(t.time - l.time) < 0.5);
      return {
        originalText: l.text,
        translatedTexts: tLine ? [{ lang: 'zh', text: tLine.text }] : [],
        start: l.time,
        end: lyricLines[i + 1]?.time,
        isEnhancedSynced: false,
      };
    });

    return {
      title: song.title,
      source: 'Online' as LyricsSource,
      lyricsType: 'SYNCED' as LyricsTypes,
      lyrics: {
        isSynced: true,
        isRomanized: false,
        isTranslated: tLyricLines.length > 0,
        isReset: false,
        parsedLyrics,
        unparsedLyrics: raw.lyric || '',
      },
      isOfflineLyricsAvailable: false,
    };
  } catch {
    return null;
  }
}
