/**
 * PlayTrace — 播放启动耗时追踪工具。
 *
 * 两类输出：
 *   trace.end(name, note?)  →  [PLAY_TRACE][id] name [note] cost=xxxms    （阶段耗时）
 *   trace.log(msg)           →  [PLAY_TRACE][id] msg                        （检查点）
 *   trace.done()             →  [PLAY_TRACE][id] PLAY_STARTED total=xxxms  （总耗时）
 *
 * 隔离原则：
 *   source='user'     → 用户点击，输出完整链路
 *   source='prefetch' → 后台预热/恢复/续播，静默
 *   getPlayTrace()=null → 无活跃 trace
 */

export type TraceSource = 'user' | 'prefetch' | 'restore';

export interface PlayTrace {
  readonly traceId: string;
  readonly source: TraceSource;
  start(name: string): void;
  /** @param note 附加信息，如 winner=kuwo */
  end(name: string, note?: string): void;
  /** 自由格式检查点，输出时间偏移量（相对 click） */
  log(msg: string): void;
  done(): void;
}

let current: PlayTrace | null = null;

export function createPlayTrace(source: TraceSource = 'user'): PlayTrace {
  const traceId = Math.random().toString(36).slice(2, 8);
  const clickTime = performance.now();
  const stages = new Map<string, number>();
  const isUser = source === 'user';

  const trace: PlayTrace = {
    traceId,
    source,
    start(name) {
      stages.set(name, performance.now());
    },
    end(name, note) {
      if (!isUser) return;
      const stageStart = stages.get(name);
      const now = performance.now();
      const cost = Math.round(now - (stageStart ?? now));
      const noteStr = note ? ` ${note}` : '';
      console.log(`[PLAY_TRACE][${traceId}] ${name}${noteStr} cost=${cost}ms`);
    },
    log(msg) {
      if (!isUser) return;
      const elapsed = Math.round(performance.now() - clickTime);
      console.log(`[PLAY_TRACE][${traceId}] ${msg} ${elapsed}ms`);
    },
    done() {
      if (isUser) {
        const total = Math.round(performance.now() - clickTime);
        console.log(`[PLAY_TRACE][${traceId}] PLAY_STARTED total=${total}ms`);
      }
      current = null;
    },
  };

  if (isUser) {
    console.log(`[PLAY_TRACE][${traceId}] click 0ms`);
  }
  current = trace;
  return trace;
}

export function getPlayTrace(): PlayTrace | null {
  return current;
}
