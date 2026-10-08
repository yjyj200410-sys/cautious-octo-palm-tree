import Img from './Img';

type Props = {
  artworkPath?: string;
  fallbackSrc: string;
  alt: string;
  isPlaying: boolean;
  reduceMotion: boolean;
};

/** The record rotates independently from its layout and interaction container. */
export default function VinylCover({ artworkPath, fallbackSrc, alt, isPlaying, reduceMotion }: Props) {
  return (
    <div className="vinyl-cover" data-rotating={isPlaying && !reduceMotion ? 'true' : 'false'}>
      <div className="vinyl-cover-record">
        <div className="vinyl-cover-label">
          <Img src={artworkPath} fallbackSrc={fallbackSrc} alt={alt} className="vinyl-cover-artwork" />
        </div>
      </div>
    </div>
  );
}
