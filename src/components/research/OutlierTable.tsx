'use client';

import Image from 'next/image';
import { Bookmark, BookmarkPlus, Scissors } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { cn } from '@/lib/utils';
import { formatCompact, formatDuration, timeAgo } from '@/lib/video-utils';
import { formatMultiplier, outlierTier } from '@/lib/research-metrics';
import type { WatchlistVideo } from '@/lib/watchlist';
import type { ResearchVideo } from '@/services/youtube';

interface OutlierTableProps {
  videos: ResearchVideo[];
  watchlist: WatchlistVideo[];
  onToggleSave: (video: ResearchVideo) => void;
  onTeardown: (video: ResearchVideo) => void;
}

/**
 * The scanning view. Researchers compare rows; the card grid is for browsing.
 * Ordering is driven by the page's sort control, so no per-column sorting here.
 */
export function OutlierTable({ videos, watchlist, onToggleSave, onTeardown }: OutlierTableProps) {
  return (
    <div className="overflow-x-auto rounded-2xl border border-slate-100 bg-white">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className="w-24 text-[10px] font-bold uppercase tracking-wider">Outlier</TableHead>
            <TableHead className="text-[10px] font-bold uppercase tracking-wider">Video</TableHead>
            <TableHead className="text-right text-[10px] font-bold uppercase tracking-wider">Views</TableHead>
            <TableHead className="text-right text-[10px] font-bold uppercase tracking-wider">Views/hr</TableHead>
            <TableHead className="text-right text-[10px] font-bold uppercase tracking-wider">Subs</TableHead>
            <TableHead className="text-right text-[10px] font-bold uppercase tracking-wider">Length</TableHead>
            <TableHead className="text-right text-[10px] font-bold uppercase tracking-wider">Age</TableHead>
            <TableHead className="w-24" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {videos.map(video => {
            const tier = outlierTier(video.outlierScore);
            const isSaved = watchlist.some(item => item.id === video.id);

            return (
              <TableRow key={video.id} className="group">
                <TableCell>
                  <span className={cn('rounded-full px-2 py-0.5 text-xs font-bold tabular-nums', tier.className)}>
                    {formatMultiplier(video.outlierScore)}
                  </span>
                </TableCell>

                <TableCell className="max-w-md">
                  <div className="flex items-center gap-3">
                    <div className="relative h-9 w-16 shrink-0 overflow-hidden rounded">
                      <Image src={video.thumbnail} alt="" fill className="object-cover" />
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-slate-900">{video.title}</p>
                      <p className="truncate text-[11px] text-slate-400">{video.channelTitle}</p>
                    </div>
                  </div>
                </TableCell>

                <TableCell className="text-right text-sm tabular-nums">{formatCompact(video.viewCount)}</TableCell>
                <TableCell className="text-right text-sm tabular-nums">{formatCompact(Math.round(video.vph))}</TableCell>
                <TableCell className="text-right text-sm tabular-nums text-slate-500">
                  {formatCompact(video.subscriberCount)}
                </TableCell>
                <TableCell className="text-right text-sm tabular-nums text-slate-500">
                  {formatDuration(video.duration) || '—'}
                </TableCell>
                <TableCell className="text-right text-sm text-slate-500">{timeAgo(video.publishedAt)}</TableCell>

                <TableCell>
                  <div className="flex justify-end gap-1 opacity-0 transition group-hover:opacity-100">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => onToggleSave(video)}
                      aria-label={isSaved ? 'Remove from watchlist' : 'Save to watchlist'}
                      className="h-7 w-7 p-0"
                    >
                      {isSaved ? (
                        <Bookmark className="h-3.5 w-3.5 fill-primary text-primary" />
                      ) : (
                        <BookmarkPlus className="h-3.5 w-3.5" />
                      )}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => onTeardown(video)}
                      aria-label="Tear down this video"
                      className="h-7 w-7 p-0"
                    >
                      <Scissors className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
