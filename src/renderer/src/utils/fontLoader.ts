/**
 * Font management — built-in Google Fonts + bundled local fonts + custom font import.
 * All fonts support both Chinese (CJK) and Latin scripts.
 */

export interface FontDef {
  id: string;
  name: string;
  nameZh: string;
  category: string;
  googleFamily: string;   // Google Fonts family name for CSS @import; local fonts use the font-family name
  isLocal?: boolean;       // true for bundled local .ttf/.otf fonts (skip Google Fonts loading)
}

// ── Bundled local font imports (Vite returns asset URLs) ──────────

import chaozisheUrl from '@assets/fonts/chaozishe-bawang.ttf';
import fuluUrl from '@assets/fonts/fulu-hechati.ttf';
import shanhaiUrl from '@assets/fonts/shanhai-xingqiu.ttf';
import yishanUrl from '@assets/fonts/yishan-beizhuan.ttf';
import zihunUrl from '@assets/fonts/zihun-jianqi.ttf';
import zikuUrl from '@assets/fonts/ziku-gufeng.ttf';
import { fontReady } from './fontReady';
import douyuUrl from '@assets/fonts/douyu.otf';
import cubic11Url from '@assets/fonts/cubic-11.ttf';
import jiyingUrl from '@assets/fonts/jiying-huisong.ttf';
import sweiUrl from '@assets/fonts/swei-fist-leg.ttf';
import tpUrl from '@assets/fonts/tp.otf';
import hanyiCaiyunUrl from '@assets/fonts/hanyi-caiyun.ttf';
import hanyiTijianUrl from '@assets/fonts/hanyi-tijian.ttf';
import sanjiDiejiaheiUrl from '@assets/fonts/sanji-diejiahei.ttf';
import sanjiLitiheiUrl from '@assets/fonts/sanji-litihei.ttf';
import zihunQingfengUrl from '@assets/fonts/zihun-qingfeng.ttf';
import pingfangUrl from '@assets/fonts/pingfang.ttf';

/** Local fonts bundled with the app — injected via @font-face on startup. */
export const LOCAL_FONTS: FontDef[] = [
  {
    id: 'chaozishe-bawang',
    name: '潮字社霸王破风手迹',
    nameZh: '霸王破风',
    category: '书法 / 霸气体',
    googleFamily: '潮字社霸王破风手迹',
    isLocal: true,
  },
  {
    id: 'fulu-hechati',
    name: '福禄灵感喝茶体',
    nameZh: '喝茶体',
    category: '可爱 / 圆体',
    googleFamily: '福禄灵感喝茶体',
    isLocal: true,
  },
  {
    id: 'shanhai-xingqiu',
    name: '山海潮玩星球',
    nameZh: '潮玩星球',
    category: '创意 / 潮玩',
    googleFamily: '山海潮玩星球',
    isLocal: true,
  },
  {
    id: 'yishan-beizhuan',
    name: '衣衫碑篆体',
    nameZh: '碑篆体',
    category: '篆书 / 碑刻',
    googleFamily: '衣衫碑篆体',
    isLocal: true,
  },
  {
    id: 'zihun-jianqi',
    name: '字魂剑气手书',
    nameZh: '剑气手书',
    category: '手书 / 锐利',
    googleFamily: '字魂剑气手书',
    isLocal: true,
  },
  {
    id: 'ziku-gufeng',
    name: '字库江湖古风体',
    nameZh: '江湖古风',
    category: '古风 / 江湖',
    googleFamily: '字库江湖古风体',
    isLocal: true,
  },
  {
    id: 'douyu',
    name: '斗鱼字体',
    nameZh: '斗鱼体',
    category: '电竞 / 锐利',
    googleFamily: '斗鱼字体',
    isLocal: true,
  },
  {
    id: 'cubic-11',
    name: 'Cubic 11',
    nameZh: 'Cubic 11',
    category: '像素 / 等宽',
    googleFamily: 'Cubic 11',
    isLocal: true,
  },
  {
    id: 'jiying-huisong',
    name: '汲英慧片惠宋',
    nameZh: '汲英慧宋',
    category: '宋体 / 雅致',
    googleFamily: '汲英慧片惠宋',
    isLocal: true,
  },
  {
    id: 'swei-fist-leg',
    name: 'Swei Fist Leg CJKjp',
    nameZh: 'Swei Fist Leg',
    category: '创意 / 手写',
    googleFamily: 'Swei Fist Leg CJKjp',
    isLocal: true,
  },
  {
    id: 'tp',
    name: 'TP字体',
    nameZh: 'TP字体',
    category: '创意 / 装饰',
    googleFamily: 'TP字体',
    isLocal: true,
  },
  {
    id: 'pingfang',
    name: '苹方字体',
    nameZh: '苹方',
    category: '默认 / 无衬线',
    googleFamily: '苹方字体',
    isLocal: true,
  },
  {
    id: 'hanyi-caiyun',
    name: '汉仪彩云体简',
    nameZh: '汉仪彩云',
    category: '艺术 / 彩云',
    googleFamily: '汉仪彩云体简',
    isLocal: true,
  },
  {
    id: 'hanyi-tijian',
    name: '汉仪体简',
    nameZh: '汉仪体简',
    category: '简约 / 现代',
    googleFamily: '汉仪体简',
    isLocal: true,
  },
  {
    id: 'sanji-diejiahei',
    name: '三级叠加黑',
    nameZh: '叠加黑',
    category: '黑体 / 叠加',
    googleFamily: '三级叠加黑',
    isLocal: true,
  },
  {
    id: 'sanji-litihei',
    name: '三级立体极黑简体',
    nameZh: '立体极黑',
    category: '黑体 / 立体',
    googleFamily: '三级立体极黑简体',
    isLocal: true,
  },
  {
    id: 'zihun-qingfeng',
    name: '字魂81号清风体',
    nameZh: '清风体',
    category: '手写 / 清风',
    googleFamily: '字魂81号清风体',
    isLocal: true,
  },
];

/** Map of font name → asset URL for bundled local fonts. */
const LOCAL_FONT_URLS: Record<string, string> = {
  '潮字社霸王破风手迹': chaozisheUrl,
  '福禄灵感喝茶体': fuluUrl,
  '山海潮玩星球': shanhaiUrl,
  '衣衫碑篆体': yishanUrl,
  '字魂剑气手书': zihunUrl,
  '字库江湖古风体': zikuUrl,
  '斗鱼字体': douyuUrl,
  'Cubic 11': cubic11Url,
  '汲英慧片惠宋': jiyingUrl,
  'Swei Fist Leg CJKjp': sweiUrl,
  'TP字体': tpUrl,
  '苹方字体': pingfangUrl,
  '汉仪彩云体简': hanyiCaiyunUrl,
  '汉仪体简': hanyiTijianUrl,
  '三级叠加黑': sanjiDiejiaheiUrl,
  '三级立体极黑简体': sanjiLitiheiUrl,
  '字魂81号清风体': zihunQingfengUrl,
};

/**
 * Inject @font-face rules for all bundled local fonts.
 * Call once on app startup (FontSettings useEffect).
 */
export function initLocalFonts(): FontDef[] {
  for (const font of LOCAL_FONTS) {
    const url = LOCAL_FONT_URLS[font.name];
    if (!url) continue;
    const style = document.createElement('style');
    style.dataset.bundledFont = font.name;
    style.textContent = `@font-face { font-family: "${font.name}"; src: url("${url}"); }`;
    document.head.appendChild(style);
  }
  return LOCAL_FONTS;
}

// Built-in fonts from Google Fonts (all OFL-licensed, CJK+Latin)
export const BUILTIN_FONTS: FontDef[] = [
  {
    id: 'ma-shan-zheng',
    name: 'Ma Shan Zheng',
    nameZh: '马山正',
    category: '书法 / 豪放',
    googleFamily: 'Ma+Shan+Zheng',
  },
  {
    id: 'zcool-qingke',
    name: 'ZCOOL QingKe HuangYou',
    nameZh: '站酷庆科黄油体',
    category: '像素 / 趣味',
    googleFamily: 'ZCOOL+QingKe+HuangYou',
  },
  {
    id: 'zcool-xiaowei',
    name: 'ZCOOL XiaoWei',
    nameZh: '站酷小薇',
    category: '现代 / 手写',
    googleFamily: 'ZCOOL+XiaoWei',
  },
  {
    id: 'noto-sans-sc',
    name: 'Noto Sans SC',
    nameZh: '思源黑体',
    category: '简约 / 无衬线',
    googleFamily: 'Noto+Sans+SC',
  },
  {
    id: 'liu-jian-mao-cao',
    name: 'Liu Jian Mao Cao',
    nameZh: '刘建毛草',
    category: '草书 / 狂放',
    googleFamily: 'Liu+Jian+Mao+Cao',
  },
  {
    id: 'long-cang',
    name: 'Long Cang',
    nameZh: '龙藏体',
    category: '手写 / 随性',
    googleFamily: 'Long+Cang',
  },
];

// ── Persistence (native localStorage, not typed preferences) ─────

const LS_FONT_FAMILY = 'lumina_fontFamily';
const LS_FONT_SCOPE = 'lumina_fontScope';
const scopedFontKey = (scope: 'global' | 'lyrics') => `lumina_fontFamily_${scope}`;
const LS_CUSTOM_FONTS = 'lumina_customFonts';
const LS_FONT_WEIGHT = 'lumina_fontWeight';
const DEFAULT_FONT_WEIGHT = '700';
/** 支持的歌词字重:300 细 / 700 粗 */
const FONT_WEIGHTS = ['300', '700'];

/**
 * Resolve a stored font-family value to its CSS name.
 * Migrates old "+" format (Google Fonts API parameter) to real CSS name.
 */
export function resolveFontName(stored: string): string {
  // Already a real font name? Return as-is.
  if (!stored.includes('+')) return stored;
  // Old format — look up in built-in fonts
  const font = BUILTIN_FONTS.find(f => f.googleFamily === stored);
  if (font) {
    // Migrate to new format in-place
    try { localStorage.setItem(LS_FONT_FAMILY, font.name); } catch { /* storage unavailable */ }
    return font.name;
  }
  // Unknown +-format — replace + with space as best-guess fallback
  return stored.replace(/\+/g, ' ');
}

export function getSavedFont(): { family: string; scope: 'global' | 'lyrics' } | null {
  const lyrics = getSavedFontForScope('lyrics');
  if (lyrics) return { family: lyrics, scope: 'lyrics' };
  const global = getSavedFontForScope('global');
  if (global) return { family: global, scope: 'global' };
  return null;
}

export function getSavedFontForScope(scope: 'global' | 'lyrics'): string {
  try {
    const raw = localStorage.getItem(scopedFontKey(scope));
    if (raw) return resolveFontName(raw);
    if (localStorage.getItem(LS_FONT_SCOPE) === scope) {
      const legacy = localStorage.getItem(LS_FONT_FAMILY);
      if (legacy) return resolveFontName(legacy);
    }
  } catch { /* storage unavailable */ }
  return '';
}

/** 歌词字体优先使用独立选择，未设置时沿用界面字体。 */
export function getEffectiveLyricsFontName(): string {
  return getSavedFontForScope('lyrics') || getSavedFontForScope('global');
}

export function getStoredFontName(): string {
  return getSavedFont()?.family ?? '';
}

/** Save the CSS font-family name (not Google API parameter). */
export function saveFont(fontName: string, scope: 'global' | 'lyrics'): void {
  try {
    const otherScope = scope === 'global' ? 'lyrics' : 'global';
    const legacy = getSavedFontForScope(otherScope);
    if (legacy && !localStorage.getItem(scopedFontKey(otherScope))) {
      localStorage.setItem(scopedFontKey(otherScope), legacy);
    }
    localStorage.setItem(scopedFontKey(scope), fontName);
    localStorage.removeItem(LS_FONT_FAMILY);
    localStorage.removeItem(LS_FONT_SCOPE);
  } catch { /* storage unavailable */ }
}

export function clearSavedFont(scope?: 'global' | 'lyrics'): void {
  try {
    if (scope) localStorage.removeItem(scopedFontKey(scope));
    else {
      localStorage.removeItem(scopedFontKey('global'));
      localStorage.removeItem(scopedFontKey('lyrics'));
    }
    if (scope && localStorage.getItem(LS_FONT_SCOPE) !== scope) return;
    localStorage.removeItem(LS_FONT_FAMILY);
    localStorage.removeItem(LS_FONT_SCOPE);
  } catch { /* storage unavailable */ }
}

/** 歌词字重(本地存储)。默认 700(粗体)。旧版 6 档字重归一化:≤500 归细(300),>500 归粗(700)。 */
export function getSavedFontWeight(): string {
  try {
    const w = localStorage.getItem(LS_FONT_WEIGHT);
    if (w) {
      if (FONT_WEIGHTS.includes(w)) return w;
      const num = Number(w);
      if (!Number.isNaN(num)) return num <= 500 ? '300' : '700';
    }
  } catch { /* storage unavailable */ }
  return DEFAULT_FONT_WEIGHT;
}

export function saveFontWeight(weight: string): void {
  try {
    localStorage.setItem(LS_FONT_WEIGHT, weight);
  } catch { /* storage unavailable */ }
}

// ── Custom (imported) font persistence ───────────────────────────

interface CustomFontEntry {
  name: string;
  filePath: string; // original file path for re-injecting @font-face
}

export function getCustomFonts(): FontDef[] {
  try {
    const raw = localStorage.getItem(LS_CUSTOM_FONTS);
    if (!raw) return [];
    const entries: CustomFontEntry[] = JSON.parse(raw);
    return entries.map(e => ({
      id: e.name,
      name: e.name,
      nameZh: e.name,
      category: '自定义',
      googleFamily: e.name,
    }));
  } catch { return []; }
}

export function saveCustomFont(name: string, filePath: string): FontDef {
  try {
    const entries: CustomFontEntry[] = JSON.parse(localStorage.getItem(LS_CUSTOM_FONTS) || '[]');
    // Dedup by name
    const filtered = entries.filter(e => e.name !== name);
    filtered.push({ name, filePath });
    localStorage.setItem(LS_CUSTOM_FONTS, JSON.stringify(filtered));
  } catch { /* storage unavailable */ }
  return { id: name, name, nameZh: name, category: '自定义', googleFamily: name };
}

export function removeCustomFont(name: string): void {
  try {
    const entries: CustomFontEntry[] = JSON.parse(localStorage.getItem(LS_CUSTOM_FONTS) || '[]');
    localStorage.setItem(LS_CUSTOM_FONTS, JSON.stringify(entries.filter(e => e.name !== name)));
  } catch { /* storage unavailable */ }
}

/** Pure read of custom font entries — for cross-window sync (desktop lyrics). */
export function getCustomFontEntries(): { name: string; filePath: string }[] {
  try {
    const raw = localStorage.getItem(LS_CUSTOM_FONTS);
    if (!raw) return [];
    return JSON.parse(raw);
  } catch { return []; }
}

/** Built asset URL per bundled local font — desktop lyrics window injects @font-face from these. */
export function getLocalFontUrls(): Record<string, string> {
  return { ...LOCAL_FONT_URLS };
}

/** Re-inject all stored custom @font-face rules. Call on app init. */
export function restoreCustomFonts(): FontDef[] {
  try {
    const raw = localStorage.getItem(LS_CUSTOM_FONTS);
    if (!raw) return [];
    const entries: CustomFontEntry[] = JSON.parse(raw);
    for (const e of entries) {
      const fontUrl = `file:///${e.filePath.replace(/\\/g, '/')}`;
      const style = document.createElement('style');
      style.dataset.customFont = e.name;
      style.textContent = `@font-face { font-family: "${e.name}"; src: url("${fontUrl}"); }`;
      document.head.appendChild(style);
    }
    return entries.map(e => ({
      id: e.name,
      name: e.name,
      nameZh: e.name,
      category: '自定义',
      googleFamily: e.name,
    }));
  } catch { return []; }
}

// ── Google Fonts loading ──────────────────────────────────────────

const loadedFonts = new Set<string>();

export function loadGoogleFont(family: string): void {
  if (loadedFonts.has(family)) return;
  loadedFonts.add(family);
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = `https://fonts.googleapis.com/css2?family=${family}&display=swap`;
  document.head.appendChild(link);
}

/** Wait for a font family to be fully loaded into the document. */
export async function waitForFont(fontName: string): Promise<void> {
  try {
    // 等 family 注册 + 具体字重真正加载(见 fontReady)。旧实现直接 document.fonts.load,
    // Google 字体 <link> 刚插入时 face 未注册会立即 resolve 空 → 事件丢失 → 歌词卡旧字体。
    await fontReady(fontName);
  } finally {
    // 无论字体是否真正就绪都通知歌词渲染器重建:就绪则用新字体,失败/超时则回退默认字体,
    // 都比卡在旧字体好。旧实现失败时静默 return,事件从不派发。
    window.dispatchEvent(new CustomEvent('lumina:fontLoaded', { detail: fontName }));
  }
}

// ── Apply font ───────────────────────────────────────────────────

export function applyFont(fontFamily: string, scope: 'global' | 'lyrics'): void {
  const root = document.documentElement;
  if (scope === 'global') {
    root.style.setProperty('--app-font-family', `"${fontFamily}", "苹方字体", "Poppins", sans-serif`);
  } else {
    root.style.setProperty('--lyrics-font-family', `"${fontFamily}"`);
  }
  // If global, update the base * font rule via a style override.
  // Exclude icon fonts (Material Symbols, etc.) so icons don't turn into gibberish.
  if (scope === 'global') {
    let el = document.getElementById('font-override-style');
    if (!el) {
      el = document.createElement('style');
      el.id = 'font-override-style';
      document.head.appendChild(el);
    }
    el.textContent = [
      `/* Global font override — excludes icons and font picker previews */`,
      `*:not(.material-icons-round):not(.material-icons):not(.material-symbols-rounded):not(.material-symbols-outlined):not([class*="material-icons"]):not([class*="material-symbols"]):not(.font-preview-name)`,
      `{ font-family: "${fontFamily}", "苹方字体", "Poppins", sans-serif !important; }`,
    ].join('\n');
  }
}

export function resetFont(scope?: 'global' | 'lyrics'): void {
  if (!scope || scope === 'global') {
    const el = document.getElementById('font-override-style');
    if (el) el.textContent = '';
  }
  const root = document.documentElement;
  if (!scope || scope === 'global') root.style.removeProperty('--app-font-family');
  if (!scope || scope === 'lyrics') root.style.removeProperty('--lyrics-font-family');
}
