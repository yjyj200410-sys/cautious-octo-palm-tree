import VoloPlayer from '@renderer/components/Volo/VoloPlayer';
import { createFileRoute } from '@tanstack/react-router';
export const Route = createFileRoute('/main-player/home/')({ component: VoloPlayer });
