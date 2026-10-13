import { createFileRoute, Navigate } from '@tanstack/react-router';
export const Route = createFileRoute('/main-player/albums/$albumId')({
  component: () => <Navigate to="/main-player/home" />
});
