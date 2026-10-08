/**
 * LyricsStyleConfig — shared visual parameters for 3D lyrics rendering.
 * Both main window LyricsContainer and desktop lyrics window read from this config.
 *
 * Desktop window can override position/scale without affecting main window.
 */

// ── Core rendering ──

export const LYRIC_RENDER_CONFIG = {
  /** World-unit line height */
  LINE_HEIGHT: 1.0,
  /** Camera distance */
  CAMERA_Z: 5,
  /** Camera FOV */
  CAMERA_FOV: 60,
  /** Canvas2D font size for texture generation */
  CANVAS_FONT_SIZE: 64,
  /** Canvas2D font family */
  CANVAS_FONT: 'bold 64px "Microsoft YaHei", "PingFang SC", "Noto Sans SC", sans-serif',
} as const;

// ── Default visual parameters (overridable via lyricTx / settings) ──

export type LyricsStyleState = {
  // Text
  fontSize: number;          // base font size scaling
  letterSpacing: number;     // 0-100
  lineSpacing: number;       // 0-100
  lyricOpacity: number;      // 0-1
  focusScale: number;        // current line scale multiplier
  lyricAlign: string;        // 'center' | 'left' | 'right'

  // Colors
  primaryColor: string;      // hex, e.g. '#f6fdff'
  highlightColor: string;    // hex
  glowColor: string;         // hex
  colorBrightness: number;   // 0-100

  // Effects
  edgeGlowEnabled: boolean;
  breathSpeed: number;       // 0-100
  ktvHighlight: boolean;
  sweepEnabled: boolean;
  solarEnabled: boolean;
  solarIntensity: number;    // 0-100
  beatEnabled: boolean;

  // Motion
  swingEnabled: boolean;
  swingSpeed: number;        // 0-100
  verticalFloat: boolean;
  glitchEnabled: boolean;
  motionStyle: string;       // MotionStyle key
  motionSoftness: number;

  // Camera
  perspective: number;       // 0-100
  faceCamera: boolean;

  // Display
  bilingualMode: string;     // 'original' | 'translation' | 'original+translation' | 'translation+original'
  displayAnchor: string;     // 'center' | 'top' | 'bottom'
  displayCount: number;      // visible line count
  focusOffsetX: number;
  focusOffsetY: number;
  focusOffsetZ: number;
};

export const DEFAULT_STYLE: LyricsStyleState = {
  fontSize: 100,
  letterSpacing: 0,
  lineSpacing: 100,
  lyricOpacity: 1,
  focusScale: 1.2,
  lyricAlign: 'center',

  primaryColor: '#f6fdff',
  highlightColor: '#fff0b8',
  glowColor: '#9cffdf',
  colorBrightness: 100,

  edgeGlowEnabled: true,
  breathSpeed: 100,
  ktvHighlight: true,
  sweepEnabled: true,
  solarEnabled: false,
  solarIntensity: 50,
  beatEnabled: true,

  swingEnabled: false,
  swingSpeed: 100,
  verticalFloat: true,
  glitchEnabled: false,
  motionStyle: 'default',
  motionSoftness: 1,

  perspective: 60,
  faceCamera: true,

  bilingualMode: 'original',
  displayAnchor: 'center',
  displayCount: 6,
  focusOffsetX: 0,
  focusOffsetY: 0,
  focusOffsetZ: 0,
};

// ── Desktop-specific overrides ──

export type DesktopLyricsOverrides = {
  /** Horizontal offset from center (pixels) */
  offsetX: number;
  /** Vertical offset from center (pixels) */
  offsetY: number;
  /** Overall scale multiplier */
  scale: number;
  /** Custom width constraint */
  width: number;
  /** Custom height constraint */
  height: number;
};

export const DEFAULT_DESKTOP_OVERRIDES: DesktopLyricsOverrides = {
  offsetX: 0,
  offsetY: 0,
  scale: 1,
  width: 0,   // 0 = use full screen
  height: 0,  // 0 = use full screen
};
