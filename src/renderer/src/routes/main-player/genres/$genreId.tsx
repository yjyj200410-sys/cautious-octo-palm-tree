import { createFileRoute, Navigate } from '@tanstack/react-router';
export const Route = createFileRoute('/main-player/genres/$genreId')({
  component: () => <Navigate to="/main-player/home" />
});
