import * as Popover from '@radix-ui/react-popover';
import * as Slider from '@radix-ui/react-slider';
import { useStore } from '@tanstack/react-store';
import { useContext, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { AppUpdateContext } from '../../contexts/AppUpdateContext';
import { store } from '../../store/store';

const VolumeControl = () => {
  const { t } = useTranslation();
  const { updateVolume } = useContext(AppUpdateContext);
  const volume = useStore(store, (state) => state.player.volume.value);
  const [open, setOpen] = useState(false);
  const label = t('player.volume');
  const icon = volume === 0 ? 'volume_off' : volume < 50 ? 'volume_down' : 'volume_up';

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          type="button"
          className={`text-font-color-black dark:text-font-color-white flex h-8 w-8 shrink-0 items-center justify-center rounded-md border-0 bg-transparent hover:bg-black/5 focus-visible:outline dark:hover:bg-white/7 ${open ? 'bg-black/6 dark:bg-white/9' : ''}`}
          title={label}
          aria-label={label}
          aria-expanded={open}
        >
          <span className="material-icons-round-outlined text-[21px] leading-none opacity-65" aria-hidden="true">{icon}</span>
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          side="top"
          align="center"
          sideOffset={8}
          collisionPadding={4}
          className="sound-effects-popup queue-popup-surface z-[80] flex w-12 flex-col items-center gap-2 rounded-2xl py-3 text-white outline-none"
          aria-label={label}
        >
          <span className="text-[11px] tabular-nums text-white/75">{Math.round(volume)}%</span>
          <Slider.Root
            orientation="vertical"
            min={0}
            max={100}
            step={1}
            value={[volume]}
            onValueChange={([value]) => updateVolume(value)}
            className="relative flex h-28 w-8 touch-none select-none items-center justify-center"
            aria-label={label}
          >
            <Slider.Track className="relative h-full w-1.5 overflow-hidden rounded-full bg-white/20">
              <Slider.Range className="absolute w-full rounded-full bg-white/75" />
            </Slider.Track>
            <Slider.Thumb className="block h-4 w-4 rounded-full border border-white/70 bg-white shadow-md outline-none focus-visible:ring-2 focus-visible:ring-white/60" />
          </Slider.Root>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
};

export default VolumeControl;
