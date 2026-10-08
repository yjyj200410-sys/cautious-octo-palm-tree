import { store } from "@renderer/store/store";
import { runPlayerViewTransition } from "@renderer/utils/playerViewTransition";
import { useNavigate } from "@tanstack/react-router";
import { useStore } from "@tanstack/react-store";
import { lazy, useCallback, useContext, useMemo, useState } from "react";
import { flushSync } from "react-dom";
import { useTranslation } from "react-i18next";

import DefaultSongCover from "../../assets/images/webp/song_cover_default.webp";
import { AppUpdateContext } from "../../contexts/AppUpdateContext";
import Img from "../Img";
import NavLink from "../NavLink";
import SongArtist from "../SongsPage/SongArtist";

const AddSongsToPlaylistsPrompt = lazy(
  () => import("../SongsPage/AddSongsToPlaylistsPrompt"),
);

const CurrentlyPlayingSongInfoContainer = () => {
  const currentSongData = useStore(store, (state) => state.currentSongData);
  const preferences = useStore(
    store,
    (state) => state.localStorage.preferences,
  );
  const playerType = useStore(store, (state) => state.playerType);
  const navigate = useNavigate();

  const {
    updateContextMenuData,
    changePromptMenuData,
    toggleMultipleSelections,
    addNewNotifications,
    updatePlayerType,
  } = useContext(AppUpdateContext);
  const { t } = useTranslation();

  // 全屏图标动画重放计数(hover 时 key 变化 → 动画重新播放)

  const songArtistsImages = useMemo(() => {
    if (
      currentSongData.songId &&
      Array.isArray(currentSongData.artists) &&
      currentSongData.artists.length > 0
    )
      return currentSongData.artists
        .filter((artist, index) => artist.onlineArtworkPaths && index < 2)
        .map((artist, index) => (
          <Img
            key={artist.artistId}
            src={artist.onlineArtworkPaths?.picture_small}
            fallbackSrc={artist.artworkPath}
            loading="eager"
            className={`border-background-color-1 dark:border-dark-background-color-1 absolute aspect-square w-6 rounded-full border-2 ${
              index === 0 ? "z-2" : "-translate-x-2"
            }`}
            onClick={() =>
              navigate({
                to: "/main-player/artists/$artistId",
                params: { artistId: String(artist.artistId) },
              })
            }
            alt=""
          />
        ));
    return undefined;
  }, [currentSongData.artists, currentSongData.songId, navigate]);

  const showSongInfoPage = useCallback(
    (songId: number) =>
      currentSongData.isKnownSource
        ? navigate({
            to: "/main-player/songs/$songId",
            params: { songId: String(songId) },
          })
        : undefined,
    [navigate, currentSongData.isKnownSource],
  );

  const songArtists = useMemo(() => {
    const { songId, artists, isKnownSource } = currentSongData;

    if (songId && Array.isArray(artists)) {
      if (artists.length > 0) {
        return artists
          .map((artist, i, artistArr) => {
            const arr = [
              <SongArtist
                key={artist.artistId}
                artistId={artist.artistId}
                name={artist.name}
                isFromKnownSource={isKnownSource}
              />,
            ];

            if ((artists.length ?? 1) - 1 !== i)
              arr.push(
                <span
                  key={`${artistArr[i].name},${artistArr[i + 1].name}`}
                  className="mr-1"
                >
                  ,
                </span>,
              );

            return arr;
          })
          .flat();
      }
      return (
        <span className="text-xs font-normal">{t("common.unknownArtist")}</span>
      );
    }
    return "";
  }, [currentSongData, t]);

  const contextMenuCurrentSongData = useMemo((): ContextMenuAdditionalData => {
    const { title, artworkPath, artists, album } = currentSongData;
    return {
      title,
      artworkPath: artworkPath ?? DefaultSongCover,
      subTitle:
        artists?.map((artist) => artist.name).join(", ") ||
        t("common.unknownArtist"),
      subTitle2: album?.name,
    };
  }, [currentSongData, t]);

  const contextMenuItems = useMemo((): ContextMenuItem[] => {
    const { title, songId, artworkPath, isKnownSource } = currentSongData;

    return [
      {
        label: t("song.addToPlaylists"),
        iconName: "playlist_add",
        handlerFunction: () => {
          changePromptMenuData(
            true,
            <AddSongsToPlaylistsPrompt songIds={[songId]} title={title} />,
          );
          toggleMultipleSelections(false);
        },
      },
      {
        label: "Hr",
        isContextMenuItemSeperator: true,
        handlerFunction: () => true,
      },
      {
        label: t("song.showInFileExplorer"),
        class: "reveal-file-explorer",
        iconName: "folder_open",
        handlerFunction: () =>
          window.api.songUpdates.revealSongInFileExplorer(songId),
      },
      {
        label: t("common.info"),
        iconName: "info",
        handlerFunction: () => showSongInfoPage(songId),
        isDisabled: !isKnownSource,
      },
      {
        label: t("common.saveArtwork"),
        class: "edit",
        iconName: "image",
        iconClassName: "material-icons-round-outlined",
        handlerFunction: () =>
          artworkPath &&
          window.api.songUpdates.saveArtworkToSystem(
            artworkPath,
            `${title} song artwork`.replaceAll(" ", "_"),
          ),
        isDisabled: currentSongData.artworkPath === undefined,
      },
    ];
  }, [
    addNewNotifications,
    changePromptMenuData,
    currentSongData,
    showSongInfoPage,
    t,
    toggleMultipleSelections,
  ]);

  const toggleFullScreenPlayer = useCallback(() => {
    const nextType = playerType === "full" ? "normal" : "full";
    void runPlayerViewTransition(() =>
      flushSync(() => updatePlayerType(nextType)),
    );
  }, [playerType, updatePlayerType]);

  return (
    <div className="current-playing-song-info-container grid w-full max-w-full min-w-0 grid-cols-[3.75rem_minmax(0,1fr)] items-center gap-3">
      <div
        className="song-cover-container group relative flex h-14 w-14 cursor-pointer items-center justify-center overflow-hidden rounded-md outline-offset-2 focus-visible:outline"
        id="currentSongCover"
        role="button"
        tabIndex={0}
        title={
          playerType === "full"
            ? t("player.goToMainPlayer")
            : t("player.openInFullScreen")
        }
        aria-label={
          playerType === "full"
            ? t("player.goToMainPlayer")
            : t("player.openInFullScreen")
        }
        onClick={toggleFullScreenPlayer}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            toggleFullScreenPlayer();
          }
        }}
      >
        {/* ${
               !currentSongData.artworkPath &&
               `before:absolute before:h-[85%] before:w-[85%] before:rounded-md before:bg-background-color-2 before:bg-dark-background-color-2 before:content-[''] after:absolute after:h-5 after:w-5 after:animate-spin-ease after:rounded-full after:border-2 after:border-[transparent] after:border-t-font-color-black after:content-[''] dark:after:border-t-font-color-white`
             } */}
        <Img
          className="aspect-square h-full max-w-full rounded-md object-cover object-center shadow-[0_8px_24px_rgba(0,0,0,0.18)]"
          src={currentSongData.artworkPath}
          fallbackSrc={DefaultSongCover}
          alt="Default song cover"
          onContextMenu={(e) => {
            e.stopPropagation();
            updateContextMenuData(
              true,
              contextMenuItems,
              e.pageX,
              e.pageY,
              contextMenuCurrentSongData,
            );
          }}
        />
        <span className="pointer-events-none absolute top-0.5 left-1/2 flex h-5 min-w-7 -translate-x-1/2 -translate-y-0.5 items-center justify-center rounded-full bg-black/32 px-1 text-white opacity-0 shadow-[0_3px_10px_rgba(0,0,0,.22)] backdrop-blur-md transition-[opacity,transform,background-color] duration-200 group-hover:translate-y-0 group-hover:bg-black/42 group-hover:opacity-55 group-focus-visible:translate-y-0 group-focus-visible:opacity-55">
          <span className="material-icons-round text-[19px] leading-none">
            {playerType === "full"
              ? "keyboard_arrow_down"
              : "keyboard_arrow_up"}
          </span>
        </span>
      </div>
      <div className="song-info-container relative flex h-full w-full min-w-0 flex-col items-start justify-center">
        {currentSongData.title && (
          <div className="song-title flex w-full items-center">
            <NavLink
              to="/main-player/songs/$songId"
              params={{ songId: String(currentSongData.songId) }}
              className={`text-font-color-black/90 dark:text-font-color-white/92 w-fit max-w-full cursor-pointer overflow-hidden text-sm font-semibold text-ellipsis whitespace-nowrap outline-offset-2 focus-visible:outline! ${
                currentSongData.isKnownSource && "hover:underline"
              }`}
              disabled={!currentSongData.isKnownSource}
              id="currentSongTitle"
              title={currentSongData.title}
              onContextMenu={(e) => {
                e.stopPropagation();
                updateContextMenuData(
                  true,
                  contextMenuItems,
                  e.pageX,
                  e.pageY,
                  contextMenuCurrentSongData,
                );
              }}
              tabIndex={0}
            >
              {currentSongData.title}
            </NavLink>
            {!currentSongData.isKnownSource && (
              <span
                className="material-icons-round-outlined text-font-color-highlight dark:text-dark-font-color-highlight ml-2 cursor-pointer text-xl font-light hover:underline"
                title="You are playing from an unknown source. Some features are disabled."
              >
                error
              </span>
            )}
          </div>
        )}
        <div
            className="song-artists appear-from-bottom flex w-full items-center truncate"
            id="currentSongArtists"
          >
            {preferences?.showArtistArtworkNearSongControls &&
              songArtistsImages &&
              songArtistsImages.length > 0 && (
                <span
                  className={`relative mr-2 flex h-6 items-center lg:hidden ${
                    songArtistsImages.length === 1 ? "w-6" : "w-10"
                  } `}
                >
                  {songArtistsImages}
                </span>
              )}
            <span className="text-font-color-black/52 dark:text-font-color-white/52 flex w-3/4 grow-0 text-xs">
              {songArtists}
            </span>
          </div>
      </div>
    </div>
  );
};

export default CurrentlyPlayingSongInfoContainer;
