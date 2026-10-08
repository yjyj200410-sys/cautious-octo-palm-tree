import gsap from 'gsap';
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode
} from 'react';

import type { LyricLine } from '../hooks/LyricsStore';
import {
  lyricWordProgress,
  resolveLyricLayout,
  resolveLyricMotion
} from '../utils/lyricPresentation';

import './LyricCarousel.css';

type Props = {
  lines: LyricLine[];
  index: number;
  position: number;
  config?: Record<string, any>;
  onSeek?: (position: number) => void;
  reducedMotion?: boolean;
};

type RowProps = {
  delta: number;
  rowHeight: number;
  visible: boolean;
  current: boolean;
  motion: ReturnType<typeof resolveLyricMotion>;
  still: boolean;
  children: ReactNode;
  onSeek?: () => void;
};

function AnimatedRow({
  delta,
  rowHeight,
  visible,
  current,
  motion,
  still,
  children,
  onSeek
}: RowProps) {
  const ref = useRef<HTMLButtonElement>(null);
  const presentation = useRef<{ y: number; scale: number; opacity: number } | null>(null);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const target = {
      y: delta * rowHeight,
      scale: current ? 1 : motion.contextScale,
      opacity: visible
        ? current
          ? 1
          : motion.contextOpacity / Math.max(1, Math.abs(delta) * 0.7)
        : 0
    };
    const context = gsap.context(() => {
      gsap.set(element, { yPercent: -50, ...(presentation.current ?? { ...target, opacity: 0 }) });
      if (still || motion.duration === 0) gsap.set(element, target);
    }, element);
    // React/store work can block a frame after committing the new row. Start on
    // the next GSAP tick, after its clock has caught up, rather than consuming
    // most of the transition while that frame is still blocked.
    const start = () =>
      context.add(() => {
        gsap.to(element, {
          ...target,
          duration: motion.duration,
          ease: motion.ease,
          overwrite: 'auto'
        });
      });
    if (!still && motion.duration > 0) gsap.ticker.add(start, true);
    return () => {
      gsap.ticker.remove(start);
      // Capture the displayed position before reverting, so rapid seeks never jump to an old target.
      presentation.current = {
        y: Number(gsap.getProperty(element, 'y')),
        scale: Number(gsap.getProperty(element, 'scaleX')),
        opacity: Number(gsap.getProperty(element, 'opacity'))
      };
      context.revert();
    };
  }, [delta, rowHeight, visible, current, motion, still]);
  return (
    <button
      ref={ref}
      type="button"
      className={`lyric-carousel-row${current ? ' is-current' : ''}`}
      style={{ pointerEvents: visible ? undefined : 'none' }}
      aria-hidden={!visible || undefined}
      aria-current={current ? 'true' : undefined}
      tabIndex={visible ? undefined : -1}
      disabled={!onSeek}
      onClick={onSeek}
    >
      {children}
    </button>
  );
}

/** A small buffered DOM window; only row changes start tweens, never playback ticks. */
export default function LyricCarousel({
  lines,
  index,
  position,
  config = {},
  onSeek,
  reducedMotion
}: Props) {
  const [systemReducedMotion, setSystemReducedMotion] = useState(
    () => window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setSystemReducedMotion(query.matches);
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  const still = !!reducedMotion || systemReducedMotion;
  const active = Math.max(0, Math.min(index, lines.length - 1));
  const mode = config.bilingualMode ?? 'original';
  const count = Math.max(1, Math.min(7, Number(config.lyricCustomLineCount) || 5));
  const before = Math.floor(count / 2);
  const after = count - before - 1;
  const layout = resolveLyricLayout(config.lyricLayout);
  const motion = resolveLyricMotion(config.lyricMotion);
  const fontSize = Math.max(18, Math.min(64, (32 * (Number(config.scale) || 100)) / 100));
  const rowHeight = Math.max(
    64,
    (fontSize * (mode.includes('+') ? 3.2 : 2.5) * (Number(config.lineSpacing) || 100)) / 100
  );
  const style = {
    '--lyric-row-height': `${rowHeight}px`,
    '--lyric-anchor': `${layout.anchor * 100}%`,
    '--lyric-font-size': `${fontSize}px`,
    '--lyric-color': config.primaryColor || config.lyricColor || 'currentColor',
    '--lyric-highlight':
      config.highlightColor || config.primaryColor || config.lyricColor || 'currentColor',
    fontFamily: config.fontFamily,
    fontWeight: config.fontWeight || 600,
    letterSpacing: `${Number(config.letterSpacing) || 0}px`,
    textAlign: config.lyricLayout === 'reading' ? layout.align : config.lyricAlign || layout.align
  } as CSSProperties;
  const start = Math.max(0, active - before - 2);
  return (
    <div
      className={`lyric-carousel${still || !motion.duration ? ' lyric-carousel--still' : ''}`}
      style={style}
    >
      {lines.length === 0 && <div className="lyric-carousel-empty">暂无歌词</div>}
      {lines.slice(start, active + after + 3).map((line, offset) => {
        const lineIndex = start + offset;
        const current = lineIndex === active;
        const original =
          config.ktvHighlight !== false && line.words?.length
            ? line.words.map((word, wordIndex) => (
                <span key={wordIndex} className="lyric-word">
                  <span>{word.text}</span>
                  <span
                    aria-hidden="true"
                    className="lyric-word-fill"
                    style={{
                      clipPath: `inset(0 ${(1 - lyricWordProgress(position, word.start, word.end)) * 100}% 0 0)`
                    }}
                  >
                    {word.text}
                  </span>
                </span>
              ))
            : line.text;
        const first =
          mode.startsWith('translation') && line.secondaryText ? line.secondaryText : original;
        const second = mode.includes('+')
          ? mode.startsWith('translation')
            ? original
            : line.secondaryText
          : '';
        return (
          <AnimatedRow
            key={`${lineIndex}:${line.start}:${line.text}`}
            delta={lineIndex - active}
            rowHeight={rowHeight}
            current={current}
            visible={lineIndex >= active - before && lineIndex <= active + after}
            motion={motion}
            still={still}
            onSeek={onSeek && Number.isFinite(line.start) ? () => onSeek(line.start) : undefined}
          >
            <span className="lyric-carousel-text">{first}</span>
            {second && <span className="lyric-carousel-translation">{second}</span>}
          </AnimatedRow>
        );
      })}
    </div>
  );
}
