'use client';

import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { SidebarNav } from '@/components/dashboard/SidebarNav';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
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
  channelSize: string;
  maxAge: string;
  formatFocus: string;
  breakoutsOnly: boolean;
}

const DEFAULT_FILTERS: FilterState = {
  niche: 'Finance',
  sortBy: 'momentum',
  perPage: 12,
  channelSize: 'any',
  maxAge: 'any',
  formatFocus: 'any',
  breakoutsOnly: false,
};

const PER_PAGE_OPTIONS = [12, 24, 36];

/**
 * Subscriber bands and the age cap are sent to the fetch, not applied to its
 * results — sampling a channel's uploads costs quota, and we'd rather not pay for
 * sixty channels to display four. A creator with 3K subs wants the 10K–100K band,
 * where the playbook still transfers.
 */
const CHANNEL_SIZES = [
  { label: 'Any size', value: 'any', subscriberMin: undefined, subscriberMax: undefined },
  { label: 'Nano (<10K)', value: 'nano', subscriberMin: undefined, subscriberMax: 10_000 },
  { label: 'Micro (10K–100K)', value: 'micro', subscriberMin: 10_000, subscriberMax: 100_000 },
  { label: 'Mid (100K–1M)', value: 'mid', subscriberMin: 100_000, subscriberMax: 1_000_000 },
  { label: 'Large (>1M)', value: 'large', subscriberMin: 1_000_000, subscriberMax: undefined },
];

const AGE_OPTIONS = [
  { label: 'Any age', value: 'any', maxAgeMonths: undefined },
  { label: 'Under 12 months', value: '12', maxAgeMonths: 12 },
  { label: 'Under 24 months', value: '24', maxAgeMonths: 24 },
  { label: 'Under 3 years', value: '36', maxAgeMonths: 36 },
];

const FORMAT_OPTIONS = [
  { label: 'Any format', value: 'any' },
  { label: 'Winning with long-form', value: 'long' },
  { label: 'Winning with Shorts', value: 'shorts' },
  { label: 'Mixed', value: 'mixed' },
];

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
  const [customNiches, setCustomNiches] = useState<string[]>([]);
  const [customNicheInput, setCustomNicheInput] = useState('');
  const [showCustomInput, setShowCustomInput] = useState(false);
  const customInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setMounted(true);
    setWatchlistItems(getChannelWatchlist());
  }, []);

  useEffect(() => {
    if (showCustomInput) customInputRef.current?.focus();
  }, [showCustomInput]);

  const addCustomNiche = () => {
    const trimmed = customNicheInput.trim();
    if (trimmed && !RESEARCH_NICHES.includes(trimmed) && !customNiches.includes(trimmed)) {
      setCustomNiches(prev => [...prev, trimmed]);
      updateFilter('niche', trimmed);
    }
    setCustomNicheInput('');
    setShowCustomInput(false);
  };

  const removeCustomNiche = (niche: string) => {
    setCustomNiches(prev => prev.filter(item => item !== niche));
    if (filters.niche === niche) updateFilter('niche', RESEARCH_NICHES[0]);
  };

  const fetchInsights = useCallback(
    async (isManualRefresh = false) => {
      const size = CHANNEL_SIZES.find(s => s.value === filters.channelSize);
      const age = AGE_OPTIONS.find(a => a.value === filters.maxAge);
      // Format focus and "breakouts only" are computed from data we already have,
      // so they filter client-side and must not fragment the cache.
      const cacheKey = `channels_${filters.niche.replace(/\s+/g, '')}_${filters.channelSize}_${filters.maxAge}`;
      const cacheRef = doc('channelInsightsCache', cacheKey);
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

        const freshData = await fetchBoomingChannels(filters.niche, {
          subscriberMin: size?.subscriberMin,
          subscriberMax: size?.subscriberMax,
          maxAgeMonths: age?.maxAgeMonths,
        });
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
    [filters.niche, filters.channelSize, filters.maxAge]
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
      cadence: (a, b) => b.uploadsPerMonth - a.uploadsPerMonth,
    };

    return data
      .filter(channel => !filters.breakoutsOnly || channel.isBreakout)
      .filter(channel => filters.formatFocus === 'any' || channel.formatFocus === filters.formatFocus)
      .sort(comparators[filters.sortBy] ?? comparators.momentum)
      .slice(0, filters.perPage);
  }, [data, filters.sortBy, filters.perPage, filters.breakoutsOnly, filters.formatFocus]);

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
              {customNiches.map(niche => (
                <Button
                  key={niche}
                  variant={filters.niche === niche ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => updateFilter('niche', niche)}
                  className={cn('group gap-2 rounded-full pl-5 pr-3', filters.niche === niche && 'bg-[#7B5CF0]')}
                >
                  {niche}
                  <X
                    className="h-3 w-3"
                    onClick={e => {
                      e.stopPropagation();
                      removeCustomNiche(niche);
                    }}
                  />
                </Button>
              ))}
              {!showCustomInput ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShowCustomInput(true)}
                  className="rounded-full border-dashed px-5"
                >
                  + Custom
                </Button>
              ) : (
                <Input
                  ref={customInputRef}
                  placeholder="Niche…"
                  value={customNicheInput}
                  onChange={e => setCustomNicheInput(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && addCustomNiche()}
                  onBlur={addCustomNiche}
                  className="h-9 w-36 rounded-full border-[#7B5CF0]"
                />
              )}
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <FilterSelect label="Sort by" value={filters.sortBy} onChange={v => updateFilter('sortBy', v)} width="w-52">
                <SelectItem value="momentum">Momentum</SelectItem>
                <SelectItem value="lift">Beating their own back catalogue</SelectItem>
                <SelectItem value="subs">Subscribers</SelectItem>
                <SelectItem value="cadence">Upload cadence</SelectItem>
              </FilterSelect>

              <FilterSelect label="Size" value={filters.channelSize} onChange={v => updateFilter('channelSize', v)} width="w-44">
                {CHANNEL_SIZES.map(size => (
                  <SelectItem key={size.value} value={size.value}>
                    {size.label}
                  </SelectItem>
                ))}
              </FilterSelect>

              <FilterSelect label="Age" value={filters.maxAge} onChange={v => updateFilter('maxAge', v)} width="w-40">
                {AGE_OPTIONS.map(age => (
                  <SelectItem key={age.value} value={age.value}>
                    {age.label}
                  </SelectItem>
                ))}
              </FilterSelect>

              <FilterSelect label="Format" value={filters.formatFocus} onChange={v => updateFilter('formatFocus', v)} width="w-48">
                {FORMAT_OPTIONS.map(format => (
                  <SelectItem key={format.value} value={format.value}>
                    {format.label}
                  </SelectItem>
                ))}
              </FilterSelect>

              <FilterSelect label="Show" value={String(filters.perPage)} onChange={v => updateFilter('perPage', parseInt(v))} width="w-28">
                {PER_PAGE_OPTIONS.map(n => (
                  <SelectItem key={n} value={String(n)}>
                    {n}
                  </SelectItem>
                ))}
              </FilterSelect>

              <Button
                variant={filters.breakoutsOnly ? 'default' : 'outline'}
                size="sm"
                onClick={() => updateFilter('breakoutsOnly', !filters.breakoutsOnly)}
                className={cn('mt-5 h-10 gap-2 rounded-xl text-xs font-bold', filters.breakoutsOnly && 'bg-rose-500 hover:bg-rose-600')}
              >
                <Rocket className="h-3.5 w-3.5" />
                Breakouts only
                <Badge className="border-none bg-white/20 px-1.5 text-[10px] tabular-nums">{breakouts.length}</Badge>
              </Button>
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

function FilterSelect({
  label,
  value,
  onChange,
  width,
  children,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  width: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{label}</p>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className={cn('h-10 rounded-xl border-none bg-slate-50 text-xs', width)}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>{children}</SelectContent>
      </Select>
    </div>
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
              {channel.formatFocus !== 'mixed' && (
                <Badge className="border-none bg-slate-100 text-[8px] font-bold uppercase text-slate-500">
                  {channel.formatFocus === 'shorts' ? 'Shorts' : 'Long-form'}
                </Badge>
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
                {channel.poolVideoCount > 0 &&
                  ` Found via ${channel.poolVideoCount} of this niche's current top ${channel.poolVideoCount === 1 ? 'video' : 'videos'}.`}
                {!channel.hasRecentData && " We couldn't sample enough settled uploads, so treat this as provisional."}
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
