'use client';

import Image from 'next/image';
import { Bookmark, BookmarkPlus, Zap, Scissors } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { formatCompact, formatDuration, timeAgo } from '@/lib/video-utils';
import { formatMultiplier, outlierTier } from '@/lib/research-metrics';
import type { ResearchVideo } from '@/services/youtube';

interface OutlierCardProps {
  video: ResearchVideo;
  isSaved: boolean;
  onToggleSave: (video: ResearchVideo) => void;
  onAnalyse: (video: ResearchVideo) => void;
  onTeardown: (video: ResearchVideo) => void;
}

const BASELINE_EXPLANATION: Record<ResearchVideo['baselineSource'], string> = {
  'recent-format': "the median of this channel's recent uploads of the same length",
  'recent-overall': "the median of this channel's recent uploads",
  lifetime: "this channel's all-time average views per video (no recent sample available)",
};

export function OutlierCard({ video, isSaved, onToggleSave, onAnalyse, onTeardown }: OutlierCardProps) {
  const tier = outlierTier(video.outlierScore);
  const duration = formatDuration(video.duration);

  return (
    <Card className="overflow-hidden border-none shadow-sm bg-white group flex flex-col">
      <div className="relative aspect-video">
        <Image src={video.thumbnail} alt={video.title} fill className="object-cover" />

        <Tooltip>
          <TooltipTrigger asChild>
            <span
              className={cn(
                'absolute top-2 left-2 rounded-full px-2.5 py-1 text-xs font-bold tabular-nums shadow-sm',
                tier.className
              )}
            >
              {formatMultiplier(video.outlierScore)}
            </span>
          </TooltipTrigger>
          <TooltipContent side="right" className="max-w-64">
            <p className="font-semibold">{tier.label}</p>
            <p className="text-xs opacity-90">
              {formatCompact(video.viewCount)} views against a baseline of {formatCompact(video.baseline)} —{' '}
              {BASELINE_EXPLANATION[video.baselineSource]}.
            </p>
          </TooltipContent>
        </Tooltip>

        <button
          onClick={() => onToggleSave(video)}
          aria-label={isSaved ? 'Remove from watchlist' : 'Save to watchlist'}
          className={cn(
            'absolute top-2 right-2 h-8 w-8 rounded-full flex items-center justify-center transition-all',
            isSaved ? 'bg-primary/90 text-white' : 'bg-black/50 text-white hover:bg-black/70'
          )}
        >
          {isSaved ? <Bookmark className="h-4 w-4 fill-white" /> : <BookmarkPlus className="h-4 w-4" />}
        </button>

        {duration && (
          <span className="absolute bottom-2 right-2 rounded bg-black/80 px-1.5 py-0.5 text-[10px] font-semibold text-white tabular-nums">
            {duration}
          </span>
        )}
      </div>

      <CardContent className="p-4 space-y-3 flex-1 flex flex-col">
        <h4 className="text-sm font-bold line-clamp-2 h-10">{video.title}</h4>

        <div className="flex justify-between text-[10px] text-slate-400">
          <span className="truncate pr-2">{video.channelTitle}</span>
          <span className="shrink-0">{formatCompact(video.subscriberCount)} subs</span>
        </div>

        <div className="grid grid-cols-3 gap-1 rounded-lg bg-slate-50 p-2 text-center">
          <Stat label="Views" value={formatCompact(video.viewCount)} />
          <Stat label="Views/hr" value={formatCompact(Math.round(video.vph))} icon={<Zap className="h-2.5 w-2.5" />} />
          <Stat label="Age" value={timeAgo(video.publishedAt)} />
        </div>

        <div className="mt-auto flex gap-2 pt-1">
          <Button variant="outline" className="flex-1 h-8 text-xs font-bold" onClick={() => onAnalyse(video)}>
            Channel
          </Button>
          <Button className="flex-1 h-8 text-xs font-bold gap-1.5" onClick={() => onTeardown(video)}>
            <Scissors className="h-3 w-3" /> Teardown
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function Stat({ label, value, icon }: { label: string; value: string; icon?: React.ReactNode }) {
  return (
    <div>
      <p className="flex items-center justify-center gap-0.5 text-[9px] font-bold uppercase text-slate-400">
        {icon}
        {label}
      </p>
      <p className="text-xs font-bold tabular-nums">{value}</p>
    </div>
  );
}
