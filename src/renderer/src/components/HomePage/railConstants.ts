/** 分类切换动画状态机(阶段 3.6):idle 常态 / exit 旧列表退场 / enter 新列表进场 */
export type RailTransition = 'idle' | 'exit' | 'enter';

/**
 * 分类切换动画方向:up = 切到上方 tab(旧列表下移退场/新列表自上方入场);down = 切到下方 tab (旧列表上移退场/新列表自下方入场)。点击时由 Home 按
 * FloatingNav 竖直顺序计算并贯穿整个切换。
 */
export type RailDir = 'up' | 'down';

/**
 * 分类切换动画时长:旧列表退场 300ms ease-out / 新列表进场 400ms ease-out。 Home 定时器按这两常量切阶段;样式侧 styles.css 的 rail-exit
 * 与 rail-enter 四个类也内联了 相同时长(动画参数只走 CSS),两处必须保持一致,否则换帧时机错位。 注意:块注释里不要写「星号紧跟斜杠」连排——会提前闭合注释(本文件两次踩坑)。
 */
export const RAIL_EXIT_MS = 180;
export const RAIL_ENTER_MS = 240;
