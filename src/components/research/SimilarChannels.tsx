'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  Users,
  ArrowUpRight,
  Star,
  Link2,
  Search,
  SearchX,
  ChevronDown,
  Radar,
} from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { formatCompact } from '@/lib/video-utils';
import { findSimilarChannels, type SimilarChannel } from '@/services/youtube';

interface SimilarChannelsProps {
  channelId: string;
  channelTitle: string;
  onAnalyse: (channelId: string) => void;
}

/** Shown before the "much bigger" group is collapsed away. */
const PEERS_SHOWN = 6;

export function SimilarChannels({ channelId, channelTitle, onAnalyse }: SimilarChannelsProps) {
  const [channels, setChannels] = useState<SimilarChannel[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (!channelId) return;
    let cancelled = false;

    setLoading(true);
    setError(null);
    setChannels(null);
    setExpanded(false);

    findSimilarChannels(channelId)
      .then(result => !cancelled && setChannels(result))
      .catch((e: any) => !cancelled && setError(e?.message || 'Could not find similar channels.'))
      .finally(() => !cancelled && setLoading(false));

    return () => {
      cancelled = true;
    };
  }, [channelId]);

  // Grouped by *why* they matched. A single ranked list hides the fact that
  // "shares your actual viewers" and "ranked for a search once" are different
  // claims with very different value to a creator.
  const { audience, peers, giants, topScore } = useMemo(() => {
    const all = channels ?? [];
    return {
      audience: all.filter(c => c.matchKind === 'audience' && c.isPeer),
      peers: all.filter(c => c.matchKind !== 'audience' && c.isPeer),
      giants: all.filter(c => !c.isPeer),
      topScore: Math.max(1, ...all.map(c => c.score)),
    };
  }, [channels]);

  if (loading) return <LoadingState />;

  if (error || (channels && channels.length === 0)) {
    return (
      <Card className="border-none bg-card p-6 shadow-sm">
        <SectionHeader channelTitle={channelTitle} count={0} hasAudienceSignal={false} />
        <div className="mt-4 flex items-center gap-3 rounded-xl border border-dashed border-border p-4 text-sm text-muted-foreground">
          <SearchX className="h-4 w-4 shrink-0" />
          {error ?? `No channels came back clearly similar to ${channelTitle}.`}
        </div>
      </Card>
    );
  }

  if (!channels) return null;

  const visiblePeers = expanded ? peers : peers.slice(0, PEERS_SHOWN);

  return (
    <TooltipProvider delayDuration={150}>
      <Card className="space-y-6 border-none bg-card p-6 shadow-sm">
        <SectionHeader channelTitle={channelTitle} count={channels.length} hasAudienceSignal={audience.length > 0} />

        {audience.length > 0 && (
          <Group
            title="Shares this channel's audience"
            hint="Measured — these channels' commenters also comment here"
            accent="emerald"
          >
            {audience.map(channel => (
              <ChannelRow key={channel.id} channel={channel} channelTitle={channelTitle} onAnalyse={onAnalyse} topScore={topScore} />
            ))}
          </Group>
        )}

        {peers.length > 0 && (
          <Group
            title="Competes for the same viewers"
            hint="Similar size, ranking for the same searches"
            accent="primary"
          >
            {visiblePeers.map(channel => (
              <ChannelRow key={channel.id} channel={channel} channelTitle={channelTitle} onAnalyse={onAnalyse} topScore={topScore} />
            ))}
            {peers.length > PEERS_SHOWN && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setExpanded(v => !v)}
                className="h-8 w-full text-xs font-semibold text-muted-foreground"
              >
                {expanded ? 'Show fewer' : `Show ${peers.length - PEERS_SHOWN} more`}
                <ChevronDown className={cn('ml-1 h-3.5 w-3.5 transition', expanded && 'rotate-180')} />
              </Button>
            )}
          </Group>
        )}

        {giants.length > 0 && (
          <Collapsible>
            <CollapsibleTrigger asChild>
              <button className="group flex w-full items-center justify-between rounded-xl border border-border/60 px-4 py-2.5 text-left transition hover:border-border">
                <span className="text-xs font-semibold text-muted-foreground">
                  {giants.length} much larger {giants.length === 1 ? 'channel' : 'channels'} in this space
                </span>
                <ChevronDown className="h-4 w-4 text-muted-foreground transition group-data-[state=open]:rotate-180" />
              </button>
            </CollapsibleTrigger>
            <CollapsibleContent className="space-y-1.5 pt-2">
              <p className="px-1 pb-1 text-[11px] text-muted-foreground/80">
                They rank for the same topics, but they're too far from {channelTitle} in size to copy.
              </p>
              {giants.map(channel => (
                <ChannelRow key={channel.id} channel={channel} channelTitle={channelTitle} onAnalyse={onAnalyse} topScore={topScore} dimmed />
              ))}
            </CollapsibleContent>
          </Collapsible>
        )}
      </Card>
    </TooltipProvider>
  );
}

// --- Pieces -----------------------------------------------------------------

function SectionHeader({
  channelTitle,
  count,
  hasAudienceSignal,
}: {
  channelTitle: string;
  count: number;
  hasAudienceSignal: boolean;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <div className="flex items-center gap-2">
          <Users className="h-4 w-4 text-primary" />
          <h2 className="text-lg font-bold tracking-tight">Similar channels</h2>
          {count > 0 && (
            <Badge className="border-none bg-muted px-1.5 text-[10px] font-bold tabular-nums text-muted-foreground">
              {count}
            </Badge>
          )}
        </div>
        <p className="mt-1 max-w-xl text-xs text-muted-foreground">
          {/* Don't claim a shared-audience ranking when no overlap was detected. */}
          {hasAudienceSignal
            ? `Ranked by how many of their engaged commenters also comment on ${channelTitle} — the closest thing YouTube exposes to a shared-audience measurement.`
            : `No shared-audience overlap was detected, so these are ranked by how closely they compete with ${channelTitle} for the same viewer searches.`}
        </p>
      </div>
    </div>
  );
}

function Group({
  title,
  hint,
  accent,
  children,
}: {
  title: string;
  hint: string;
  accent: 'emerald' | 'primary';
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-2">
      <div className="flex items-center gap-2">
        <span className={cn('h-1.5 w-1.5 rounded-full', accent === 'emerald' ? 'bg-emerald-500' : 'bg-primary')} />
        <h3 className="text-xs font-bold uppercase tracking-wider">{title}</h3>
        <span className="text-[11px] text-muted-foreground/80">— {hint}</span>
      </div>
      <div className="space-y-1.5">{children}</div>
    </section>
  );
}

function ChannelRow({
  channel,
  channelTitle,
  onAnalyse,
  topScore,
  dimmed,
}: {
  channel: SimilarChannel;
  channelTitle: string;
  onAnalyse: (channelId: string) => void;
  topScore: number;
  dimmed?: boolean;
}) {
  // The number is absolute confidence — a topic-only match honestly tops out
  // around 25. The bar is relative to the best match in this list, so the column
  // reads as a ranking instead of a row of uniformly stubby stumps.
  const barWidth = Math.max(6, Math.round((channel.score / topScore) * 100));
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onAnalyse(channel.id)}
      onKeyDown={e => (e.key === 'Enter' || e.key === ' ') && onAnalyse(channel.id)}
      className={cn(
        'group flex cursor-pointer items-center gap-3 rounded-xl border border-border/60 px-3 py-2 transition',
        'hover:border-primary/50 hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
        dimmed && 'opacity-70 hover:opacity-100'
      )}
    >
      <img src={channel.avatarUrl} alt="" className="h-9 w-9 shrink-0 rounded-full" />

      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <p className="truncate text-sm font-semibold leading-tight">{channel.title}</p>
          <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
            {formatCompact(channel.subscriberCount)}
          </span>
          {channel.sizeRatio > 0 && !channel.isPeer && (
            <span className="shrink-0 text-[10px] font-medium text-muted-foreground/70">
              {channel.sizeRatio >= 1 ? `${formatCompact(Math.round(channel.sizeRatio))}x bigger` : 'much smaller'}
            </span>
          )}
        </div>

        <div className="mt-1 flex flex-wrap items-center gap-1">
          {channel.audienceOverlap > 0 && (
            <Signal icon={<Users className="h-2.5 w-2.5" />} tone="emerald">
              {channel.sharedCommenters} shared commenters
            </Signal>
          )}
          {channel.featured && (
            <Signal icon={<Star className="h-2.5 w-2.5" />} tone="amber">
              Featured
            </Signal>
          )}
          {channel.cited && (
            <Signal icon={<Link2 className="h-2.5 w-2.5" />} tone="sky">
              Linked
            </Signal>
          )}
          {channel.coRankCount > 0 && (
            <Signal icon={<Search className="h-2.5 w-2.5" />} tone="muted">
              {channel.coRankCount} shared {channel.coRankCount === 1 ? 'query' : 'queries'}
            </Signal>
          )}
        </div>
      </div>

      <Tooltip>
        <TooltipTrigger asChild>
          <div className="hidden w-24 shrink-0 cursor-default sm:block" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <span className="text-[9px] font-bold uppercase text-muted-foreground">Match</span>
              <span className="text-xs font-bold tabular-nums">{channel.score}</span>
            </div>
            <div className="mt-1 h-1 overflow-hidden rounded-full bg-muted">
              <div
                className={cn('h-full rounded-full', channel.matchKind === 'audience' ? 'bg-emerald-500' : 'bg-primary')}
                style={{ width: `${barWidth}%` }}
              />
            </div>
          </div>
        </TooltipTrigger>
        <TooltipContent className="max-w-72">
          <p className="mb-1 text-xs font-semibold">Why this matched {channelTitle}</p>
          <ul className="space-y-0.5 text-xs">
            {channel.reasons.map((reason, i) => (
              <li key={i}>• {reason}</li>
            ))}
          </ul>
        </TooltipContent>
      </Tooltip>

      <ArrowUpRight className="h-4 w-4 shrink-0 text-muted-foreground/50 transition group-hover:text-primary" />
    </div>
  );
}

function Signal({
  icon,
  tone,
  children,
}: {
  icon: React.ReactNode;
  tone: 'emerald' | 'amber' | 'sky' | 'muted';
  children: React.ReactNode;
}) {
  const tones = {
    emerald: 'bg-emerald-500/10 text-emerald-600',
    amber: 'bg-amber-500/10 text-amber-600',
    sky: 'bg-sky-500/10 text-sky-600',
    muted: 'bg-muted text-muted-foreground',
  } as const;

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-semibold leading-none',
        tones[tone]
      )}
    >
      {icon}
      {children}
    </span>
  );
}

function LoadingState() {
  return (
    <Card className="space-y-4 border-none bg-card p-6 shadow-sm">
      <div className="flex items-center gap-2">
        <Radar className="h-4 w-4 animate-pulse text-primary" />
        <h2 className="text-lg font-bold tracking-tight">Similar channels</h2>
      </div>
      <p className="text-xs text-muted-foreground">
        Sampling commenters and checking who ranks for the same searches…
      </p>
      <div className="space-y-1.5">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="flex items-center gap-3 rounded-xl border border-border/60 px-3 py-2">
            <Skeleton className="h-9 w-9 shrink-0 rounded-full" />
            <div className="flex-1 space-y-1.5">
              <Skeleton className="h-3 w-40" />
              <Skeleton className="h-2.5 w-24" />
            </div>
            <Skeleton className="hidden h-6 w-24 sm:block" />
          </div>
        ))}
      </div>
    </Card>
  );
}
