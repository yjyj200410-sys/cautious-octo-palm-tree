import { createFileRoute, Navigate } from '@tanstack/react-router';
export const Route = createFileRoute('/main-player/artists/')({
  component: () => <Navigate to="/main-player/home" />
});
