import { createFileRoute, Navigate } from '@tanstack/react-router';
export const Route = createFileRoute('/mini-player/')({
  component: () => <Navigate to="/main-player/home" />
});
