import { createFileRoute, Navigate } from '@tanstack/react-router';
export const Route = createFileRoute('/fullscreen-player/')({
  component: () => <Navigate to="/main-player/home" />
});
