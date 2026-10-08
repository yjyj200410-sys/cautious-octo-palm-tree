import {
  NCM_SONG_QUALITIES,
  normalizeNcmSongQuality,
  type NcmSongQuality
} from '@common/ncmQuality';
import { store } from '@renderer/store/store';
import storage from '@renderer/utils/localStorage';
import { NCM_QUALITY_LABEL_KEYS } from '@renderer/utils/ncmQualityLabels';
import { useStore } from '@tanstack/react-store';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { NcmPlaybackResolver } from '../../music-source/netease/NcmPlaybackResolver';
import { PrefetchManager } from '../../other/PrefetchManager';

const NcmPlaybackQualityControl = () => {
  const { t } = useTranslation();
  const containerRef = useRef<HTMLDivElement>(null);
  const [isOpen, setIsOpen] = useState(false);
  const preference = useStore(
    store,
    (state) => state.localStorage.preferences.ncmPlaybackQuality
  );
  const quality = normalizeNcmSongQuality(preference);

  useEffect(() => {
    if (!isOpen) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setIsOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsOpen(false);
    };
    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen]);

  const selectQuality = (nextQuality: NcmSongQuality) => {
    if (nextQuality !== quality) {
      storage.preferences.setPreferences('ncmPlaybackQuality', nextQuality);
      NcmPlaybackResolver.clearCache();
      PrefetchManager.getInstance().clear();
    }
    setIsOpen(false);
  };

  return (
    <div ref={containerRef} className="relative flex shrink-0 items-center">
      <button
        type="button"
        className={`ncm-quality-btn text-font-color-black dark:text-font-color-white flex h-8 w-8 shrink-0 items-center justify-center gap-1 rounded-md border-0 bg-transparent px-1.5 text-[11px] font-medium outline-offset-1 transition-colors hover:bg-black/5 focus-visible:outline dark:hover:bg-white/7 ${
          isOpen ? 'bg-black/6 dark:bg-white/9' : ''
        }`}
        title={`${t('settingsPage.ncmPlaybackQuality')}：${t(NCM_QUALITY_LABEL_KEYS[quality])}`}
        aria-label={t('settingsPage.ncmPlaybackQuality')}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        onClick={() => setIsOpen((open) => !open)}
      >
        <span className="material-icons-round-outlined shrink-0 text-[19px] leading-none opacity-65" aria-hidden="true">
          high_quality
        </span>
      </button>

      <div
        role="menu"
        aria-label={t('settingsPage.ncmPlaybackQuality')}
        className="queue-popup-surface absolute right-0 bottom-full z-50 mb-1 flex w-44 flex-col rounded-2xl p-1.5 text-white"
        data-open={isOpen}
        style={{
          opacity: isOpen ? 1 : 0,
          visibility: isOpen ? 'visible' : 'hidden',
          pointerEvents: isOpen ? 'auto' : 'none',
          transform: isOpen ? 'translateY(0)' : 'translateY(12px)',
          transition: 'opacity 180ms ease-out, transform 200ms ease-out, visibility 200ms',
        }}
        inert={!isOpen}
      >
        <div className="px-2 py-1.5">
          <div className="text-sm font-medium text-white/80">音质</div>
        </div>
        <div className="grid gap-0.5">
          {NCM_SONG_QUALITIES.map((option) => {
            const selected = option === quality;
            return (
              <button
                key={option}
                type="button"
                role="menuitemradio"
                aria-checked={selected}
                className={`flex h-8 items-center justify-between rounded-lg px-2 text-left text-[13px] transition-colors focus-visible:outline ${
                  selected
                    ? 'bg-white/12 text-white'
                    : 'text-white/75 hover:bg-white/8 hover:text-white'
                }`}
                onClick={() => selectQuality(option)}
              >
                <span>{t(NCM_QUALITY_LABEL_KEYS[option])}</span>
                {selected && (
                  <span className="material-icons-round text-lg leading-none" aria-hidden="true">
                    check
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
};

export default NcmPlaybackQualityControl;
