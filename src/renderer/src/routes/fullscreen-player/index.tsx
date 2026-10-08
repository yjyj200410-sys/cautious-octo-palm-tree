import { AppUpdateContext } from '@renderer/contexts/AppUpdateContext';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useContext, useEffect } from 'react';

export const Route = createFileRoute('/fullscreen-player/')({
  component: LegacyFullScreenRedirect
});

/** Keeps old bookmarks/history entries compatible with the state-driven player overlay. */
function LegacyFullScreenRedirect() {
  const navigate = useNavigate();
  const { updatePlayerType } = useContext(AppUpdateContext);

  useEffect(() => {
    updatePlayerType('full');
    void navigate({ to: '/main-player/home', replace: true });
  }, [navigate, updatePlayerType]);

  return null;
}
