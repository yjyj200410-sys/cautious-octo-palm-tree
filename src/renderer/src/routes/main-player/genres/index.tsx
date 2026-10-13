import { createFileRoute, Navigate } from '@tanstack/react-router';
export const Route = createFileRoute('/main-player/genres/')({
  component: () => <Navigate to="/main-player/home" />
});
