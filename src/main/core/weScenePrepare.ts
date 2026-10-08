/**
 * Best-effort "disable time-related plugins / properties while recording a scene
 * wallpaper".
 *
 * Wallpaper Engine exposes no CLI switch to skip the time/date/weather system
 * plugins when launching a scene, and it persists per-wallpaper property
 * overrides in config.json keyed by the ORIGINAL wallpaper path — a temp copy
 * (different path) gets no overrides and falls back to the wallpaper's defaults.
 * So to record a scene without the frozen "now" overlay we rewrite a TEMP COPY
 * of the wallpaper:
 *
 *  - plugin-based displays: strip time/date/weather entries from the top-level
 *    `plugins` array (on-screen plugins such as "$cl.onscreen.time").
 *  - property-based displays: set boolean time/clock/date toggle properties in
 *    `general.properties` to their "off" value (false), since WE reads these
 *    defaults for the temp copy.
 *
 * The original project is never touched; if there is nothing to strip/disable
 * (or the copy fails) the original path is returned unchanged so recording
 * proceeds normally.
 */
import { existsSync, readFileSync, writeFileSync, cpSync } from 'fs';
import { join, dirname, basename, extname } from 'path';
import { tmpdir } from 'os';
import logger from '../logger';

/**
 * Plugin IDs that draw the current time / date / weather on screen.  Stripping
 * these removes the "now" overlay so the recorded loop doesn't freeze on the
 * wall-clock time.  Wallpaper Engine namespaces its on-screen plugins, e.g.
 * "$cl.onscreen.time" / "$cl.onscreen.date" / "$cl.onscreen.weather", but older
 * wallpapers list bare names ("time", "clock", …), so both forms are matched.
 * "$default" and other system plugins are intentionally NOT matched.
 */
const TIME_PLUGIN_KEYWORDS = new Set([
  'time',
  'date',
  'datetime',
  'systemtime',
  'clock',
  'calendar',
  'daylight',
  'sun',
  'moon',
  'week',
  'month',
  'year',
  'timer',
  'alarm',
  'weather',
]);

function isTimePlugin(id: string): boolean {
  const lower = id.toLowerCase();
  if (TIME_PLUGIN_KEYWORDS.has(lower)) return true;
  // Namespaced on-screen plugins end with the keyword, e.g. "$cl.onscreen.time"
  // or "$onscreen.weather".  "$default" / "$cl.onscreen.audio" etc. are kept.
  const leaf = lower.replace(/^\$/, '').split(/[.$]/).pop() ?? '';
  return TIME_PLUGIN_KEYWORDS.has(leaf);
}

const TIME_PROP_TOKENS = new Set([
  'clock',
  'calendar',
  'datetime',
  'timer',
  'alarm',
  'time',
  'date',
  'daynight',
  'week',
  'weekday',
  'weather',
  'hour',
  'minute',
  'month',
  'year',
]);

/** Concatenated names without separators: "showclock", "clockenabled". */
const TIME_PROP_CONCAT =
  /^(?:show|display|hide|toggle|enable)(?:clock|calendar|datetime|timer|alarm|time|date|daynight|week|weekday|weather|hour|minute|month|year)|(?:clock|calendar|datetime|timer|alarm|time|date|daynight|week|weekday|weather|hour|minute|month|year)(?:enabled|visible|show|display|hide|toggle)$/;

/**
 * Property keys that read like a time/date/clock display toggle.  Only BOOLEAN
 * properties get disabled (off = false); slider/text/color props such as
 * "clock_digital_scale" / "clock_font" are left alone.
 *
 * Keys are tokenized on separators AND camelCase boundaries (so "showClock",
 * "clock_enable" and "show_time" all resolve to their parts); a key counts when
 * it contains a time token and (unless it is a bare token like "clock") reads
 * like an on/off switch.
 */
function isTimeProperty(key: string): boolean {
  const camelSplit = key.replace(/([a-z0-9])([A-Z])/g, '$1 $2');
  const k = camelSplit.toLowerCase();
  const tokens = k.split(/[^a-z0-9]+/).filter(Boolean);
  const hasTimeToken = tokens.some((t) => TIME_PROP_TOKENS.has(t));
  if (!hasTimeToken) {
    // Concatenated forms ("showclock" / "clockenabled") have the time token
    // glued to the verb, so they don't appear as a standalone token.
    return TIME_PROP_CONCAT.test(k);
  }
  if (tokens.length === 1) return true; // bare: "clock" / "time" / "date"
  return /(show|display|enab|visib|hide|toggle)/.test(k);
}

/** Boolean time/clock/date toggle properties that should be switched off. */
function findTimeBoolProps(
  props: Record<string, { type?: string; value?: unknown }> | undefined,
): string[] {
  if (!props) return [];
  return Object.keys(props).filter((key) => props[key]?.type === 'bool' && isTimeProperty(key));
}

/**
 * Returns a launchable project.json path with time plugins stripped and
 * time/clock toggle properties disabled, or the original path unchanged when
 * there is nothing to do / an error occurs.
 */
export function prepareSceneForRecording(wallpaperPath: string): string {
  const ext = extname(wallpaperPath).toLowerCase();
  const base = basename(wallpaperPath).toLowerCase();

  // Only scene wallpapers (.pkg / scene.json) go through the recorder.  Resolve
  // a package/scene file to its sibling project.json (same logic as weRecorder).
  let projectJson = wallpaperPath;
  if (ext === '.pkg' || (ext === '.json' && base !== 'project.json')) {
    const sibling = join(dirname(wallpaperPath), 'project.json');
    if (!existsSync(sibling)) return wallpaperPath;
    projectJson = sibling;
  }
  if (basename(projectJson).toLowerCase() !== 'project.json') return wallpaperPath;

  let json: {
    plugins?: unknown;
    general?: { properties?: Record<string, { type?: string; value?: unknown }> };
  };
  try {
    json = JSON.parse(readFileSync(projectJson, 'utf-8'));
  } catch (e) {
    logger.warn('prepareSceneForRecording: unparseable project.json, using original', {
      projectJson,
      err: String(e),
    });
    return wallpaperPath;
  }

  // A) On-screen time/date/weather plugins listed in the plugins array.
  const plugins = Array.isArray(json.plugins) ? json.plugins : [];
  const removed = plugins.filter(
    (p): p is string => typeof p === 'string' && isTimePlugin(p),
  );

  // B) Boolean time/clock/date toggle properties.
  const disabled = findTimeBoolProps(json.general?.properties);

  if (removed.length === 0 && disabled.length === 0) {
    logger.debug('prepareSceneForRecording: nothing to strip/disable, using original', {
      projectJson,
    });
    return wallpaperPath;
  }

  const srcDir = dirname(projectJson);
  const dstDir = join(tmpdir(), `lumina_we_rec_${Date.now()}`);
  try {
    cpSync(srcDir, dstDir, { recursive: true });
    const copyPath = join(dstDir, 'project.json');
    const copy: {
      plugins?: unknown[];
      general?: { properties?: Record<string, { type?: string; value?: unknown }> };
    } = JSON.parse(readFileSync(copyPath, 'utf-8'));

    if (removed.length > 0 && Array.isArray(copy.plugins)) {
      copy.plugins = copy.plugins.filter(
        (p: unknown) => !(typeof p === 'string' && isTimePlugin(p)),
      );
    }
    if (disabled.length > 0) {
      const props = copy.general?.properties;
      if (props) {
        for (const key of disabled) {
          const prop = props[key];
          if (prop && prop.type === 'bool') prop.value = false;
        }
      }
    }

    writeFileSync(copyPath, JSON.stringify(copy, null, '\t'), 'utf-8');
    logger.info('prepareSceneForRecording: temp copy prepared', {
      removedPlugins: removed,
      disabledProps: disabled,
      dstDir,
    });
    return copyPath;
  } catch (e) {
    logger.warn('prepareSceneForRecording: temp-copy failed, using original', {
      err: String(e),
    });
    return wallpaperPath;
  }
}
