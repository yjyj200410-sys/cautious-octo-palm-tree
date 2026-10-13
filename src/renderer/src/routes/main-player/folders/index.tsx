import { createFileRoute, Navigate } from '@tanstack/react-router';
export const Route = createFileRoute('/main-player/folders/')({
  component: () => <Navigate to="/main-player/home" />
});
