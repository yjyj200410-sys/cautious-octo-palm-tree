import { afterEach, describe, test, expect, vi } from 'vitest';

import {
  THIRD_PARTY_ID_BASE,
  hashCode,
  isThirdPartySong,
  relevanceScore,
  mergeAndRankSongs,
  searchThirdPartySongs,
  areNetEaseSongsUnplayable,
} from '../../../../../src/renderer/src/music-source/third-party';
import { ncmApi } from '../../../../../src/renderer/src/api/ncm-client';
import type { NcmSong } from '../../../../../src/renderer/src/ncm/types';

/** 构造最小 NcmSong fixture */
function song(partial: Partial<NcmSong> & { title: string; artists: { name: string }[] }): NcmSong {
  return {
    songId: -100000,
    duration: 240000,
    album: { name: '', albumId: 0 },
    path: '',
    artworkPaths: { isDefaultArtwork: true, artworkPath: '', optimizedArtworkPath: '' },
    isBlacklisted: false,
    coverUrl: '',
    url: null,
    ncmId: 100000,
    ...partial,
    artists: partial.artists.map((a) => ({ name: a.name, artistId: 0 })),
  } as NcmSong;
}

describe('isThirdPartySong / hashCode', () => {
  test('合成 id 基址以上判为第三方，网易云真实 id 不误判', () => {
    expect(isThirdPartySong(-(THIRD_PARTY_ID_BASE + 4194))).toBe(true);
    expect(isThirdPartySong(-186119)).toBe(false); // 网易云真实 id 数量级
    expect(isThirdPartySong(-THIRD_PARTY_ID_BASE)).toBe(true); // 边界（基址本身）
    expect(isThirdPartySong(-(THIRD_PARTY_ID_BASE - 1))).toBe(false);
  });

  test('真实收藏 id（≥2e9）不被误判为第三方（回归：2625288251 自动切歌）', () => {
    // 网易云真实 id 现已涨到 2.5e9+，旧基址 2e9 会把它们误判为第三方合成条目，
    // 跳过官方解析直接 keyword 解锁 → 大概率失败被自动切歌。
    expect(isThirdPartySong(-2625288251)).toBe(false);
    expect(isThirdPartySong(-3384438343)).toBe(false);
    expect(isThirdPartySong(-2652731241)).toBe(false);
  });

  test('hashCode 确定性且非负', () => {
    expect(hashCode('MUSIC_123456')).toBe(hashCode('MUSIC_123456'));
    expect(hashCode('abc')).toBeGreaterThanOrEqual(0);
    expect(hashCode('')).toBe(0);
  });
});

describe('relevanceScore — 相关性评分', () => {
  const jaySong = (title: string) => song({ title, artists: [{ name: '周杰伦' }] });

  test('标题完全相等 > 前缀 > 包含 > 分词命中', () => {
    const exact = relevanceScore(jaySong('简单爱'), '简单爱');
    const prefix = relevanceScore(jaySong('简单爱电台'), '简单爱');
    const includes = relevanceScore(jaySong('我就喜欢简单爱'), '简单爱');
    const token = relevanceScore(jaySong('爱简单'), '简单爱');
    expect(exact).toBeGreaterThan(prefix);
    expect(prefix).toBeGreaterThan(includes);
    expect(includes).toBeGreaterThan(token);
  });

  test('查询即歌手名 → 歌手加成', () => {
    const artistHit = relevanceScore(jaySong('简单爱'), '周杰伦');
    const noArtist = relevanceScore(song({ title: '简单爱', artists: [{ name: '王菲' }] }), '周杰伦');
    expect(artistHit).toBeGreaterThan(noArtist);
  });

  test('空查询 → 0', () => {
    expect(relevanceScore(jaySong('简单爱'), '  ')).toBe(0);
  });
});

describe('mergeAndRankSongs — 网易云 + 第三方按相关性混排', () => {
  test('同标题网易云在前（稳定排序），部分匹配靠后', () => {
    const neteaseExact = song({ songId: -1001, title: '简单爱', artists: [{ name: '周杰伦' }], ncmId: 1001 });
    const thirdPartyExact = song({
      songId: -(THIRD_PARTY_ID_BASE + 4194),
      title: '简单爱',
      artists: [{ name: '周杰伦' }],
      ncmId: THIRD_PARTY_ID_BASE + 4194,
      provider: 'gequbao',
    });
    const partial = song({ songId: -1002, title: '简单爱翻唱版', artists: [{ name: '周杰伦' }], ncmId: 1002 });

    const merged = mergeAndRankSongs([neteaseExact, partial], [thirdPartyExact], '简单爱');
    expect(merged.map((s) => s.songId)).toEqual([-1001, -(THIRD_PARTY_ID_BASE + 4194), -1002]);
  });

  test('第三方条目也参与排名（关键词命中即靠前），不按来源分块', () => {
    const neteaseFar = song({ songId: -2001, title: '爱在西元前', artists: [{ name: '周杰伦' }], ncmId: 2001 });
    const thirdPartyHit = song({
      songId: -(THIRD_PARTY_ID_BASE + 5555),
      title: '简单爱',
      artists: [{ name: '周杰伦' }],
      ncmId: THIRD_PARTY_ID_BASE + 5555,
      provider: 'kuwo',
    });
    const merged = mergeAndRankSongs([neteaseFar], [thirdPartyHit], '简单爱');
    expect(merged[0].songId).toBe(-(THIRD_PARTY_ID_BASE + 5555)); // 三方命中排在前
    expect(merged[1].songId).toBe(-2001);
  });
});

describe('searchThirdPartySongs — 主进程候选 → NcmSong 映射', () => {
  afterEach(() => vi.unstubAllGlobals());

  test('gequbao/kuwo 候选映射为合成负 id + provider 标注', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      code: 200,
      items: [
        { provider: 'gequbao', id: '4194', title: '简单爱', artist: '周杰伦' },
        { provider: 'kuwo', id: '123456', title: '爱在西元前', artist: '周杰伦', durationSec: 235, cover: 'http://img/cov.jpg' },
      ],
    }), { status: 200 })));

    const songs = await searchThirdPartySongs('简单爱');
    expect(songs).toHaveLength(2);

    const gqb = songs[0];
    expect(gqb.songId).toBe(-(THIRD_PARTY_ID_BASE + 4194)); // gequbao offset 0 + 数字 id
    expect(gqb.ncmId).toBe(THIRD_PARTY_ID_BASE + 4194);
    expect(gqb.provider).toBe('gequbao');
    expect(gqb.artists[0].name).toBe('周杰伦');
    expect(gqb.duration).toBe(0); // gequbao 搜索行无时长

    const kw = songs[1];
    expect(kw.provider).toBe('kuwo');
    expect(kw.duration).toBe(235000); // 秒 → 毫秒
    expect(kw.coverUrl).toBe('http://img/cov.jpg');
    expect(kw.songId).toBeLessThan(-(THIRD_PARTY_ID_BASE + 1_000_000_000)); // kuwo 偏移段
  });

  test('网络失败 / 非 200 → []', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('down'); }));
    await expect(searchThirdPartySongs('简单爱')).resolves.toEqual([]);
  });
});

describe('areNetEaseSongsUnplayable — 批量可播性探测', () => {
  afterEach(() => vi.restoreAllMocks());

  test('全部无 URL → true（触发兜底）', async () => {
    vi.spyOn(ncmApi, 'getSongUrls').mockResolvedValue({ data: [{ id: 1, url: null }, { id: 2, url: null }] } as never);
    await expect(areNetEaseSongsUnplayable([
      song({ songId: -1, title: 'a', artists: [{ name: 'x' }], ncmId: 1 }),
      song({ songId: -2, title: 'b', artists: [{ name: 'x' }], ncmId: 2 }),
    ])).resolves.toBe(true);
  });

  test('任一有 URL → false（不触发）', async () => {
    vi.spyOn(ncmApi, 'getSongUrls').mockResolvedValue({ data: [{ id: 1, url: 'http://x/1.mp3' }, { id: 2, url: null }] } as never);
    await expect(areNetEaseSongsUnplayable([
      song({ songId: -1, title: 'a', artists: [{ name: 'x' }], ncmId: 1 }),
    ])).resolves.toBe(false);
  });

  test('探测异常 → true（保守触发）', async () => {
    vi.spyOn(ncmApi, 'getSongUrls').mockRejectedValue(new Error('boom') as never);
    await expect(areNetEaseSongsUnplayable([
      song({ songId: -1, title: 'a', artists: [{ name: 'x' }], ncmId: 1 }),
    ])).resolves.toBe(true);
  });

  test('纯第三方条目 → 直接 true，不调 API', async () => {
    const spy = vi.spyOn(ncmApi, 'getSongUrls');
    await expect(areNetEaseSongsUnplayable([
      song({ songId: -(THIRD_PARTY_ID_BASE + 1), title: 'a', artists: [{ name: 'x' }], ncmId: THIRD_PARTY_ID_BASE + 1, provider: 'gequbao' }),
    ])).resolves.toBe(true);
    expect(spy).not.toHaveBeenCalled();
  });
});
