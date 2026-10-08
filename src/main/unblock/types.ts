export type SongUrlResult = {
  code: number;
  url: string | null;
};

/** 用于校验搜索结果的原曲信息 */
export type SongMatchInfo = {
  keyword: string;
  songName: string;
  artist: string;
  /** 原曲时长（毫秒）— 用于拒绝加速版/DJ加长版等非原版候选；未知可省略 */
  durationMs?: number;
};

/** 第三方搜索候选（歌曲宝/酷我），供搜索兜底端点 /api/unblock/search 返回 */
export type ThirdPartySongCandidate = {
  provider: 'gequbao' | 'kuwo';
  /** gequbao music id / kuwo MUSICRID（去前缀） */
  id: string;
  title: string;
  artist: string;
  /** 秒；kuwo 有，gequbao 搜索行无 */
  durationSec?: number;
  /** kuwo 搜索结果常带封面，gequbao 无 */
  cover?: string;
};
