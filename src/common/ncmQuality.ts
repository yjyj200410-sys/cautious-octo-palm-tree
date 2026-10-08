export const SongQuality = {
  STANDARD: 'standard',
  EXHIGH: 'exhigh',
  LOSSLESS: 'lossless',
  HIRES: 'hires',
  JYEFFECT: 'jyeffect',
  SKY: 'sky',
  JYMASTER: 'jymaster'
} as const;

export type NcmSongQuality = (typeof SongQuality)[keyof typeof SongQuality];

export const NCM_SONG_QUALITIES = Object.values(SongQuality) as NcmSongQuality[];

export const DEFAULT_NCM_SONG_QUALITY: NcmSongQuality = SongQuality.EXHIGH;

export function isNcmSongQuality(value: unknown): value is NcmSongQuality {
  return typeof value === 'string' && (NCM_SONG_QUALITIES as readonly string[]).includes(value);
}

export function normalizeNcmSongQuality(value: unknown): NcmSongQuality {
  return isNcmSongQuality(value) ? value : DEFAULT_NCM_SONG_QUALITY;
}
