import { createFileRoute, Navigate } from '@tanstack/react-router';
export const Route = createFileRoute('/main-player/folders/$folderPath')({
  component: () => <Navigate to="/main-player/home" />
});
