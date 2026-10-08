import * as Popover from '@radix-ui/react-popover';
import * as Slider from '@radix-ui/react-slider';
import { useRef, useState, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';

import { useAudioPlayer } from '../../hooks/useAudioPlayer';

// Shared silhouette: the expanded control adds finer bars to the toolbar waveform.
function Waveform({ detailed = false }: { detailed?: boolean }) {
  const count = detailed ? 65 : 11;
  return (
    <svg viewBox={`0 0 ${detailed ? 320 : 32} 100`} preserveAspectRatio="none" aria-hidden="true">
      {Array.from({ length: count }, (_, index) => {
        const x = 2 + (index / (count - 1)) * (detailed ? 316 : 28);
        const envelope = Math.sin((index / (count - 1)) * Math.PI);
        const height = detailed
          ? 10 + envelope * (24 + 54 * Math.abs(Math.sin(index * 1.73) * Math.cos(index * 0.39)))
          : [14, 32, 65, 90, 46, 22, 48, 78, 60, 30, 14][index];
        return (
          <line
            key={index}
            x1={x}
            x2={x}
            y1={50 - height / 2}
            y2={50 + height / 2}
            stroke="currentColor"
            strokeWidth={detailed ? 2 : 1.7}
            strokeLinecap="round"
            strokeDasharray={index > (count - 1) / 2 ? (detailed ? '2 5' : '5 10') : undefined}
            opacity={index > (count - 1) / 2 ? 0.6 : 0.9}
          />
        );
      })}
    </svg>
  );
}

export default function StemSeparationControl() {
  const { i18n } = useTranslation();
  const chinese = (i18n.resolvedLanguage ?? i18n.language).startsWith('zh');
  const processor = useAudioPlayer().stemSeparation;
  const state = useSyncExternalStore(processor.subscribe, processor.getSnapshot);
  const [open, setOpen] = useState(false);
  const keyboardAdjusting = useRef(false);
  const title = chinese ? '人声分轨' : 'Vocal separation';
  const voice = chinese ? '纯人声' : 'Vocals';
  const original = chinese ? '原声' : 'Original';
  const backing = chinese ? '纯伴奏' : 'Instrumental';
  const balance = !state.enabled
    ? 0
    : state.vocals >= state.accompaniment
      ? -(100 - state.accompaniment)
      : 100 - state.vocals;
  const valueLabel =
    balance === 0
      ? original
      : balance === -100
        ? voice
        : balance === 100
          ? backing
          : `${balance < 0 ? (chinese ? '人声' : 'Vocals') : chinese ? '伴奏' : 'Backing'} ${Math.abs(balance)}%`;
  const changeBalance = ([value]: number[]) =>
    processor.setBalance(!keyboardAdjusting.current && Math.abs(value) <= 5 ? 0 : value);
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          type="button"
          className="stem-separation-button"
          data-active={state.enabled}
          title={title}
          aria-label={title}
        >
          <Waveform />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          side="top"
          align="end"
          sideOffset={12}
          collisionPadding={12}
          className="stem-separation-popup queue-popup-surface sound-effects-popup"
          aria-label={title}
        >
          <div className="stem-separation-heading">
            <span>{title}</span>
            <span>{valueLabel}</span>
          </div>
          <div className="stem-separation-wave">
            <Waveform detailed />
            <Slider.Root
              className="stem-separation-slider"
              min={-100}
              max={100}
              step={1}
              value={[balance]}
              onValueChange={changeBalance}
              onPointerDownCapture={() => {
                keyboardAdjusting.current = false;
              }}
              onKeyDownCapture={() => {
                keyboardAdjusting.current = true;
              }}
            >
              <Slider.Track className="stem-separation-track" />
              <Slider.Thumb
                className="stem-separation-thumb"
                aria-label={title}
                aria-valuetext={valueLabel}
              />
            </Slider.Root>
          </div>
          <div className="stem-separation-labels">
            {[
              [-100, voice],
              [0, original],
              [100, backing]
            ].map(([value, label]) => (
              <button
                key={value}
                type="button"
                data-selected={balance === value}
                onClick={() => processor.setBalance(Number(value))}
              >
                {label}
              </button>
            ))}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
