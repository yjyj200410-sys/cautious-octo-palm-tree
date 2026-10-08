import { afterEach, describe, test, expect, vi } from 'vitest';

import { extractPlayId, parseGequbaoSongRows, searchGequbaoSongs } from '../../../../src/main/unblock/gequbao';

describe('gequbao extractPlayId — 歌曲页改版后 play_id 藏在 JSON.parse 里', () => {
  test('新版：window.appData = JSON.parse(...) 且 key 被 \\u0022 转义 → 能取出', () => {
    const html = `...<script>window.appData = JSON.parse('{"mp3_id":4194,"play_id":"eyJpdiI6ImZySktqRndsQkhRcmh3eitpMk1WWkE9PSJ9","name":"启动"}');</script>...`;
    // 上面用真实 " 转义形式构造（等价于源码里的转义序列）
    const raw = html.replace(/"/g, '\\u0022');
    expect(extractPlayId(raw)).toBe('eyJpdiI6ImZySktqRndsQkhRcmh3eitpMk1WWkE9PSJ9');
  });

  test('新版：含中文 unicode 转义 + 其他字段 → 仍取出 play_id', () => {
    const raw = `window.appData = JSON.parse('{"mp3_id":4188,"play_id":"abc123","singer_name":"\\u5468\\u6770\\u4f26"}')`;
    expect(extractPlayId(raw)).toBe('abc123');
  });

  test('新版：play_id 缺失（JSON.parse 内容没有该字段）→ null', () => {
    const raw = `window.appData = JSON.parse('{"mp3_id":4188}')`;
    expect(extractPlayId(raw)).toBeNull();
  });

  test('旧版：直接 "play_id":"..." → 仍兼容', () => {
    const raw = `<script>var x = "play_id":"legacy-pid";</script>`;
    expect(extractPlayId(raw)).toBe('legacy-pid');
  });

  test('无任何 play_id 信息 → null', () => {
    expect(extractPlayId('<html>nothing here</html>')).toBeNull();
  });
});

// 模拟 gequbao 搜索页 HTML（hover-zoom 行 + text-primary 歌名 + text-jade 歌手）
const GQB_FIXTURE = `
<div class="media-body">
  <a href="/music/4194" class="hover-zoom">
    <span class="text-primary">简单爱</span>
    <small class="text-jade">周杰伦</small>
  </a>
  <a href="/music/4200" class="hover-zoom">
    <span class="text-primary">简单爱 (DJ版)</span>
    <small class="text-jade">周杰伦</small>
  </a>
  <a href="/music/4201" class="hover-zoom">
    <span class="text-primary">简单爱 (Live)</span>
    <small class="text-jade">周杰伦</small>
  </a>
  <a href="/music/4202" class="hover-zoom">
    <span class="text-primary">开不了口</span>
    <small class="text-jade">周杰伦</small>
  </a>
</div>`;

describe('parseGequbaoSongRows — 搜索页行解析', () => {
  test('提取 (id, title, artist) 列表，保持原始顺序', () => {
    const rows = parseGequbaoSongRows(GQB_FIXTURE);
    expect(rows).toEqual([
      { id: '4194', title: '简单爱', artist: '周杰伦' },
      { id: '4200', title: '简单爱 (DJ版)', artist: '周杰伦' },
      { id: '4201', title: '简单爱 (Live)', artist: '周杰伦' },
      { id: '4202', title: '开不了口', artist: '周杰伦' },
    ]);
  });

  test('空页 → []', () => {
    expect(parseGequbaoSongRows('<html>no rows</html>')).toEqual([]);
  });

  test('歌手名 HTML 实体解码（&amp; → &）', () => {
    const html = `<a href="/music/1" class="hover-zoom"><span class="text-primary">歌</span><small class="text-jade">A&amp;B</small></a>`;
    expect(parseGequbaoSongRows(html)[0].artist).toBe('A&B');
  });
});

describe('searchGequbaoSongs — 第三方搜索候选（过滤版本标记）', () => {
  afterEach(() => vi.unstubAllGlobals());

  test('返回非版本标记行，上限生效', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(GQB_FIXTURE, { status: 200 })));
    const items = await searchGequbaoSongs('简单爱', 2);
    expect(items).toEqual([
      { provider: 'gequbao', id: '4194', title: '简单爱', artist: '周杰伦' },
      { provider: 'gequbao', id: '4202', title: '开不了口', artist: '周杰伦' },
    ]);
  });

  test('网络失败 → 返回 []（不抛）', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network down'); }));
    await expect(searchGequbaoSongs('简单爱')).resolves.toEqual([]);
  });
});
