import { useContext, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNcmUser } from '../contexts/NcmUserContext';
import { AppUpdateContext } from '../contexts/AppUpdateContext';
import { NcmRepository, proxyCoverUrl, type NcmPlaylist } from '../ncm';
import Button from './Button';

interface Props {
  onSelectPlaylist: (playlist: NcmPlaylist) => void;
  onBack?: () => void;
}

export default function NcmPlaylistsPage({ onSelectPlaylist, onBack }: Props) {
  const { profile } = useNcmUser();
  const { isMultipleSelectionEnabled, toggleMultipleSelections } = useContext(AppUpdateContext);
  const { t } = useTranslation();
  const [playlists, setPlaylists] = useState<NcmPlaylist[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!profile?.userId) return;
    setLoading(true);
    setError('');
    NcmRepository.getUserPlaylists(profile.userId)
      .then(setPlaylists)
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false));
  }, [profile?.userId]);

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center p-8">
        <span className="text-sm text-gray-400">加载歌单中...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-8">
        <div className="rounded-md bg-red-900/30 px-4 py-3 text-sm text-red-300">{error}</div>
        <button onClick={onBack} className="mt-4 text-sm text-purple-400">← 返回</button>
      </div>
    );
  }

  if (playlists.length === 0) {
    return (
      <div className="p-8">
        <div className="py-12 text-center text-sm text-gray-500">暂无歌单</div>
        {onBack && <button onClick={onBack} className="mt-4 text-sm text-purple-400">← 返回</button>}
      </div>
    );
  }

  return (
    <div className="p-6">
      <div className="mb-4 flex items-center gap-3">
        {onBack && (
          <button onClick={onBack} className="text-sm text-purple-400">←</button>
        )}
        <h2 className="text-lg font-semibold">我的歌单</h2>
        <span className="text-xs text-gray-500">{playlists.length} 个</span>
        <div className="ml-auto">
          <Button
            className="select-btn text-sm md:text-lg md:[&>.button-label-text]:hidden md:[&>.icon]:mr-0"
            iconName={isMultipleSelectionEnabled ? 'remove_done' : 'checklist'}
            clickHandler={() => toggleMultipleSelections(!isMultipleSelectionEnabled, 'playlist')}
            tooltipLabel={t(`common.${isMultipleSelectionEnabled ? 'unselectAll' : 'select'}`)}
            isDisabled={playlists.length === 0}
          />
        </div>
      </div>

      <div className="space-y-1">
        {playlists.map((pl) => (
          <div
            key={pl.playlistId}
            onClick={() => onSelectPlaylist(pl)}
            className="flex cursor-pointer items-center gap-3 rounded-md px-3 py-2 transition-colors hover:bg-white/10"
          >
            <img
              src={proxyCoverUrl(pl.coverUrl)}
              alt=""
              className="h-12 w-12 rounded-md"
              style={{ objectFit: 'cover' }}
            />
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium">{pl.name}</div>
              <div className="text-xs text-gray-500">
                {pl.trackCount} 首 · {pl.creatorName}
              </div>
            </div>
            <div className="text-xs text-gray-600">
              {pl.playCount > 0 ? `${Math.floor(pl.playCount / 10000)}万次` : ''}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
