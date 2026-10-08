import { lazy, useCallback, useEffect, useRef } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { useStore } from '@tanstack/react-store';

import { store } from '../store/store';
import log from '../utils/log';

const ErrorPrompt = lazy(() => import('../components/ErrorPrompt'));

/**
 * Hook for managing playback errors and retry logic.
 *
 * This hook handles audio player errors, tracks repetitive error counts, and provides error
 * recovery mechanisms. It displays error prompts when errors exceed threshold limits.
 *
 * @example
 *   ```tsx
 *   const { managePlaybackErrors } = usePlaybackErrors(
 *     player,
 *     changePromptMenuData
 *   );
 *
 *   // Use in error handler
 *   player.addEventListener('error', (err) => managePlaybackErrors(err));
 *   ```;
 *
 * @param player - The HTMLAudioElement instance
 * @param changePromptMenuData - Function to show error prompts to user
 * @returns Object containing error management functions
 */
export function usePlaybackErrors(
  player: HTMLAudioElement,
  changePromptMenuData: (isVisible?: boolean, prompt?: React.ReactNode | null) => void
) {
  const { t } = useTranslation();
  const repetitivePlaybackErrorsCountRef = useRef(0);
  const retryCountRef = useRef(0);
  const currentSongData = useStore(store, (state) => state.currentSongData);

  // ★ 切歌时重置重试/错误计数:否则 retryCountRef 跨歌曲累积,
  // 某首歌耗尽 2 次重试后,后续所有网络错误(code 2/4)都不再静默重试,直接弹错
  const currentSongId = currentSongData?.songId;
  useEffect(() => {
    repetitivePlaybackErrorsCountRef.current = 0;
    retryCountRef.current = 0;
  }, [currentSongId]);

  const managePlaybackErrors = useCallback(
    async (appError: unknown) => {
      const playerErrorData = player.error;
      console.error(appError, playerErrorData);

      // 网络类错误(2=network / 4=format,如 CDN 断连)重试无意义 — 立即提示,跳过 5 次静默重试
      const isNetworkError =
        !!playerErrorData && (playerErrorData.code === 2 || playerErrorData.code === 4);

      const prompt = (
        <ErrorPrompt
          reason="ERROR_IN_PLAYER"
          message={
            <Trans
              i18nKey="player.errorMessage"
              components={{
                br: <br />,
                details: (
                  <details className="mt-4">
                    {playerErrorData
                      ? `CODE ${playerErrorData.code} : ${playerErrorData.message}`
                      : t('player.noErrorMessage')}
                  </details>
                )
              }}
            />
          }
          showSendFeedbackBtn
        />
      );

      // ★ 网络类错误:CDN 连接不稳定(慢/中途断开)时,对网易云歌曲静默重试——
      // 强制重新解析 URL(API 负载均衡可能返回不同 CDN 主机),换 URL 重载。最多 2 次。
      if (isNetworkError && retryCountRef.current < 2) {
        retryCountRef.current += 1;
        const songId = store.state.currentSongData.songId;
        const failedSrc = player.src;
        const resumePosition = player.currentTime;
        const shouldResume = store.state.player.isCurrentSongPlaying;
        if (typeof songId === 'number' && songId < 0) {
          log(
            `Playback network error — retrying NCM re-resolution (attempt ${retryCountRef.current})`,
            { appError, playerErrorData },
            'WARN'
          );
          try {
            const { NcmPlaybackResolver } = await import('../music-source/netease/NcmPlaybackResolver');
            const result = await NcmPlaybackResolver.refreshUrl(-songId);
            if (store.state.currentSongData.songId !== songId || player.src !== failedSrc || store.state.player.isCurrentSongPlaying !== shouldResume) return;
            if (result.url) {
              player.src = result.url;
              player.load();
              player.currentTime = resumePosition;
              if (shouldResume) await player.play();
              return;
            }
          } catch (err) {
            console.error('[PLAYBACK_RETRY] re-resolution failed:', err);
          }
          if (store.state.currentSongData.songId !== songId || player.src !== failedSrc || store.state.player.isCurrentSongPlaying !== shouldResume) return;
          // Failed recovery falls through to the visible error prompt.
        }
      }

      if (isNetworkError || repetitivePlaybackErrorsCountRef.current > 5) {
        changePromptMenuData(true, prompt);
        return log(
          isNetworkError
            ? 'Playback network error — shown immediately without silent retries.'
            : 'Playback errors exceeded the 5 errors limit.',
          { appError, playerErrorData },
          'ERROR'
        );
      }

      repetitivePlaybackErrorsCountRef.current += 1;
      const prevSongPosition = player.currentTime;
      log(`Error occurred in the player.`, { appError, playerErrorData }, 'ERROR');

      if (player.src && playerErrorData) {
        player.load();
        player.currentTime = prevSongPosition;
      } else {
        player.pause();
        changePromptMenuData(true, prompt);
      }
      return undefined;
    },
    [changePromptMenuData, player, t]
  );

  return {
    managePlaybackErrors
  };
}
