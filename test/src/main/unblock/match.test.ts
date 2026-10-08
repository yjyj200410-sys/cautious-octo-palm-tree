import { describe, test, expect } from 'vitest';

import { isSongMatch, hasVersionMarker } from '../../../../src/main/unblock/match';
import type { SongMatchInfo } from '../../../../src/main/unblock/types';

/** 构造原曲信息：默认「千千阙歌 - 陈慧娴」 */
function match(partial: Partial<SongMatchInfo>): SongMatchInfo {
  return { keyword: '', songName: '千千阙歌', artist: '陈慧娴', ...partial };
}

describe('isSongMatch — 歌手校验', () => {
  test('同歌名 + 同歌手 → 通过', () => {
    expect(isSongMatch('千千阙歌', '陈慧娴', match({}))).toBe(true);
  });

  test('同歌名 + 不同歌手（翻唱/同名不同人）→ 拒绝', () => {
    expect(isSongMatch('千千阙歌', '邓瑞霞', match({}))).toBe(false);
    expect(isSongMatch('千千阙歌', '兮妹', match({}))).toBe(false);
  });

  test('候选缺歌手 → 无法确认为原版 → 拒绝', () => {
    expect(isSongMatch('千千阙歌', '', match({}))).toBe(false);
    expect(isSongMatch('千千阙歌', undefined, match({}))).toBe(false);
  });

  test('多歌手原曲：候选命中任一歌手即可通过', () => {
    const duet = match({ songName: '说好不哭', artist: '周杰伦 / 阿信' });
    expect(isSongMatch('说好不哭', '周杰伦', duet)).toBe(true);
    expect(isSongMatch('说好不哭', '周杰伦&阿信', duet)).toBe(true);
    expect(isSongMatch('说好不哭', '阿信', duet)).toBe(true);
  });

  test('候选歌手名含原曲歌手名（乐队后缀）→ 通过', () => {
    expect(isSongMatch('海阔天空', 'Beyond乐队', match({ songName: '海阔天空', artist: 'Beyond' }))).toBe(true);
  });

  test('候选多歌手同时含原曲歌手与翻唱者 → 拒绝（收口 any-overlap 漏洞）', () => {
    // 夜空中最亮的星 实况：Kuwo 条目「大土班的魔仙堡&洛天依&逃跑计划」含原曲歌手+翻唱者，旧 some 会放行
    const night = match({ songName: '夜空中最亮的星', artist: '逃跑计划' });
    expect(isSongMatch('夜空中最亮的星', '大土班的魔仙堡&洛天依&逃跑计划', night)).toBe(false);
    expect(isSongMatch('夜空中最亮的星', '洛天依&逃跑计划', night)).toBe(false);
  });

  test('候选歌手为原曲歌手的子集 → 通过（不含多余歌手）', () => {
    const night = match({ songName: '夜空中最亮的星', artist: '逃跑计划' });
    expect(isSongMatch('夜空中最亮的星', '逃跑计划', night)).toBe(true);
  });

  test('原曲歌手未知 → 歌手校验放行（保持旧行为）', () => {
    expect(isSongMatch('千千阙歌', '邓瑞霞', match({ artist: '' }))).toBe(true);
  });
});

describe('hasVersionMarker — 第三方搜索候选过滤', () => {
  test('DJ/加速/Live/伴奏/翻唱等标记 → true', () => {
    expect(hasVersionMarker('简单爱 (DJ版)')).toBe(true);
    expect(hasVersionMarker('简单爱 - 加速版')).toBe(true);
    expect(hasVersionMarker('简单爱 (Live)')).toBe(true);
    expect(hasVersionMarker('简单爱 伴奏')).toBe(true);
    expect(hasVersionMarker('简单爱 (Cover)')).toBe(true);
    expect(hasVersionMarker('简单爱 翻唱')).toBe(true);
    expect(hasVersionMarker('简单爱 (串烧)')).toBe(true);
  });

  test('无标记的普通标题 → false', () => {
    expect(hasVersionMarker('简单爱')).toBe(false);
    expect(hasVersionMarker('爱在西元前')).toBe(false);
    expect(hasVersionMarker('以父之名')).toBe(false);
  });

  test('大小写不敏感（LIVE/lIve）', () => {
    expect(hasVersionMarker('简单爱 (LIVE)')).toBe(true);
    expect(hasVersionMarker('简单爱 (lIve)')).toBe(true);
  });
});

describe('isSongMatch — 原有校验不回归', () => {
  test('歌名不符 → 拒绝', () => {
    expect(isSongMatch('浪子心声', '陈慧娴', match({}))).toBe(false);
  });

  test('版本标记（原曲不含而候选含）→ 拒绝', () => {
    expect(isSongMatch('千千阙歌 (Live)', '陈慧娴', match({}))).toBe(false);
    expect(isSongMatch('千千阙歌 (DJ版)', '陈慧娴', match({}))).toBe(false);
    // 扩展标记：串烧/片段/副歌/acoustic 等
    expect(isSongMatch('千千阙歌 (串烧)', '陈慧娴', match({}))).toBe(false);
    expect(isSongMatch('千千阙歌 (片段)', '陈慧娴', match({}))).toBe(false);
    expect(isSongMatch('千千阙歌 (副歌版)', '陈慧娴', match({}))).toBe(false);
    expect(isSongMatch('千千阙歌 (acoustic)', '陈慧娴', match({}))).toBe(false);
    expect(isSongMatch('千千阙歌 (改编版)', '陈慧娴', match({}))).toBe(false);
    // 原曲标题本就含标记（用户就是想播该版）→ 不过度拦截
    expect(isSongMatch('千千阙歌 (Live)', '陈慧娴', match({ songName: '千千阙歌 (Live)' }))).toBe(true);
  });

  test('时长显著偏离 → 拒绝；缺时长信息 → 跳过', () => {
    // 千千阙歌原曲 ~298s；加速版 200s（短 ~33%）→ 拒绝
    expect(isSongMatch('千千阙歌', '陈慧娴', match({ durationMs: 298000 }), 200)).toBe(false);
    // DJ 加长版 360s（长 ~21%）→ 拒绝
    expect(isSongMatch('千千阙歌', '陈慧娴', match({ durationMs: 298000 }), 360)).toBe(false);
    // 不同录音 340s（长 ~14%）→ ±5% 收紧后拒绝（±15% 时原会放行）
    expect(isSongMatch('千千阙歌', '陈慧娴', match({ durationMs: 298000 }), 340)).toBe(false);
    // 同曲不同平台几秒漂移 → 通过
    expect(isSongMatch('千千阙歌', '陈慧娴', match({ durationMs: 298000 }), 296)).toBe(true);
    // 原曲时长未知 → 跳过时长校验
    expect(isSongMatch('千千阙歌', '陈慧娴', match({}), 200)).toBe(true);
  });
});
