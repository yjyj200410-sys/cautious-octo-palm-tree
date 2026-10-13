import { searchGequbaoSongs } from './gequbao';
import { searchKuwoSongs } from './kuwo';
import type { ThirdPartySongCandidate } from './types';

/**
 * 单 provider 预算：超时按空处理（不抛、不阻塞另一来源）。 gequbao 搜索页 3 跳重试（每跳 8s）最坏 24s，绝不能拖住快如 ~1s 的 kuwo —— 否则 route 层
 * 15s 总预算里 gequbao 一卡，整个搜索返回空（连带 kuwo 结果一起丢）。
 */
function withBudget<T>(p: Promise<T>, ms: number): Promise<T | null> {
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve(null), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      () => {
        clearTimeout(t);
        resolve(null);
      }
    ).catch(() => resolve(null));
  });
}

// gequbao 搜索更慢（跳数多 + 上游抖动）；kuwo 单跳很快。各自预算之和 < route 的 15s。
const GEQUBAO_BUDGET_MS = 12_000;
const KUWO_BUDGET_MS = 5_000;

/** 第三方搜索兜底：并查歌曲宝 + 酷我，按「标题|歌手」去重（gequbao 优先）， 最多 totalLimit 条。任一来源失败 / 超时不影响另一来源。 */
export async function searchThirdParty(
  keyword: string,
  totalLimit = 12
): Promise<ThirdPartySongCandidate[]> {
  if (!keyword.trim()) return [];
  const [gequbao, kuwo] = await Promise.all([
    withBudget(searchGequbaoSongs(keyword), GEQUBAO_BUDGET_MS),
    withBudget(searchKuwoSongs(keyword), KUWO_BUDGET_MS)
  ]);
  const seen = new Set<string>();
  const merged: ThirdPartySongCandidate[] = [];
  for (const item of [...(gequbao ?? []), ...(kuwo ?? [])]) {
    const key = `${item.title.toLowerCase()}|${item.artist.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(item);
    if (merged.length >= totalLimit) break;
  }
  return merged;
}
