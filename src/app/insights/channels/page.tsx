'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { SidebarNav } from '@/components/dashboard/SidebarNav';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area';
import { 
  Select, 
  SelectContent, 
  SelectItem, 
  SelectTrigger, 
  SelectValue 
} from '@/components/ui/select';
import { 
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { 
  RefreshCw, 
  X, 
  Sparkles,
  ChevronDown,
  Bookmark,
  BookmarkPlus,
  ArrowRight,
  Database,
  AlertCircle
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { fetchBoomingChannels, type YouTubeChannelData } from '@/services/youtube';
import { useFirebase } from '@/firebase';
import { useRouter } from 'next/navigation';
import { toast } from '@/hooks/use-toast';

// --- Types & Constants ---

interface FilterState {
  niche: string;
  sortBy: string;
  perPage: number;
}

interface ChannelInsight extends YouTubeChannelData {
  uploadsPerMonth: number;
  channelAgeMonths: number;
  growthScore: number;
  isFaceless: boolean;
  handle: string;
}

interface WatchlistChannel {
  id: string;
  channelName: string;
  handle: string;
  avatarUrl: string;
  subscriberCount: number;
  uploadsPerMonth: number;
  viewCount: number;
  growthScore: number;
  niche: string;
  savedAt: string;
}

const DEFAULT_FILTERS: FilterState = {
  niche: 'Finance',
  sortBy: 'growth',
  perPage: 12,
};

const BUILT_IN_NICHES = [
  "Finance", "Tech", "Gaming", "Education", 
  "Motivation", "Business", "Documentary", "Travel"
];

// --- Helpers ---

const formatNumber = (numStr: string | number) => {
  const num = typeof numStr === 'string' ? parseInt(numStr) : numStr;
  if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
  if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
  return num.toString();
};

// --- Page Component ---

export default function ChannelInsightsPage() {
  const { user } = useFirebase();
  const router = useRouter();
  const [mounted, setMounted] = useState(false);
  const [filters, setFilters] = useState<FilterState>(DEFAULT_FILTERS);
  const [data, setData] = useState<ChannelInsight[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [watchlistItems, setWatchlistItems] = useState<WatchlistChannel[]>([]);
  const [isWatchlistOpen, setIsWatchlistOpen] = useState(false);
  const [resilienceMode, setResilienceMode] = useState(false);

  useEffect(() => {
    setMounted(true);
    const saved = localStorage.getItem('creator-hub-watchlist');
    if (saved) setWatchlistItems(JSON.parse(saved));
  }, []);

  const fetchInsights = useCallback(async (isManualRefresh = false) => {
    const cacheKey = `channels_${filters.niche}`;
    const cached = localStorage.getItem(cacheKey);

    if (cached && !isManualRefresh) {
      setData(JSON.parse(cached));
      return;
    }

    setIsLoading(true);
    setResilienceMode(false);

    try {
      const freshData = await fetchBoomingChannels(filters.niche);
      if (freshData && freshData.length > 0) {
        setData(freshData);
        localStorage.setItem(cacheKey, JSON.stringify(freshData));
      }
    } catch (apiErr: any) {
      console.warn("API Error:", apiErr.message);
      setResilienceMode(true);
      const staleData = localStorage.getItem(cacheKey);
      if (staleData) setData(JSON.parse(staleData));
      else toast({ variant: "destructive", title: "API Limit Reached", description: "Showing cached data if available." });
    } finally {
      setIsLoading(false);
    }
  }, [filters.niche]);

  useEffect(() => {
    if (mounted) fetchInsights();
  }, [filters.niche, fetchInsights, mounted]);

  const toggleBookmark = (channel: any) => {
    const isSaved = watchlistItems.some(item => item.id === (channel.id || channel.channelId));
    let newItems: WatchlistChannel[];
    if (isSaved) {
      newItems = watchlistItems.filter(i => i.id !== (channel.id || channel.channelId));
      toast({ title: "Removed from Watchlist" });
    } else {
      const newItem: WatchlistChannel = {
        id: channel.id,
        channelName: channel.title || channel.channelName,
        handle: channel.handle,
        avatarUrl: channel.thumbnails?.default?.url || channel.avatarUrl,
        subscriberCount: parseInt(channel.statistics?.subscriberCount || channel.subscriberCount),
        uploadsPerMonth: channel.uploadsPerMonth,
        viewCount: parseInt(channel.statistics?.viewCount || channel.viewCount),
        growthScore: channel.growthScore,
        niche: filters.niche,
        savedAt: new Date().toISOString()
      };
      newItems = [...watchlistItems, newItem];
      toast({ title: "Added to Watchlist" });
    }
    setWatchlistItems(newItems);
    localStorage.setItem('creator-hub-watchlist', JSON.stringify(newItems));
  };

  const updateFilter = (key: keyof FilterState, value: any) => {
    setFilters(prev => ({ ...prev, [key]: value }));
  };

  const filteredData = useMemo(() => {
    let result = [...data];
    if (filters.sortBy === 'growth') result.sort((a, b) => b.growthScore - a.growthScore);
    else if (filters.sortBy === 'subs') result.sort((a, b) => parseInt(b.statistics.subscriberCount) - parseInt(a.statistics.subscriberCount));
    return result.slice(0, filters.perPage);
  }, [data, filters]);

  if (!mounted) return null;

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <SidebarNav />
      <main className="flex-1 overflow-y-auto p-8 relative">
        
        {watchlistItems.length > 0 && (
          <Collapsible open={isWatchlistOpen} onOpenChange={setIsWatchlistOpen} className="mb-8">
            <CollapsibleTrigger asChild>
              <div className="flex items-center justify-between p-4 bg-slate-900 rounded-2xl cursor-pointer">
                <div className="flex items-center gap-3">
                  <Bookmark className="h-5 w-5 text-[#7B5CF0] fill-[#7B5CF0]" />
                  <span className="text-sm font-bold text-white uppercase tracking-widest">My Watchlist ({watchlistItems.length})</span>
                </div>
                <ChevronDown className={cn("h-5 w-5 text-slate-400", isWatchlistOpen && "rotate-180")} />
              </div>
            </CollapsibleTrigger>
            <CollapsibleContent className="pt-4">
              <ScrollArea className="w-full pb-4">
                <div className="flex gap-4">
                  {watchlistItems.map((item) => (
                    <div key={item.id} className="w-44 h-48 bg-white rounded-2xl border border-slate-100 p-4 flex flex-col items-center justify-between text-center relative group">
                      <button onClick={() => toggleBookmark(item)} className="absolute top-2 right-2 h-6 w-6 rounded-full bg-slate-100 flex items-center justify-center opacity-0 group-hover:opacity-100"><X className="h-3 w-3" /></button>
                      <div className="h-14 w-14 rounded-full overflow-hidden border-2"><img src={item.avatarUrl} alt="" className="h-full w-full object-cover" /></div>
                      <p className="text-xs font-bold truncate w-full">{item.channelName}</p>
                      <Badge className="bg-[#7B5CF0]/10 text-[#7B5CF0] border-none text-[8px] uppercase">{item.niche}</Badge>
                    </div>
                  ))}
                </div>
                <ScrollBar orientation="horizontal" />
              </ScrollArea>
            </CollapsibleContent>
          </Collapsible>
        )}

        <header className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-slate-900">Channel Insights</h1>
            <p className="text-muted-foreground">Identify high-growth channels and model their success.</p>
          </div>
          <div className="flex items-center gap-3">
            {resilienceMode && <Badge className="bg-amber-100 text-amber-700 border-none gap-1.5"><Database className="h-3 w-3" /> Offline Mode</Badge>}
            <Button variant="outline" onClick={() => fetchInsights(true)} disabled={isLoading} className="rounded-full gap-2">
              <RefreshCw className={cn("h-3.5 w-3.5", isLoading && "animate-spin")} /> Refresh
            </Button>
          </div>
        </header>

        <div className="space-y-6 mb-8 bg-white/50 p-6 rounded-3xl border border-slate-100">
           <div className="flex flex-wrap gap-2">
            {BUILT_IN_NICHES.map(niche => (
              <Button
                key={niche}
                variant={filters.niche === niche ? "default" : "outline"}
                size="sm"
                onClick={() => updateFilter('niche', niche)}
                className={cn("rounded-full px-5", filters.niche === niche && "bg-[#7B5CF0]")}
              >
                {niche}
              </Button>
            ))}
          </div>
          <div className="flex items-center gap-4">
            <Select value={filters.sortBy} onValueChange={(v) => updateFilter('sortBy', v)}>
              <SelectTrigger className="w-40 rounded-xl bg-slate-50 border-none"><SelectValue placeholder="Sort By" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="growth">Growth Score</SelectItem>
                <SelectItem value="subs">Subscribers</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {isLoading ? Array(6).fill(0).map((_, i) => <Skeleton key={i} className="h-64 rounded-2xl" />) : (
            filteredData.map((channel) => {
              const isSaved = watchlistItems.some(item => item.id === channel.id);
              return (
                <Card key={channel.id} className="hover:shadow-lg transition-all group relative">
                  <CardContent className="p-6 space-y-6">
                    <button onClick={() => toggleBookmark(channel)} className={cn("absolute top-3 right-3 z-10 h-10 w-10 rounded-full flex items-center justify-center transition-all", isSaved ? "bg-[#7B5CF0]/10 text-[#7B5CF0]" : "bg-slate-50 text-slate-400")}>
                      {isSaved ? <Bookmark className="h-5 w-5 fill-[#7B5CF0]" /> : <BookmarkPlus className="h-5 w-5" />}
                    </button>
                    <div className="flex items-center gap-4">
                      <div className="h-14 w-14 rounded-full overflow-hidden border-2 shrink-0"><img src={channel.thumbnails.default.url} alt="" className="h-full w-full object-cover" /></div>
                      <div className="min-w-0 flex-1">
                        <h3 className="font-bold text-slate-900 truncate">{channel.title}</h3>
                        <div className="flex items-center gap-2 mt-1">
                          <Badge className="bg-[#7B5CF0]/10 text-[#7B5CF0] border-none text-[8px] font-bold uppercase">{filters.niche}</Badge>
                          <span className="text-[10px] font-bold text-slate-600">{formatNumber(channel.statistics.subscriberCount)} subs</span>
                        </div>
                      </div>
                    </div>
                    <div className="grid grid-cols-3 gap-2 bg-slate-50 p-3 rounded-2xl text-center">
                      <div><p className="text-[9px] font-bold text-slate-400 uppercase">Uploads</p><p className="text-sm font-bold">{channel.uploadsPerMonth}/mo</p></div>
                      <div><p className="text-[9px] font-bold text-slate-400 uppercase">Views</p><p className="text-sm font-bold">{formatNumber(channel.statistics.viewCount)}</p></div>
                      <div><p className="text-[9px] font-bold text-slate-400 uppercase">Score</p><p className="text-sm font-bold">{Math.round(channel.growthScore)}%</p></div>
                    </div>
                    <Button className="w-full rounded-xl bg-slate-900 hover:bg-[#7B5CF0] text-white" onClick={() => router.push(`/?url=${encodeURIComponent(`https://www.youtube.com/channel/${channel.id}`)}`)}>
                      View Analytics <ArrowRight className="ml-2 h-4 w-4" />
                    </Button>
                  </CardContent>
                </Card>
              );
            })
          )}
        </div>
      </main>
    </div>
  );
}