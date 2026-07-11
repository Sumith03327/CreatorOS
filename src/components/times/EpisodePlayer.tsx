'use client';

import { Play, X, ExternalLink } from 'lucide-react';
import { cn } from '@/lib/utils';
import { timeAgo } from '@/lib/video-utils';
import type { FeedItem } from '@/lib/feed-sources';

interface EpisodePlayerProps {
  episode: FeedItem;
  /** Seconds to start at, or null when the player is closed. */
  seekTo: number | null;
  onOpen: (seconds: number) => void;
  onClose: () => void;
}

/**
 * The briefing itself — poster until you want it, embedded player once you do.
 *
 * Every extracted change links here rather than to youtube.com: the claim and the
 * receipt for the claim belong on the same screen. Seeking is done by remounting
 * the iframe with a new `start` (keyed on `seekTo`), which is exact and needs no
 * YouTube IFrame API.
 */
export function EpisodePlayer({ episode, seekTo, onOpen, onClose }: EpisodePlayerProps) {
  const videoId = episode.videoId;
  if (!videoId) return null;

  const poster = episode.thumbnail || `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
  const isOpen = seekTo !== null;

  return (
    <div className="overflow-hidden rounded-2xl border border-border/60 bg-muted/30">
      {isOpen ? (
        <div className="relative">
          <div className="aspect-video w-full">
            <iframe
              key={seekTo}
              src={`https://www.youtube.com/embed/${videoId}?start=${Math.max(0, seekTo)}&autoplay=1&rel=0`}
              title={episode.title}
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; picture-in-picture"
              allowFullScreen
              className="h-full w-full"
            />
          </div>
          <button
            onClick={onClose}
            aria-label="Close player"
            className="absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-full bg-black/70 text-white transition hover:bg-black"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ) : (
        <button
          onClick={() => onOpen(0)}
          className="group flex w-full items-center gap-4 p-3 text-left transition hover:bg-muted/50"
        >
          <div className="relative aspect-video w-40 shrink-0 overflow-hidden rounded-lg">
            <img src={poster} alt="" className="h-full w-full object-cover" />
            <div className="absolute inset-0 flex items-center justify-center bg-black/25 transition group-hover:bg-black/10">
              <span className="flex h-9 w-9 items-center justify-center rounded-full bg-white/95 shadow">
                <Play className="ml-0.5 h-4 w-4 fill-black text-black" />
              </span>
            </div>
          </div>

          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-bold">{episode.title}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Creator Insider · {timeAgo(episode.publishedAt)}
            </p>
            <p className="mt-1.5 text-[11px] text-muted-foreground/80">
              Play here, or click any timestamp below to jump straight to it.
            </p>
          </div>

          <a
            href={episode.url}
            target="_blank"
            rel="noreferrer"
            onClick={e => e.stopPropagation()}
            aria-label="Open on YouTube"
            className={cn(
              'mr-2 shrink-0 rounded-lg p-2 text-muted-foreground/50 transition',
              'hover:bg-background hover:text-primary'
            )}
          >
            <ExternalLink className="h-4 w-4" />
          </a>
        </button>
      )}
    </div>
  );
}
