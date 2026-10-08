import { store } from "@renderer/store/store";
import { useStore } from "@tanstack/react-store";
import { useTranslation } from "react-i18next";

/** Keep the title anchored while fading it in under the immersive top-center hot zone. */
const TopSongInfo = ({ isVisible = true }: { isVisible?: boolean }) => {
  const currentSongData = useStore(store, (state) => state.currentSongData);
  const { t } = useTranslation();

  return (
    <div
      className={`pointer-events-none absolute top-[46px] right-0 left-0 z-30 flex justify-center select-none transition-opacity duration-200 motion-reduce:transition-none ${isVisible ? "opacity-100" : "opacity-0"}`}
      aria-hidden={!isVisible}
      style={
        {
          WebkitAppRegion: "no-drag",
          appRegion: "no-drag",
        } as React.CSSProperties
      }
    >
      <div
        className="flex max-w-[80vw] flex-col items-center gap-1 whitespace-nowrap"
        style={{ transform: "translateY(-50%)" }}
      >
        {currentSongData.title && (
          <div className="song-title flex items-center justify-center gap-1">
            <div
              className="text-font-color-highlight w-fit max-w-full cursor-pointer overflow-hidden py-1 text-3xl font-medium tracking-[-0.01em] text-ellipsis whitespace-nowrap outline-offset-1 focus-visible:outline!"
              style={
                {
                  fontOpticalSizing: "auto",
                  filter: "drop-shadow(0 1px 3px rgba(0,0,0,.65))",
                } as React.CSSProperties
              }
              id="currentSongTitle"
              title={currentSongData.title}
            >
              {currentSongData.title}
            </div>
            {!currentSongData.isKnownSource && (
              <span
                className="material-icons-round-outlined text-font-color-highlight dark:text-dark-font-color-highlight ml-1 cursor-pointer text-xl font-light hover:underline"
                title="You are playing from an unknown source. Some features are disabled."
              >
                error
              </span>
            )}
          </div>
        )}
        <div
          className="song-artists text-font-color-white/80 text-sm leading-none"
          style={{ filter: "drop-shadow(0 1px 3px rgba(0,0,0,.65))" }}
          title={currentSongData.artists
            ?.map((artist) => artist.name)
            .join(", ")}
        >
          {currentSongData.songId && Array.isArray(currentSongData.artists)
            ? currentSongData.artists?.length > 0
              ? currentSongData.artists.map((artist) => artist.name).join(", ")
              : t("common.unknownArtist")
            : ""}
        </div>
      </div>
    </div>
  );
};

export default TopSongInfo;
