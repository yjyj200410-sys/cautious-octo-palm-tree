import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Link, RouterProvider, createHashHistory, createRouter } from '@tanstack/react-router';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import LuminaLogo from './assets/images/logo_light_mode.png';
// Import the generated route tree
import { routeTree } from './routeTree.gen';
import './i18n';
import { installCustomTooltips } from './utils/customTooltips';

// Create a new router instance
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false, // default: true
      staleTime: 1000 * 60 * 1 // 1 minutes
    }
  }
});

const history = createHashHistory();
// Create a new router instance
export const router = createRouter({
  routeTree,
  history,
  notFoundMode: 'root',
  scrollRestoration: true,
  context: { queryClient },
  defaultPreload: 'intent',
  defaultPreloadDelay: 100,
  defaultPreloadStaleTime: 0,
  defaultViewTransition: false,
  defaultPendingMs: 1000, // Show pending component if loader exceeds 1 second
  defaultPendingMinMs: 0, // Ensure pending component is shown for at least 500ms
  // hydrate: (dehydrated) => {
  //   hydrate(queryClient, dehydrated.queryClientState);
  // },
  // dehydrate: () => {
  //   return { dehydratedState: dehydrate(queryClient) };
  // },
  defaultPendingComponent: () => {
    return (
      <div
        className="flex h-screen flex-col items-center justify-center gap-4"
        style={{ background: '#0a0a12' }}
      >
        <img src={LuminaLogo} alt="Volo" className="h-20 w-20 opacity-80" />
      </div>
    );
  },
  defaultNotFoundComponent: () => {
    return (
      <div className="flex h-screen flex-col items-center justify-center">
        <h1 className="text-3xl font-semibold">404 Not Found</h1>
        <Link
          to="/main-player/home"
          className="btn btn-primary bg-primary-button-background-color mt-4 rounded-md px-4 py-2"
        >
          Home
        </Link>
      </div>
    );
  }
});

// Register the router instance for type safety
declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}

// ── Renderer crash diagnostics ──────────────────────────────────
window.addEventListener('error', (e) => {
  console.error('[RENDERER CRASH] window.error:', e.error?.message || e.message, e.error?.stack);
});
window.addEventListener('unhandledrejection', (e) => {
  console.error(
    '[RENDERER CRASH] unhandledrejection:',
    e.reason?.message || e.reason,
    e.reason?.stack
  );
});

const container = document.getElementById('root') as HTMLElement;
const root = createRoot(container);

root.render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>
);

installCustomTooltips();
