import { createFileRoute, Navigate } from '@tanstack/react-router';
export const Route = createFileRoute('/main-player/ncm/discover/playlists')({
  component: () => <Navigate to="/main-player/home" />
});
