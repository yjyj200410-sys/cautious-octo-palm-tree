import { useEffect, useSyncExternalStore, type SetStateAction } from 'react';
import { store } from '../store/store';
import { getBackgroundPulse as getBeatPulse } from './backgroundAudio';
import { extractDominantColor, hexToHsl } from './accentColor';
import { resolveBackgroundSource } from './backgroundSource';

const LS_KEY = 'lumina_bgColor';

const BG_ELEMENT_ID = 'lumina-color-bg';

type BgMode = 'none' | 'solid' | 'gradient' | 'mask';
type GradType = 'linear' | 'radial' | 'conic';

interface BgConfig {
  mode: BgMode;
  solid: string;
  gradType: GradType;
  gradColors: string[];
  gradAngle: number;
  gradPos: string;
  opacity: number;
  autoColor: boolean;
  animate: boolean;
  beatSync: boolean;
  maskX: number;
  maskY: number;
  maskSolidPct: number;
}

const DEFAULT_CONFIG: BgConfig = {
  mode: 'none',
  solid: '#000000',
  gradType: 'linear',
  gradColors: ['#2c2d31', '#65666c'],
  gradAngle: 90,
  gradPos: 'center',
  opacity: 100,
  autoColor: false,
  animate: false,
  beatSync: false,
  maskX: 0,
  maskY: 0,
  maskSolidPct: 30,
};

const POSITIONS = ['center', 'top', 'bottom', 'left', 'right'];

/** 位置按钮中文标签(值为 CSS 关键字) */
const POSITION_LABELS: Record<string, string> = {
  center: '中央', top: '上', bottom: '下', left: '左', right: '右',
};

/** 角度旋转速度(°/秒) */
const ANIM_DEG_PER_SEC = 24;

/** 色标保底 2 个、截断到 5 个(旧存档兼容) */
function clampColors(c: unknown): string[] {
  const arr = Array.isArray(c)
    ? c.filter((x): x is string => typeof x === 'string' && x.length > 0)
    : [];
  while (arr.length < 2) arr.push('#1a1a2e');
  return arr.slice(0, 5);
}

/** 统一读取 localStorage 配置,合并默认值 + 字段校验(新字段对旧存档自动取默认) */
function readConfig(): BgConfig {
  try {
    const saved: Record<string, unknown> = JSON.parse(localStorage.getItem(LS_KEY) || '{}');
    return {
      mode: saved.mode === 'solid' || saved.mode === 'gradient' || saved.mode === 'mask' ? saved.mode : 'none',
      solid: typeof saved.solid === 'string' ? saved.solid : DEFAULT_CONFIG.solid,
      gradType: saved.gradType === 'radial' || saved.gradType === 'conic' ? saved.gradType : 'linear',
      gradColors: clampColors(saved.gradColors ?? DEFAULT_CONFIG.gradColors),
      gradAngle: typeof saved.gradAngle === 'number' ? saved.gradAngle : DEFAULT_CONFIG.gradAngle,
      gradPos: typeof saved.gradPos === 'string' ? saved.gradPos : 'center',
      opacity: typeof saved.opacity === 'number' ? saved.opacity : 100,
      autoColor: !!saved.autoColor,
      maskX: typeof saved.maskX === 'number' ? saved.maskX : 0,
      maskY: typeof saved.maskY === 'number' ? saved.maskY : 0,
      maskSolidPct: typeof saved.maskSolidPct === 'number' ? saved.maskSolidPct : DEFAULT_CONFIG.maskSolidPct,
      animate: !!saved.animate,
      beatSync: !!saved.beatSync,
    };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

// ── 模块级渐变管理器(非 React 常驻) ───────────────────────────────

let config: BgConfig = readConfig();
let autoColors: string[] | null = null; // autoColor 派生的色标缓存(不写回 gradColors)
let autoSolid: string | null = null; // autoColor 派生的纯色(封面主色,供纯色模式)
let autoToken = 0; // 异步取色竞态令牌
let rafId: number | null = null;
let rafStart = 0;
let lastArtwork: string | null = null; // 切歌 diff
let started = false; // initColorBackground 防重复注册
let backgroundElement: HTMLDivElement | null = null;
const configListeners = new Set<() => void>();
const subscribeConfig = (listener: () => void) => {
  configListeners.add(listener);
  return () => { configListeners.delete(listener); };
};
const getConfigSnapshot = () => config;

function attachBackgroundElement(element: HTMLDivElement | null) {
  backgroundElement = element;
  if (element) applyColorBackground();
  else stopRaf();
}

/** React owns the background node, so source changes cannot leave a detached layer. */
export function ColorBackgroundLayer() {
  return <div id={BG_ELEMENT_ID} ref={attachBackgroundElement} aria-hidden="true"
    className="pointer-events-none absolute inset-0 z-0" />;
}

function isReducedMotion(): boolean {
  const prefs = store.state.localStorage?.preferences;
  return !!(prefs?.isReducedMotion || (store.state.isOnBatteryPower && prefs?.removeAnimationsOnBatteryPower));
}

function buildGradientImage(cfg: Pick<BgConfig, 'gradType' | 'gradPos'>, angle: number, colors: string[]): string {
  // radial 用 ellipse(椭圆):圆心在角落时也能铺满全屏;circle 会把亮色挤到一角,屏幕其余部分只剩最外圈色
  if (cfg.gradType === 'radial') return `radial-gradient(ellipse at ${cfg.gradPos}, ${colors.join(', ')})`;
  // conic:把第一个色重复接到末尾闭合环,消除首尾相接处的拼接线(360° 环绕必经的硬边)
  if (cfg.gradType === 'conic') {
    const seamless = colors[colors.length - 1] === colors[0] ? colors : [...colors, colors[0]];
    return `conic-gradient(from ${angle}deg at ${cfg.gradPos}, ${seamless.join(', ')})`;
  }
  return `linear-gradient(${angle}deg, ${colors.join(', ')})`;
}

/** 取/建底图元素；挂在应用背景层，始终位于通用滤镜下方。 */
function ensureElement(cfg: BgConfig): HTMLElement | null {
  const el = backgroundElement;
  if (!el) return null;
  if (cfg.mode === 'none' || cfg.mode === 'mask' || resolveBackgroundSource(store.state.localStorage.preferences) !== 'color') {
    el.style.visibility = 'hidden';
    return null;
  }
  el.style.visibility = 'visible';
  return el;
}

/** 渐变遮罩:单个纯色的透明度渐变 — 先是一块不透明实色(占比 maskSolidPct),再经 1/6 宽度并放宽 30%→再宽 20% 的过渡带从 100% 渐隐到 0,
 *  之后为纯透明区。位移用 background-position 平移,旋转用渐变角度。 */
function buildMaskImage(cfg: Pick<BgConfig, 'gradType' | 'gradPos' | 'maskSolidPct'>, angle: number, color: string): string {
  const pct = Math.min(Math.max(cfg.maskSolidPct ?? 40, 0), 100);
  // 渐变端(过渡带):压缩为原来的 1/6,再放宽 30%(×1.3)后又宽 20%(×1.2)=×1.56;fadeEnd 处即完全透明,其后是纯透明区
  const fadeEnd = pct + ((100 - pct) / 6) * 1.56;
  if (cfg.gradType === 'radial') return `radial-gradient(ellipse at ${cfg.gradPos}, ${color} ${pct}%, transparent ${fadeEnd}%)`;
  // conic:实色楔形居中,两侧渐隐(各为 1/6 并放宽 30%→再宽 20%),首尾(0%/100%)都是透明 → 无缝
  if (cfg.gradType === 'conic') {
    const half = Math.min(pct, 50);
    const f = (half / 6) * 1.56;
    return `conic-gradient(from ${angle}deg at ${cfg.gradPos}, transparent 0%, ${color} ${f}%, ${color} ${100 - f}%, transparent 100%)`;
  }
  return `linear-gradient(${angle}deg, ${color} ${pct}%, transparent ${fadeEnd}%)`;
}

/** 清除遮罩专属的 background-size/position(切回其他模式时) */
function clearMaskBg(el: HTMLElement) {
  el.style.backgroundSize = '';
  el.style.backgroundPosition = '';
  el.style.backgroundRepeat = '';
}

/** 遮罩背景图尺寸(%),决定平移余量(每侧 (SIZE-100)/2 % 视口)。 */
const MASK_BG_SIZE = 160;

/** 按当前窗口尺寸钳制平移量:余量随窗口缩放,固定 px 偏移在窗口变窄时会超出 → 渐变图边缘露出。 */
function clampMaskPan(offset: number, viewport: number): number {
  const limit = ((MASK_BG_SIZE - 100) / 200) * viewport;
  return Math.max(-limit, Math.min(limit, offset));
}

/** 静态路径(动画关闭时的低开销行为,保持现有语义) */
function applyStatic() {
  const el = ensureElement(config);
  if (!el) return;
  el.style.filter = '';
  el.style.opacity = String(config.opacity / 100);
  if (config.mode === 'solid') {
    el.style.background = config.autoColor && autoSolid ? autoSolid : config.solid;
    el.style.backgroundImage = '';
    clearMaskBg(el);
  } else if (config.mode === 'mask') {
    el.style.background = '';
    const color = config.autoColor && autoSolid ? autoSolid : config.solid;
    el.style.backgroundImage = buildMaskImage(config, config.gradAngle, color);
    // 背景图放大 MASK_BG_SIZE% 提供平移余量;但余量随窗口缩放,固定 px 偏移在窗口变窄时会超出 → 按当前窗口钳制
    el.style.backgroundSize = `${MASK_BG_SIZE}% ${MASK_BG_SIZE}%`;
    const vw = window.innerWidth || 1;
    const vh = window.innerHeight || 1;
    el.style.backgroundPosition = `calc(50% + ${clampMaskPan(config.maskX, vw)}px) calc(50% + ${clampMaskPan(config.maskY, vh)}px)`;
    el.style.backgroundRepeat = 'no-repeat';
  } else {
    el.style.background = '';
    const colors = config.autoColor && autoColors?.length ? autoColors : config.gradColors;
    el.style.backgroundImage = buildGradientImage(config, config.gradAngle, colors);
    clearMaskBg(el);
  }
}

// ── rAF 循环(animate / beatSync) ────────────────────────────────

function needsRaf(): boolean {
  return !document.hidden && config.mode === 'gradient' && resolveBackgroundSource(store.state.localStorage.preferences) === 'color' && (config.animate || config.beatSync) && !isReducedMotion();
}

function startRaf() {
  if (rafId == null) {
    rafStart = performance.now();
    rafId = requestAnimationFrame(tick);
  }
}

function stopRaf() {
  if (rafId != null) {
    cancelAnimationFrame(rafId);
    rafId = null;
  }
}

function syncAnimations() {
  if (needsRaf()) startRaf();
  else stopRaf();
}

function tick(ts: number) {
  if (rafId == null) return;
  if (!needsRaf()) { stopRaf(); return; }
  const el = ensureElement(config);
  if (el) {
    const reduced = isReducedMotion();
    // 角度:animate 仅对 linear/conic 有效(radial 无角度概念)
    let angle = config.gradAngle;
    if (config.animate && !reduced && config.gradType !== 'radial') {
      angle = (config.gradAngle + ((ts - rafStart) / 1000) * ANIM_DEG_PER_SEC) % 360;
    }
    if (config.mode === 'mask') {
      const color = config.autoColor && autoSolid ? autoSolid : config.solid;
      el.style.background = '';
      el.style.backgroundImage = buildMaskImage(config, angle, color);
      el.style.backgroundSize = `${MASK_BG_SIZE}% ${MASK_BG_SIZE}%`;
      const vw = window.innerWidth || 1;
      const vh = window.innerHeight || 1;
      el.style.backgroundPosition = `calc(50% + ${clampMaskPan(config.maskX, vw)}px) calc(50% + ${clampMaskPan(config.maskY, vh)}px)`;
      el.style.backgroundRepeat = 'no-repeat';
    } else {
      const colors = config.autoColor && autoColors?.length ? autoColors : config.gradColors;
      el.style.backgroundImage = buildGradientImage(config, angle, colors);
      clearMaskBg(el);
    }

    // 透明度:仅由用户滑块决定(节拍不再压暗透明度)
    el.style.opacity = String(config.opacity / 100);
    // 亮度:跟随节拍脉动 — 拍点 brightness 变亮闪光,静止时恢复原样(不调透明度)
    if (config.beatSync && !reduced) {
      const p = getBeatPulse();
      el.style.filter = p >= 0.05 ? `brightness(${1 + 0.35 * p})` : '';
    } else {
      el.style.filter = '';
    }
  }
  rafId = requestAnimationFrame(tick);
}

// ── autoColor: 封面取色 ─────────────────────────────────────────

/** artworkPath 可能是 file:// 或 http URL,也可能是裸路径 → 统一转可加载 src */
function toImageSrc(path?: string): string | undefined {
  if (!path) return undefined;
  if (/^(https?:|file:)/i.test(path)) return path;
  return `file:///${path.replace(/\\/g, '/')}`;
}

function deriveFromPalette(pal: NodeVibrantPalette): string[] | null {
  const pick = (names: (keyof NodeVibrantPalette)[]): string[] =>
    names.map((n) => pal[n]?.hex).filter((x): x is string => !!x);
  const colors = pick(['DarkVibrant', 'Vibrant', 'LightVibrant']);
  if (colors.length >= 2) return colors;
  const muted = pick(['DarkMuted', 'Muted', 'LightMuted']);
  return muted.length >= 2 ? muted : null;
}

/** 纯色模式取封面主色:优先 Vibrant,依次回退到 muted 系 */
function deriveSolidFromPalette(pal: NodeVibrantPalette): string | null {
  const order: (keyof NodeVibrantPalette)[] = ['Vibrant', 'LightVibrant', 'DarkVibrant', 'Muted', 'LightMuted', 'DarkMuted'];
  for (const n of order) {
    if (pal[n]?.hex) return pal[n].hex;
  }
  return null;
}

function deriveFromDominant(hex: string): string[] {
  const { h, s, l } = hexToHsl(hex);
  return [
    `hsl(${h} ${Math.round(s * 0.9)}% ${Math.round(l * 0.45)}%)`,
    `hsl(${h} ${s}% ${l}%)`,
    `hsl(${h} ${Math.round(s * 0.8)}% ${Math.min(l + 22, 86)}%)`,
  ];
}

async function refreshAutoColor() {
  const token = ++autoToken;
  const art = store.state.currentSongData?.artworkPath;
  if (!art) {
    autoColors = null;
    autoSolid = null;
    if (config.autoColor) applyStatic();
    return;
  }
  // 首选:主进程预计算的 NodeVibrant 调色板(同步,无需 canvas)
  const pal = store.state.currentSongData?.paletteData;
  if (pal) {
    const derived = deriveFromPalette(pal);
    if (derived) {
      autoColors = derived;
      autoSolid = deriveSolidFromPalette(pal);
      if (config.autoColor) applyStatic();
      return;
    }
  }
  // 回退:canvas 平均色 + HSL 派生变体
  const src = toImageSrc(art);
  if (!src) return;
  const hex = await extractDominantColor(src);
  if (token !== autoToken) return; // 过期结果丢弃
  autoColors = hex ? deriveFromDominant(hex) : null;
  autoSolid = hex;
  if (config.autoColor) applyStatic();
}

/** 启动调用:读配置、同步动画、应用背景、注册切歌监听。一次即可(防 StrictMode 重复)。 */
export function initColorBackground() {
  if (started) return;
  started = true;
  document.addEventListener('visibilitychange', syncAnimations);
  applyColorBackground();
  // 窗口尺寸变化时余量随之缩放 → 重算遮罩平移钳制,防渐变图边缘露出(applyStatic 读模块 config,不触发取色)
  window.addEventListener('resize', () => {
    if (config.mode === 'mask') applyStatic();
  });
  lastArtwork = store.state.currentSongData?.artworkPath ?? null;
  store.subscribe((s) => {
    const sub = s as unknown as { currentVal?: typeof store.state };
    const current = sub?.currentVal ?? s;
    const art = current.currentSongData?.artworkPath ?? null;
    if (art !== lastArtwork) {
      lastArtwork = art;
      if (config.autoColor && config.mode !== 'none') refreshAutoColor();
    }
  });
}

/** 应用当前配置(读取 LS → 刷 config → 启停 rAF → 静态应用 → autoColor 首次取色)。 */
export function applyColorBackground() {
  const next = readConfig();
  // A selected background source must render even before its settings editor mounts.
  if (resolveBackgroundSource(store.state.localStorage.preferences) === 'color' &&
      next.mode !== 'solid' && next.mode !== 'gradient') {
    next.mode = 'gradient';
    try { localStorage.setItem(LS_KEY, JSON.stringify(next)); } catch { /* storage unavailable */ }
  }
  if (JSON.stringify(config) !== JSON.stringify(next)) {
    config = next;
    configListeners.forEach((listener) => listener());
  }
  syncAnimations();
  applyStatic();
  if (config.autoColor && config.mode !== 'none') refreshAutoColor();
}

/** Hide the React-owned layer without detaching its node. */
export function removeColorBackground() {
  stopRaf();
  if (backgroundElement) backgroundElement.style.visibility = 'hidden';
}

/** Disable the solid/gradient overlay and persist mode='none' (e.g. frosted-glass background). */
export function disableColorBackground() {
  try {
    const saved = JSON.parse(localStorage.getItem(LS_KEY) || '{}');
    localStorage.setItem(LS_KEY, JSON.stringify({ ...saved, mode: 'none' }));
  } catch { /* ignore */ }
  config = readConfig(); // mode 已变 'none',避免运行中 rAF 用旧 config 重建元素
  configListeners.forEach((listener) => listener());
  removeColorBackground();
}

// ── React hook ───────────────────────────────────────────────────

/** 纯色/渐变背景状态 + 持久化 + 应用(主设置与全屏设置共用同一份 localStorage 状态)。 */
export function useColorBackground() {
  const saved = useSyncExternalStore(subscribeConfig, getConfigSnapshot, getConfigSnapshot);
  return { ...saved, ...configSetters };
}

function configSetter<K extends keyof BgConfig>(key: K) {
  return (value: SetStateAction<BgConfig[K]>) => {
    const next = typeof value === 'function'
      ? (value as (previous: BgConfig[K]) => BgConfig[K])(config[key]) : value;
    config = { ...config, [key]: next };
    try { localStorage.setItem(LS_KEY, JSON.stringify(config)); } catch { /* storage unavailable */ }
    configListeners.forEach((listener) => listener());
    syncAnimations();
    applyStatic();
    if (config.autoColor && config.mode !== 'none') void refreshAutoColor();
  };
}

const configSetters = {
  setMode: configSetter('mode'), setSolid: configSetter('solid'),
  setGradType: configSetter('gradType'), setGradColors: configSetter('gradColors'),
  setGradAngle: configSetter('gradAngle'), setGradPos: configSetter('gradPos'),
  setOpacity: configSetter('opacity'), setAutoColor: configSetter('autoColor'),
  setAnimate: configSetter('animate'), setBeatSync: configSetter('beatSync'),
  setMaskX: configSetter('maskX'), setMaskY: configSetter('maskY'),
  setMaskSolidPct: configSetter('maskSolidPct'),
};

// ── 预设 / 随机 ─────────────────────────────────────────────────

const PRESETS: { name: string; gradType: GradType; gradPos: string; gradAngle: number; gradColors: string[] }[] = [
  { name: '午夜蓝', gradType: 'linear', gradPos: 'center', gradAngle: 135, gradColors: ['#0f2027', '#203a43', '#2c5364'] },
  { name: '熔岩橙', gradType: 'linear', gradPos: 'center', gradAngle: 45, gradColors: ['#ff512f', '#f09819'] },
  { name: '糖果粉', gradType: 'linear', gradPos: 'center', gradAngle: 90, gradColors: ['#f857a6', '#ff5858'] },
  { name: '极光绿', gradType: 'radial', gradPos: 'center', gradAngle: 0, gradColors: ['#11998e', '#38ef7d'] },
  { name: '深海蓝', gradType: 'radial', gradPos: 'top', gradAngle: 0, gradColors: ['#0b486b', '#3b8686', '#79bd9a'] },
  { name: '赛博紫', gradType: 'conic', gradPos: 'center', gradAngle: 180, gradColors: ['#7f00ff', '#e100ff'] },
  { name: '晚霞紫', gradType: 'conic', gradPos: 'top', gradAngle: 45, gradColors: ['#6a3093', '#a044ff', '#5e9de6'] },
  { name: '冷冽灰', gradType: 'linear', gradPos: 'center', gradAngle: 0, gradColors: ['#232526', '#414345'] },
];

/** hsl → hex(供随机配色与取色器使用;input[type=color] 只接受 hex) */
function hslToHex(h: number, s: number, l: number): string {
  s /= 100;
  l /= 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const c = l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
    return Math.round(255 * c).toString(16).padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

/** 随机生成 3-5 个和谐配色(类似色相偏移 + 明度递增)+ 随机角度/位置 */
export function randomizeGradient() {
  const h = Math.floor(Math.random() * 360);
  const count = 3 + Math.floor(Math.random() * 3);
  const colors = Array.from({ length: count }, (_, i) =>
    hslToHex((h + i * 36) % 360, 55 + Math.floor(Math.random() * 15), 22 + i * 12)
  );
  return {
    gradColors: colors,
    gradAngle: Math.floor(Math.random() * 360),
    gradPos: POSITIONS[Math.floor(Math.random() * 5)], // center/top/bottom/left/right
  };
}

/** 开关按钮(主设置 settings / 全屏 fullscreen 两套样式,labelClass 由调用方提供) */
export function BgSwitch({
  checked, onChange, disabled, text, variant, labelClass,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  text: string;
  variant: 'settings' | 'fullscreen';
  labelClass: string;
}) {
  const isFS = variant === 'fullscreen';
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`flex w-full cursor-pointer items-center justify-between py-0.5 text-left ${disabled ? 'opacity-40' : ''}`}
    >
      <span className={labelClass}>{text}</span>
      <span className={`relative h-4 w-8 shrink-0 rounded-full transition-colors ${checked ? 'bg-font-color-highlight dark:bg-dark-font-color-highlight' : isFS ? 'bg-white/20' : 'bg-font-color-highlight/20'}`}>
        <span className={`absolute top-0.5 left-0.5 h-3 w-3 rounded-full bg-white transition-transform ${checked ? 'translate-x-4' : ''}`} />
      </span>
    </button>
  );
}

// ── 共享渐变编辑控件(主设置 + 全屏设置,仅样式不同) ──────────────

type ColorBg = ReturnType<typeof useColorBackground>;
type MaskBg = Pick<ColorBg, 'solid' | 'gradAngle' | 'maskX' | 'maskSolidPct' | 'opacity' | 'autoColor'> & {
  setSolid: (value: string) => void;
  setGradAngle: (value: number) => void;
  setMaskX: (value: number) => void;
  setMaskSolidPct: (value: number) => void;
  setOpacity: (value: number) => void;
  setAutoColor: (value: boolean) => void;
};

/** 渐变模式下的编辑器:类型/取色/角度/位置/透明度/动画/节拍/预设/随机 */
export function GradientBgEditor({ bg, variant }: { bg: ColorBg; variant: 'settings' | 'fullscreen' }) {
  const isFS = variant === 'fullscreen';
  const btn = (active: boolean) =>
    isFS
      ? `flex-1 cursor-pointer rounded py-1.5 text-xs transition-all ${active ? 'bg-font-color-highlight dark:bg-dark-font-color-highlight text-white' : 'bg-white/10 text-white/50 hover:bg-white/20'}`
      : `flex-1 py-1.5 rounded text-xs cursor-pointer transition-all ${active ? 'bg-font-color-highlight dark:bg-dark-font-color-highlight text-white' : 'bg-font-color-highlight/20 text-font-color-black/60 dark:text-font-color-white/60 hover:bg-font-color-highlight/30'}`;
  const label = isFS ? 'text-xs text-white/70' : 'text-sm text-font-color-black/70 dark:text-font-color-white/70';
  const hint = isFS ? 'text-xs text-white/50' : 'text-sm text-font-color-black/50 dark:text-font-color-white/50';
  const slider = isFS
    ? 'h-1 w-full cursor-pointer appearance-none rounded-full bg-white/20 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white'
    : 'h-1 w-full max-w-xs cursor-pointer appearance-none rounded-full bg-font-color-highlight/20 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-font-color-highlight';
  const colorInput = 'h-6 w-8 cursor-pointer rounded border-0 bg-transparent p-0';

  const miniBtn = isFS
    ? 'cursor-pointer rounded bg-white/10 px-2 py-1 text-xs text-white/40 hover:bg-white/20 hover:text-white'
    : 'rounded bg-font-color-highlight/10 px-2 py-1 text-xs text-font-color-black/40 dark:text-font-color-white/40 hover:text-font-color-highlight';
  const delBtn = isFS
    ? 'cursor-pointer text-xs text-white/30 hover:text-red-400'
    : 'text-xs text-font-color-black/30 dark:text-font-color-white/30 hover:text-red-400';

  return (
    <>
      {/* 渐变类型 */}
      <div>
        <div className={label + ' mb-1'}>渐变类型</div>
        <div className="flex gap-1.5">
          {(['linear', 'radial', 'conic'] as const).map((t) => (
            <button key={t} className={btn(bg.gradType === t)} onClick={() => bg.setGradType(t)}>
              {t === 'linear' ? '线性' : t === 'radial' ? '径向' : '锥形'}
            </button>
          ))}
        </div>      </div>

      {/* 自动取色 */}
      <BgSwitch checked={bg.autoColor} onChange={bg.setAutoColor} text="跟随封面取色" variant={variant} labelClass={label} />
      {bg.autoColor && <div className={hint}>颜色由当前歌曲封面自动生成</div>}

      {/* 色标编辑(自动取色时隐藏) */}
      {!bg.autoColor && (
        <div className="flex items-center gap-2">
          {bg.gradColors.map((c, i) => (
            <div key={i} className="flex items-center gap-1">
              <input
                type="color"
                value={c}
                onChange={(e) => {
                  const next = [...bg.gradColors];
                  next[i] = e.target.value;
                  bg.setGradColors(next);
                }}
                className={colorInput}
              />
              {bg.gradColors.length > 2 && (
                <button className={delBtn} onClick={() => bg.setGradColors(bg.gradColors.filter((_, j) => j !== i))}>
                  ✕
                </button>
              )}
            </div>
          ))}
          {bg.gradColors.length < 5 && (
            <button className={miniBtn} onClick={() => bg.setGradColors([...bg.gradColors, '#ffffff'])}>
              +
            </button>
          )}
        </div>
      )}

      {/* 线性渐变方向 */}
      <div>
        <div className={label + ' mb-1 flex justify-between'}>
          <span>角度</span>
          <span className="opacity-60">{bg.gradAngle}°</span>
        </div>
        <input
          type="range"
          min={0}
          max={360}
          value={bg.gradAngle}
          onChange={(e) => bg.setGradAngle(Number(e.target.value))}
          className={slider}
        />
      </div>

      {/* 位置(radial/conic) */}
      {(bg.gradType === 'radial' || bg.gradType === 'conic') && (
        <div>
          <div className={label + ' mb-1'}>位置</div>
          <div className="grid grid-cols-5 gap-1">
            {POSITIONS.map((p) => (
              <button key={p} className={btn(bg.gradPos === p)} onClick={() => bg.setGradPos(p)}>
                {POSITION_LABELS[p] ?? p}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* 透明度 */}
      <div>
        <div className={label + ' mb-1 flex justify-between'}>
          <span>透明度</span>
          <span className="opacity-60">{bg.opacity}%</span>
        </div>
        <input
          type="range"
          min={0}
          max={100}
          value={bg.opacity}
          onChange={(e) => bg.setOpacity(Number(e.target.value))}
          className={slider}
        />
      </div>

      {/* 动画开关 */}
      <BgSwitch checked={bg.animate} onChange={bg.setAnimate} disabled={bg.gradType === 'radial'} text="角度缓慢旋转" variant={variant} labelClass={label} />
      <BgSwitch checked={bg.beatSync} onChange={bg.setBeatSync} text="跟随节拍脉动" variant={variant} labelClass={label} />

      {bg.beatSync && <div className={hint}>节拍强时背景变亮(闪光)</div>}

      {/* 预设 + 随机 */}
      <div>
        <div className={label + ' mb-1'}>预设</div>
        <div className="flex flex-wrap gap-1.5">
          {PRESETS.map((p) => (
            <button
              key={p.name}
              title={p.name}
              className="h-7 w-12 cursor-pointer rounded border border-white/10"
              style={{ backgroundImage: buildGradientImage(p, p.gradAngle, p.gradColors) }}
              onClick={() => {
                bg.setGradType(p.gradType);
                bg.setGradColors(p.gradColors);
                bg.setGradAngle(p.gradAngle);
                bg.setGradPos(p.gradPos);
                bg.setAutoColor(false);
              }}
            />
          ))}
        </div>
        <button
          className={miniBtn + ' mt-1.5'}
          onClick={() => {
            const r = randomizeGradient();
            bg.setGradColors(r.gradColors);
            bg.setGradAngle(r.gradAngle);
            bg.setGradPos(r.gradPos);
            bg.setAutoColor(false);
          }}
        >
          随机配色
        </button>
      </div>
    </>
  );
}

/** 线性遮罩编辑器：颜色、角度、水平位置和透明度。 */
export function MaskBgEditor({ bg, variant }: { bg: MaskBg; variant: 'settings' | 'fullscreen' }) {
  const isFS = variant === 'fullscreen';
  const label = isFS ? 'text-xs text-white/70' : 'text-sm text-font-color-black/70 dark:text-font-color-white/70';
  const hint = isFS ? 'text-xs text-white/50' : 'text-sm text-font-color-black/50 dark:text-font-color-white/50';
  const slider = isFS
    ? 'h-1 w-full cursor-pointer appearance-none rounded-full bg-white/20 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white'
    : 'h-1 w-full max-w-xs cursor-pointer appearance-none rounded-full bg-font-color-highlight/20 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-font-color-highlight';
  const colorInput = 'h-6 w-8 cursor-pointer rounded border-0 bg-transparent p-0';

  return (
    <>
      {/* 遮罩颜色(纯色) */}
      <div className="flex items-center justify-between gap-2">
        <span className={label}>遮罩颜色</span>
        <input
          type="color"
          value={bg.solid}
          onChange={(e) => bg.setSolid(e.target.value)}
          className={colorInput}
        />
      </div>
      <BgSwitch checked={bg.autoColor} onChange={bg.setAutoColor} text="跟随封面取色" variant={variant} labelClass={label} />
      {bg.autoColor && <div className={hint}>颜色由当前歌曲封面自动生成</div>}


      {/* 实色占比:不透明实色块占渐变轴的比例(0 = 立即渐隐,100 = 整块不透明) */}
      <div>
        <div className={label + ' mb-1 flex justify-between'}>
          <span>实色占比</span>
          <span className="opacity-60">{bg.maskSolidPct}%</span>
        </div>
        <input
          type="range"
          min={0}
          max={100}
          value={bg.maskSolidPct}
          onChange={(e) => bg.setMaskSolidPct(Number(e.target.value))}
          className={slider}
        />
      </div>

      <div>
        <div className={label + ' mb-1 flex justify-between'}><span>角度</span><span className="opacity-60">{bg.gradAngle}°</span></div>
        <input type="range" min={0} max={360} value={bg.gradAngle}
          onChange={(e) => bg.setGradAngle(Number(e.target.value))} className={slider} />
      </div>

      {/* 水平位置 */}
      <div>
        <div className={label + ' mb-1 flex justify-between'}>
          <span>X 位置</span>
          <span className="opacity-60">{bg.maskX}px</span>
        </div>
        <input
          type="range"
          min={-400}
          max={400}
          value={bg.maskX}
          onChange={(e) => bg.setMaskX(Number(e.target.value))}
          className={slider}
        />
      </div>

      {/* 透明度 */}
      <div>
        <div className={label + ' mb-1 flex justify-between'}>
          <span>透明度</span>
          <span className="opacity-60">{bg.opacity}%</span>
        </div>
        <input
          type="range"
          min={0}
          max={100}
          value={bg.opacity}
          onChange={(e) => bg.setOpacity(Number(e.target.value))}
          className={slider}
        />
      </div>


    </>
  );
}

/** 主设置页用的纯色/渐变背景控件(全屏设置页复用 useColorBackground 自行排版)。 */
export function BgColorControls({ baseOnly = false }: { baseOnly?: boolean }) {
  const bg = useColorBackground();
  const { mode, setMode } = bg;

  useEffect(() => {
    if (baseOnly && mode !== 'solid' && mode !== 'gradient') setMode('gradient');
  }, [baseOnly, mode, setMode]);

  return (
    <>
      <div className="description">纯色 / 渐变背景</div>
      <div className="mt-3 space-y-3 pl-2">
        <div className="flex gap-1.5">
          {(baseOnly ? ['solid', 'gradient'] as const : ['none', 'solid', 'gradient', 'mask'] as const).map((k) => (
            <button key={k} className={`flex-1 py-1.5 rounded text-xs cursor-pointer transition-all ${bg.mode === k ? 'bg-font-color-highlight dark:bg-dark-font-color-highlight text-white' : 'bg-font-color-highlight/20 text-font-color-black/60 dark:text-font-color-white/60 hover:bg-font-color-highlight/30'}`}
              onClick={() => bg.setMode(k)}
            >{k === 'none' ? '无' : k === 'solid' ? '纯色' : k === 'mask' ? '遮罩' : '渐变'}</button>
          ))}
        </div>
        {bg.mode === 'solid' && (
          <div className="space-y-1.5">
            <BgSwitch
              checked={bg.autoColor}
              onChange={bg.setAutoColor}
              text="跟随封面取色"
              variant="settings"
              labelClass="text-sm text-font-color-black/70 dark:text-font-color-white/70"
            />
            {bg.autoColor ? (
              <div className="text-sm text-font-color-black/50 dark:text-font-color-white/50">颜色由当前歌曲封面自动生成</div>
            ) : (
              <div className="flex items-center gap-2">
                <input type="color" value={bg.solid} onChange={(e) => bg.setSolid(e.target.value)}
                  className="h-6 w-8 cursor-pointer rounded border-0 bg-transparent p-0" />
                <span className="text-sm text-font-color-black/70 dark:text-font-color-white/70">背景颜色</span>
              </div>
            )}
          </div>
        )}
        {bg.mode === 'gradient' && <GradientBgEditor bg={bg} variant="settings" />}
        {bg.mode === 'mask' && <MaskBgEditor bg={bg} variant="settings" />}
      </div>
    </>
  );
}
