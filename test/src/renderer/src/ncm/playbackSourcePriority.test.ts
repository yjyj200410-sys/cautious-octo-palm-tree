import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { NcmPlaybackResolver } from '@renderer/music-source/netease/NcmPlaybackResolver';
import { NcmRepository } from '@renderer/ncm/repository';

vi.mock('@renderer/ncm/repository', () => ({
  NcmRepository: {
    getSongUrlRaw: vi.fn(),
    getSongDownloadUrlRaw: vi.fn()
  }
}));
vi.mock('@renderer/other/PlayTrace', () => ({ getPlayTrace: () => null }));

const officialUrl = 'https://official.example/music';
const trialInfo = { start: 30, end: 60 };
const fetchProvider = vi.fn();
const metadata = { meta: { title: 'Sample', artists: 'Artist', durationMs: 180000 } };

beforeEach(() => {
  vi.resetAllMocks();
  NcmPlaybackResolver.clearCache();
  vi.stubGlobal('fetch', fetchProvider);
});

afterEach(() => vi.unstubAllGlobals());

it('keeps an official full VIP stream even when the purchase flag is absent', async () => {
  vi.mocked(NcmRepository.getSongUrlRaw).mockResolvedValue({
    data: [{ code: 200, fee: 1, payed: 0, url: officialUrl }]
  });

  await expect(NcmPlaybackResolver.resolve(1, metadata)).resolves.toMatchObject({
    url: officialUrl,
    source: 'netease',
    unlocked: false
  });
  expect(NcmRepository.getSongDownloadUrlRaw).not.toHaveBeenCalled();
  expect(fetchProvider).not.toHaveBeenCalled();
});

it('checks a full official download source before calling third-party providers', async () => {
  vi.mocked(NcmRepository.getSongUrlRaw).mockResolvedValue({
    data: [{ code: 200, url: officialUrl, freeTrialInfo: trialInfo }]
  });
  vi.mocked(NcmRepository.getSongDownloadUrlRaw).mockResolvedValue({
    data: { code: 200, url: 'https://official.example/full' }
  });

  await expect(NcmPlaybackResolver.resolve(2, metadata)).resolves.toMatchObject({
    url: 'https://official.example/full',
    source: 'download',
    unlocked: false
  });
  expect(fetchProvider).not.toHaveBeenCalled();
});

it('labels the official clip as a trial when every full source is unavailable', async () => {
  vi.mocked(NcmRepository.getSongUrlRaw).mockResolvedValue({
    data: [{ code: 200, fee: 0, url: officialUrl, freeTrialInfo: trialInfo }]
  });
  vi.mocked(NcmRepository.getSongDownloadUrlRaw).mockResolvedValue({});
  fetchProvider.mockResolvedValue(new Response(JSON.stringify({ code: 404, url: null })));

  await expect(NcmPlaybackResolver.resolve(3, metadata)).resolves.toMatchObject({
    url: officialUrl,
    source: 'netease',
    isTrial: true
  });
  expect(fetchProvider).toHaveBeenCalled();
});
