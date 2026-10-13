import { createFileRoute, Navigate } from '@tanstack/react-router';
export const Route = createFileRoute('/main-player/playlists/history')({
  component: () => <Navigate to="/main-player/home" />
});
