'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { SidebarNav } from '@/components/dashboard/SidebarNav';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import {
  RefreshCw,
  X,
  ChevronDown,
  Bookmark,
  BookmarkPlus,
  ArrowRight,
  Database,
  SearchX,
  Rocket,
  TrendingUp,
  TrendingDown,
  Info,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { fetchBoomingChannels, type BoomingChannel } from '@/services/youtube';
import { doc, getDoc, setDoc, serverTimestamp } from '@/firebase';
import { toast } from '@/hooks/use-toast';
import { RESEARCH_NICHES } from '@/lib/niches';
import { getChannelWatchlist, saveChannelWatchlist, type WatchlistChannel } from '@/lib/watchlist';
import { momentumTier, toNum } from '@/lib/research-metrics';
import { formatCompact } from '@/lib/video-utils';

interface FilterState {
  niche: string;
  sortBy: string;
  perPage: number;
}

const DEFAULT_FILTERS: FilterState = { niche: 'Finance', sortBy: 'momentum', perPage: 12 };
const PER_PAGE_OPTIONS = [12, 24, 36];

// Matches the 6h window used for trending videos on the Content tab.
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;

const MOMENTUM_EXPLANATION =
  "Measured from this channel's last 50 uploads: how fast the newest ones are gaining views, and whether they beat the channel's own slightly older videos. A channel that was big years ago but is quiet now scores low.";

export default function ChannelInsightsPage() {
  const router = useRouter();
  const [mounted, setMounted] = useState(false);
  const [filters, setFilters] = useState<FilterState>(DEFAULT_FILTERS);
  const [data, setData] = useState<BoomingChannel[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [watchlistItems, setWatchlistItems] = useState<WatchlistChannel[]>([]);
  const [isWatchlistOpen, setIsWatchlistOpen] = useState(false);
  const [resilienceMode, setResilienceMode] = useState(false);

  useEffect(() => {
    setMounted(true);
    setWatchlistItems(getChannelWatchlist());
  }, []);

  const fetchInsights = useCallback(
    async (isManualRefresh = false) => {
      const cacheRef = doc('channelInsightsCache', `channels_${filters.niche.replace(/\s+/g, '')}`);
      setIsLoading(true);
      setResilienceMode(false);

      try {
        const cacheSnap = await getDoc(cacheRef);
        const cached = cacheSnap.data();
        const isFresh = cacheSnap.exists() && Date.now() - new Date(cached?.cachedAt).getTime() < CACHE_TTL_MS;

        if (!isManualRefresh && isFresh) {
          setData(cached?.channels || []);
          return;
        }

        const freshData = await fetchBoomingChannels(filters.niche);
        if (freshData.length > 0) {
          setData(freshData);
          setDoc(cacheRef, { channels: freshData, cachedAt: serverTimestamp() });
        } else if (cacheSnap.exists()) {
          setData(cached?.channels || []);
        } else {
          setData([]);
        }
      } catch (apiErr: any) {
        console.warn('API error:', apiErr.message);
        setResilienceMode(true);
        const cacheSnap = await getDoc(cacheRef);
        const cached = cacheSnap.data();
        if (cacheSnap.exists()) setData(cached?.channels || []);
        else toast({ variant: 'destructive', title: 'API Limit Reached', description: 'Showing cached data if available.' });
      } finally {
        setIsLoading(false);
      }
    },
    [filters.niche]
  );

  useEffect(() => {
    if (mounted) fetchInsights();
  }, [fetchInsights, mounted]);

  const toggleBookmark = (channel: BoomingChannel | WatchlistChannel) => {
    const id = channel.id;
    const isSaved = watchlistItems.some(item => item.id === id);

    if (isSaved) {
      const next = watchlistItems.filter(item => item.id !== id);
      setWatchlistItems(next);
      saveChannelWatchlist(next);
      toast({ title: 'Removed from Watchlist' });
      return;
    }

    const source = channel as BoomingChannel;
    const subscriberCount = toNum(source.statistics?.subscriberCount);
    const next: WatchlistChannel[] = [
      ...watchlistItems,
      {
        id: source.id,
        channelName: source.title,
        handle: source.handle,
        avatarUrl: source.thumbnails?.default?.url,
        subscriberCount,
        subscriberCountAtSave: subscriberCount,
        uploadsPerMonth: source.uploadsPerMonth,
        viewCount: toNum(source.statistics?.viewCount),
        growthScore: source.growthScore,
        niche: filters.niche,
        savedAt: new Date().toISOString(),
      },
    ];
    setWatchlistItems(next);
    saveChannelWatchlist(next);
    toast({ title: 'Added to Watchlist' });
  };

  const updateFilter = (key: keyof FilterState, value: any) => setFilters(prev => ({ ...prev, [key]: value }));

  const breakouts = useMemo(() => data.filter(channel => channel.isBreakout), [data]);

  const sortedChannels = useMemo(() => {
    const comparators: Record<string, (a: BoomingChannel, b: BoomingChannel) => number> = {
      momentum: (a, b) => b.growthScore - a.growthScore,
      lift: (a, b) => b.lift - a.lift,
      subs: (a, b) => toNum(b.statistics.subscriberCount) - toNum(a.statistics.subscriberCount),
    };
    return [...data].sort(comparators[filters.sortBy] ?? comparators.momentum).slice(0, filters.perPage);
  }, [data, filters.sortBy, filters.perPage]);

  const viewAnalytics = (channelId: string) =>
    router.push(`/?url=${encodeURIComponent(`https://www.youtube.com/channel/${channelId}`)}`);

  if (!mounted) return null;

  return (
    <TooltipProvider delayDuration={150}>
      <div className="flex h-screen overflow-hidden bg-background">
        <SidebarNav />
        <main className="relative flex-1 overflow-y-auto p-8">
          {watchlistItems.length > 0 && (
            <Collapsible open={isWatchlistOpen} onOpenChange={setIsWatchlistOpen} className="mb-8">
              <CollapsibleTrigger asChild>
                <div className="flex cursor-pointer items-center justify-between rounded-2xl bg-slate-900 p-4">
                  <div className="flex items-center gap-3">
                    <Bookmark className="h-5 w-5 fill-[#7B5CF0] text-[#7B5CF0]" />
                    <span className="text-sm font-bold uppercase tracking-widest text-white">
                      My Watchlist ({watchlistItems.length})
                    </span>
                  </div>
                  <ChevronDown className={cn('h-5 w-5 text-slate-400', isWatchlistOpen && 'rotate-180')} />
                </div>
              </CollapsibleTrigger>
              <CollapsibleContent className="pt-4">
                <ScrollArea className="w-full pb-4">
                  <div className="flex gap-4">
                    {watchlistItems.map(item => (
                      <div
                        key={item.id}
                        className="group relative flex h-48 w-44 flex-col items-center justify-between rounded-2xl border border-slate-100 bg-white p-4 text-center"
                      >
                        <button
                          onClick={() => toggleBookmark(item)}
                          aria-label="Remove from watchlist"
                          className="absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded-full bg-slate-100 opacity-0 group-hover:opacity-100"
                        >
                          <X className="h-3 w-3" />
                        </button>
                        <div className="h-14 w-14 overflow-hidden rounded-full border-2">
                          <img src={item.avatarUrl} alt="" className="h-full w-full object-cover" />
                        </div>
                        <p className="w-full truncate text-xs font-bold">{item.channelName}</p>
                        <Badge className="border-none bg-[#7B5CF0]/10 text-[8px] uppercase text-[#7B5CF0]">
                          {item.niche}
                        </Badge>
                      </div>
                    ))}
                  </div>
                  <ScrollBar orientation="horizontal" />
                </ScrollArea>
              </CollapsibleContent>
            </Collapsible>
          )}

          <header className="mb-8 flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold tracking-tight text-slate-900">Channel Insights</h1>
              <p className="text-muted-foreground">Channels gaining ground right now — and what they changed to get there.</p>
            </div>
            <div className="flex items-center gap-3">
              {resilienceMode && (
                <Badge className="gap-1.5 border-none bg-amber-100 text-amber-700">
                  <Database className="h-3 w-3" /> Offline Mode
                </Badge>
              )}
              <Button variant="outline" onClick={() => fetchInsights(true)} disabled={isLoading} className="gap-2 rounded-full">
                <RefreshCw className={cn('h-3.5 w-3.5', isLoading && 'animate-spin')} /> Refresh
              </Button>
            </div>
          </header>

          <div className="mb-8 space-y-6 rounded-3xl border border-slate-100 bg-white/50 p-6">
            <div className="flex flex-wrap gap-2">
              {RESEARCH_NICHES.map(niche => (
                <Button
                  key={niche}
                  variant={filters.niche === niche ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => updateFilter('niche', niche)}
                  className={cn('rounded-full px-5', filters.niche === niche && 'bg-[#7B5CF0]')}
                >
                  {niche}
                </Button>
              ))}
            </div>
            <div className="flex items-center gap-4">
              <Select value={filters.sortBy} onValueChange={value => updateFilter('sortBy', value)}>
                <SelectTrigger className="w-48 rounded-xl border-none bg-slate-50">
                  <SelectValue placeholder="Sort By" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="momentum">Momentum</SelectItem>
                  <SelectItem value="lift">Beating their own average</SelectItem>
                  <SelectItem value="subs">Subscribers</SelectItem>
                </SelectContent>
              </Select>
              <Select value={String(filters.perPage)} onValueChange={value => updateFilter('perPage', parseInt(value))}>
                <SelectTrigger className="w-32 rounded-xl border-none bg-slate-50">
                  <SelectValue placeholder="Show" />
                </SelectTrigger>
                <SelectContent>
                  {PER_PAGE_OPTIONS.map(n => (
                    <SelectItem key={n} value={String(n)}>
                      Show {n}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {breakouts.length > 0 && !isLoading && (
            <section className="mb-8 rounded-3xl border border-rose-100 bg-rose-50/50 p-6">
              <div className="mb-4 flex items-center gap-2">
                <Rocket className="h-4 w-4 text-rose-600" />
                <h2 className="text-sm font-bold text-rose-900">Breakout radar</h2>
                <span className="text-xs text-rose-700/70">
                  Under 18 months old and already moving fast. Their early videos are a recipe that worked without an audience.
                </span>
              </div>
              <div className="flex flex-wrap gap-3">
                {breakouts.map(channel => (
                  <button
                    key={channel.id}
                    onClick={() => viewAnalytics(channel.id)}
                    className="flex items-center gap-3 rounded-2xl border border-rose-100 bg-white px-4 py-2.5 text-left transition hover:shadow-sm"
                  >
                    <img src={channel.thumbnails.default.url} alt="" className="h-8 w-8 rounded-full" />
                    <div>
                      <p className="max-w-40 truncate text-xs font-bold text-slate-900">{channel.title}</p>
                      <p className="text-[10px] text-slate-500">
                        {channel.channelAgeMonths}mo old · {formatCompact(channel.statistics.subscriberCount)} subs
                      </p>
                    </div>
                  </button>
                ))}
              </div>
            </section>
          )}

          {!isLoading && sortedChannels.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-3 rounded-3xl border border-dashed border-slate-200 py-24 text-center">
              <SearchX className="h-8 w-8 text-slate-300" />
              <p className="text-sm font-bold text-slate-700">No channels found for "{filters.niche}"</p>
              <p className="max-w-xs text-xs text-muted-foreground">
                Try a different niche or hit refresh — YouTube's channel search can be sparse for narrower topics.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
              {isLoading
                ? Array(6)
                    .fill(0)
                    .map((_, i) => <Skeleton key={i} className="h-64 rounded-2xl" />)
                : sortedChannels.map(channel => (
                    <ChannelCard
                      key={channel.id}
                      channel={channel}
                      niche={filters.niche}
                      isSaved={watchlistItems.some(item => item.id === channel.id)}
                      onToggleSave={toggleBookmark}
                      onViewAnalytics={viewAnalytics}
                    />
                  ))}
            </div>
          )}
        </main>
      </div>
    </TooltipProvider>
  );
}

function ChannelCard({
  channel,
  niche,
  isSaved,
  onToggleSave,
  onViewAnalytics,
}: {
  channel: BoomingChannel;
  niche: string;
  isSaved: boolean;
  onToggleSave: (channel: BoomingChannel) => void;
  onViewAnalytics: (channelId: string) => void;
}) {
  const tier = momentumTier(channel.growthScore);
  const heatingUp = channel.lift >= 1;

  return (
    <Card className="group relative transition-all hover:shadow-lg">
      <CardContent className="space-y-6 p-6">
        <button
          onClick={() => onToggleSave(channel)}
          aria-label={isSaved ? 'Remove from watchlist' : 'Save to watchlist'}
          className={cn(
            'absolute right-3 top-3 z-10 flex h-10 w-10 items-center justify-center rounded-full transition-all',
            isSaved ? 'bg-[#7B5CF0]/10 text-[#7B5CF0]' : 'bg-slate-50 text-slate-400'
          )}
        >
          {isSaved ? <Bookmark className="h-5 w-5 fill-[#7B5CF0]" /> : <BookmarkPlus className="h-5 w-5" />}
        </button>

        <div className="flex items-center gap-4">
          <div className="h-14 w-14 shrink-0 overflow-hidden rounded-full border-2">
            <img src={channel.thumbnails.default.url} alt="" className="h-full w-full object-cover" />
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="truncate font-bold text-slate-900">{channel.title}</h3>
            <div className="mt-1 flex items-center gap-2">
              <Badge className="border-none bg-[#7B5CF0]/10 text-[8px] font-bold uppercase text-[#7B5CF0]">{niche}</Badge>
              <span className="text-[10px] font-bold text-slate-600">
                {formatCompact(channel.statistics.subscriberCount)} subs
              </span>
              {channel.isBreakout && (
                <Badge className="border-none bg-rose-500 text-[8px] font-bold uppercase text-white">Breakout</Badge>
              )}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-2 rounded-2xl bg-slate-50 p-3 text-center">
          <div>
            <p className="text-[9px] font-bold uppercase text-slate-400">Uploads</p>
            <p className="text-sm font-bold">{channel.uploadsPerMonth}/mo</p>
          </div>

          <Tooltip>
            <TooltipTrigger asChild>
              <div className="cursor-default">
                <p className="flex items-center justify-center gap-0.5 text-[9px] font-bold uppercase text-slate-400">
                  Trend <Info className="h-2.5 w-2.5" />
                </p>
                <p className={cn('flex items-center justify-center gap-0.5 text-sm font-bold', heatingUp ? 'text-emerald-600' : 'text-slate-500')}>
                  {heatingUp ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
                  {channel.lift > 0 ? `${channel.lift.toFixed(1)}x` : '—'}
                </p>
              </div>
            </TooltipTrigger>
            <TooltipContent className="max-w-64">
              <p className="text-xs">
                Their newest uploads median {formatCompact(channel.recentMedianViews)} views, against the median of
                their own older uploads. Above 1x means the channel is climbing; below means it's cooling off. Newer
                videos are still collecting views, so read anything near 1x as flat.
              </p>
            </TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <div className="cursor-default">
                <p className="flex items-center justify-center gap-0.5 text-[9px] font-bold uppercase text-slate-400">
                  Momentum <Info className="h-2.5 w-2.5" />
                </p>
                <p className={cn('text-sm font-bold', tier.className)}>{channel.growthScore}/100</p>
                <p className={cn('text-[8px] font-bold uppercase', tier.className)}>{tier.label}</p>
              </div>
            </TooltipTrigger>
            <TooltipContent className="max-w-64">
              <p className="text-xs">
                {MOMENTUM_EXPLANATION}
                {!channel.hasRecentData && ' We could not sample this channel\'s recent uploads, so treat this as provisional.'}
              </p>
            </TooltipContent>
          </Tooltip>
        </div>

        <Button
          className="w-full rounded-xl bg-slate-900 text-white hover:bg-[#7B5CF0]"
          onClick={() => onViewAnalytics(channel.id)}
        >
          View Analytics <ArrowRight className="ml-2 h-4 w-4" />
        </Button>
      </CardContent>
    </Card>
  );
}
