import { createFileRoute, Navigate } from '@tanstack/react-router';
export const Route = createFileRoute('/main-player/playlists/$playlistId')({
  component: () => <Navigate to="/main-player/home" />
});
