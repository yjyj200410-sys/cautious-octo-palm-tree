import type { NcmSongQuality } from '@common/ncmQuality';

export const NCM_QUALITY_LABEL_KEYS = {
  standard: 'settingsPage.ncmQualityStandard',
  exhigh: 'settingsPage.ncmQualityExhigh',
  lossless: 'settingsPage.ncmQualityLossless',
  hires: 'settingsPage.ncmQualityHires',
  jyeffect: 'settingsPage.ncmQualityJyeffect',
  sky: 'settingsPage.ncmQualitySky',
  jymaster: 'settingsPage.ncmQualityJymaster'
} as const satisfies Record<NcmSongQuality, string>;
