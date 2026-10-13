import { createFileRoute, Outlet } from '@tanstack/react-router';
export const Route = createFileRoute('/main-player')({ component: () => <Outlet /> });
