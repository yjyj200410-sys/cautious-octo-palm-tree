import { Trans } from 'react-i18next';

interface LyricsSourceProp {
  source: string;
  link?: string;
  copyright?: string;
  className?: string;
  textClassName?: string;
  isTranslated?: boolean;
}

const LyricsMetadata = (props: LyricsSourceProp) => {
  const { copyright, className, textClassName, isTranslated } = props;
  return (
    <div
      className={`source-name text-font-color-dimmed mt-12 flex flex-col items-center justify-center gap-2 text-center ${className}`}
    >
      {copyright && (
        <div className={`text-font-color-dimmed text-sm text-balance ${textClassName}`}>
          &copy; {copyright}
        </div>
      )}
      {isTranslated && (
        <div className={`text-font-color-dimmed text-sm text-balance ${textClassName}`}>
          <Trans i18nKey="lyricsPage.lyricsTranslatedBy" />
        </div>
      )}
    </div>
  );
};

export default LyricsMetadata;
