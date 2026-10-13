import { createFileRoute, Navigate } from '@tanstack/react-router';
export const Route = createFileRoute('/main-player/songs/$songId')({
  component: () => <Navigate to="/main-player/home" />
});
