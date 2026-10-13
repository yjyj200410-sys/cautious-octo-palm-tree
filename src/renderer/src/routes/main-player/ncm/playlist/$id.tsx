import { createFileRoute, Navigate } from '@tanstack/react-router';
export const Route = createFileRoute('/main-player/ncm/playlist/$id')({
  component: () => <Navigate to="/main-player/home" />
});
