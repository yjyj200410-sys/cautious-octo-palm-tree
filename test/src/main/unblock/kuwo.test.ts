import { afterEach, describe, test, expect, vi } from 'vitest';

import { parseKuwoAbslist, searchKuwoSongs } from '../../../../src/main/unblock/kuwo';

// 模拟酷我搜索 JSON（search.kuwo.cn r.s? → content[1].musicpage.abslist）
const KUWO_FIXTURE = JSON.stringify({
  content: [
    {},
    {
      musicpage: {
        abslist: [
          {
            MUSICRID: 'MUSIC_123456',
            SONGNAME: '简单爱',
            ARTIST: '周杰伦',
            DURATION: 241,
            web_albumpic_short: 'http://img.example/cov.jpg',
          },
          {
            MUSICRID: 'MUSIC_999999',
            SONGNAME: '简单爱 (Live)',
            ARTIST: '周杰伦',
            DURATION: 300,
          },
          {
            MUSICRID: 'MUSIC_888888',
            SONGNAME: '爱在西元前',
            ARTIST: '周杰伦',
            DURATION: 235,
          },
        ],
      },
    },
  ],
});

describe('parseKuwoAbslist — 酷我搜索 JSON 解析', () => {
  test('提取 rid/title/artist/duration/cover，MUSIC_ 前缀去除', () => {
    const rows = parseKuwoAbslist(JSON.parse(KUWO_FIXTURE));
    expect(rows).toEqual([
      { rid: '123456', title: '简单爱', artist: '周杰伦', durationSec: 241, cover: 'http://img.example/cov.jpg' },
      { rid: '999999', title: '简单爱 (Live)', artist: '周杰伦', durationSec: 300 },
      { rid: '888888', title: '爱在西元前', artist: '周杰伦', durationSec: 235 },
    ]);
  });

  test('缺 content/musicpage/abslist → []', () => {
    expect(parseKuwoAbslist({})).toEqual([]);
    expect(parseKuwoAbslist({ content: [{}] })).toEqual([]);
  });

  test('无 MUSICRID 或无 SONGNAME 的行被跳过', () => {
    const raw = {
      content: [{}, { musicpage: { abslist: [{ SONGNAME: 'no-rid' }, { MUSICRID: 'MUSIC_1' }] } }],
    };
    expect(parseKuwoAbslist(raw)).toEqual([]);
  });
});

describe('searchKuwoSongs — 第三方搜索候选（过滤版本标记 + 上限）', () => {
  afterEach(() => vi.unstubAllGlobals());

  test('返回非版本标记行，上限生效', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(KUWO_FIXTURE, { status: 200 })));
    const items = await searchKuwoSongs('简单爱', 2);
    expect(items).toEqual([
      { provider: 'kuwo', id: '123456', title: '简单爱', artist: '周杰伦', durationSec: 241, cover: 'http://img.example/cov.jpg' },
      { provider: 'kuwo', id: '888888', title: '爱在西元前', artist: '周杰伦', durationSec: 235 },
    ]);
  });

  test('网络失败 → 返回 []（不抛）', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network down'); }));
    await expect(searchKuwoSongs('简单爱')).resolves.toEqual([]);
  });
});
