import { NcmRepository } from '@renderer/ncm/repository';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import TitleContainer from '@renderer/components/TitleContainer';
import { useStore } from '@tanstack/react-store';
import { store } from '@renderer/store/store';

type Props = { ncmId: number };

const NcmLyricPreview = ({ ncmId }: Props) => {
  const [lyricText, setLyricText] = useState<string | null>(null);
  const [tlyricText, setTlyricText] = useState<string | null>(null);
  const { t } = useTranslation();
  const bodyBackgroundImage = useStore(store, (state) => state.bodyBackgroundImage);

  useEffect(() => {
    let cancelled = false;
    NcmRepository.lyric(ncmId).then((lyric) => {
      if (cancelled) return;
      if (lyric?.lyric) setLyricText(lyric.lyric);
      if (lyric?.tlyric) setTlyricText(lyric.tlyric);
    });
    return () => { cancelled = true; };
  }, [ncmId]);

  if (!lyricText && !tlyricText) return null;

  const parseLines = (raw: string) =>
    raw
      .split('\n')
      .filter((line) => line.match(/^\[\d+:\d+/))
      .map((line) => line.replace(/^\[\d+:\d+[.:]\d+\]/, '').trim())
      .filter(Boolean);

  const lines = parseLines(lyricText || '');
  const tlines = tlyricText ? parseLines(tlyricText) : [];

  return (
    <div className="w-full">
      <TitleContainer
        title={t('common.lyrics')}
        titleClassName="text-xl! text-font-color-black font-normal! dark:text-font-color-white"
        className={`title-container ${
          bodyBackgroundImage ? 'text-font-color-white' : 'text-font-color-black dark:text-font-color-white'
        } !mt-8 mb-4`}
      />
      <div className="bg-background-color-2/60 dark:bg-dark-background-color-2/60 rounded-xl p-4 max-h-[500px] overflow-y-auto">
        {lines.map((l, i) => (
          <div key={i} className="py-1">
            <p className="text-sm text-font-color-black dark:text-font-color-white leading-relaxed">{l}</p>
            {tlines[i] && (
              <p className="text-xs text-font-color-black/50 dark:text-font-color-white/50 leading-relaxed">{tlines[i]}</p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};

export default NcmLyricPreview;
