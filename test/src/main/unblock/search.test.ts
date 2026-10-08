import { afterEach, describe, test, expect, vi } from 'vitest';

import { searchThirdParty } from '../../../../src/main/unblock/search';

// 同一首歌在 gequbao + kuwo 都有 → 应去重（gequbao 优先）
const GQB_FIXTURE = `
<a href="/music/4194" class="hover-zoom"><span class="text-primary">简单爱</span><small class="text-jade">周杰伦</small></a>`;

const KUWO_FIXTURE = JSON.stringify({
  content: [
    {},
    {
      musicpage: {
        abslist: [
          { MUSICRID: 'MUSIC_123456', SONGNAME: '简单爱', ARTIST: '周杰伦', DURATION: 241 },
          { MUSICRID: 'MUSIC_555555', SONGNAME: '爱在西元前', ARTIST: '周杰伦', DURATION: 235 },
        ],
      },
    },
  ],
});

function stubFetchByUrl() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const u = String(url);
      if (u.includes('gequbao.com')) return new Response(GQB_FIXTURE, { status: 200 });
      if (u.includes('search.kuwo.cn')) return new Response(KUWO_FIXTURE, { status: 200 });
      throw new Error(`unexpected url: ${u}`);
    }),
  );
}

describe('searchThirdParty — 聚合去重', () => {
  afterEach(() => vi.unstubAllGlobals());

  test('gequbao 与 kuwo 同歌去重，保留 gequbao；kuwo 独有条目保留', async () => {
    stubFetchByUrl();
    const items = await searchThirdParty('简单爱');
    expect(items[0]).toMatchObject({ provider: 'gequbao', title: '简单爱', artist: '周杰伦' });
    // 酷我独有「爱在西元前」在去重后仍保留，且只出现一次
    const jay = items.filter((i) => i.title === '简单爱');
    expect(jay).toHaveLength(1);
    expect(jay[0].provider).toBe('gequbao');
    expect(items.some((i) => i.title === '爱在西元前' && i.provider === 'kuwo')).toBe(true);
  });

  test('空关键词 → []', async () => {
    await expect(searchThirdParty('   ')).resolves.toEqual([]);
  });

  test('totalLimit 上限生效', async () => {
    stubFetchByUrl();
    const items = await searchThirdParty('简单爱', 1);
    expect(items).toHaveLength(1);
  });

  test('全失败 → []（不抛）', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network down'); }));
    await expect(searchThirdParty('简单爱')).resolves.toEqual([]);
  });
});
