'use client';

import { useState, useEffect, useMemo, useRef } from 'react';
import { useRouter } from 'next/navigation';
import {
  RefreshCw,
  AlertTriangle,
  Video,
  X,
  Database,
  SearchX,
  Flame,
  LayoutGrid,
  Rows3,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { TooltipProvider } from '@/components/ui/tooltip';
import { SidebarNav } from '@/components/dashboard/SidebarNav';
import { OutlierCard } from '@/components/research/OutlierCard';
import { OutlierTable } from '@/components/research/OutlierTable';
import { ResearchBrief } from '@/components/research/ResearchBrief';
import { TeardownDialog } from '@/components/research/TeardownDialog';
import { ThumbnailDnaPanel } from '@/components/research/ThumbnailDnaPanel';
import { useFirebase, doc, getDoc, setDoc, serverTimestamp } from '@/firebase';
import { searchOutlierVideos, type ResearchVideo } from '@/services/youtube';
import { getTrendSummary, getTitleFormulas, type TitleFormula } from '@/ai/flows/get-insane-insights-flow';
import { cn } from '@/lib/utils';
import { RESEARCH_NICHES } from '@/lib/niches';
import { getVideoWatchlist, saveVideoWatchlist, type WatchlistVideo } from '@/lib/watchlist';
import { toNum } from '@/lib/research-metrics';
import { parseIsoDuration, timeAgo } from '@/lib/video-utils';

const LANGUAGES = [
  { label: 'All Languages', value: 'all' },
  { label: 'Hindi', value: 'hi' },
  { label: 'English', value: 'en' },
  { label: 'Tamil', value: 'ta' },
  { label: 'Telugu', value: 'te' },
  { label: 'Malayalam', value: 'ml' },
  { label: 'Kannada', value: 'kn' },
  { label: 'Bengali', value: 'bn' },
  { label: 'Marathi', value: 'mr' },
];

/**
 * Subscriber bands. These are sent to the search so the candidate pool is
 * filtered *before* ranking — filtering the ranked results instead is what made
 * the old "Nano" option come back empty.
 */
const CHANNEL_SIZES = [
  { label: 'Any Size', value: 'any', subscriberMin: undefined, subscriberMax: undefined },
  { label: 'Nano (<10K)', value: 'nano', subscriberMin: undefined, subscriberMax: 10_000 },
  { label: 'Micro (10K–100K)', value: 'micro', subscriberMin: 10_000, subscriberMax: 100_000 },
  { label: 'Mid (100K–1M)', value: 'mid', subscriberMin: 100_000, subscriberMax: 1_000_000 },
  { label: 'Large (>1M)', value: 'large', subscriberMin: 1_000_000, subscriberMax: undefined },
];

// Sorting happens client-side over the pooled results, so it costs nothing and
// never re-biases the sample the way an API-side `order` does.
const SORT_OPTIONS = [
  { label: 'Outlier score', value: 'outlier' },
  { label: 'Hot right now', value: 'vph' },
  { label: 'Most views', value: 'views' },
  { label: 'Newest', value: 'date' },
];

const REGIONS = [
  { label: 'India', value: 'IN' },
  { label: 'Global', value: 'global' },
];

/** A video that beat its channel's normal by 3x or more is worth studying. */
const OUTLIER_THRESHOLD = 3;

const VIDEO_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const INSIGHT_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

export default function InsaneInsightsPage() {
  const [mounted, setMounted] = useState(false);
  const { user } = useFirebase();
  const router = useRouter();

  const [selectedNiche, setSelectedNiche] = useState('Finance');
  const [customNiches, setCustomNiches] = useState<string[]>([]);
  const [customNicheInput, setCustomNicheInput] = useState('');
  const [showCustomInput, setShowCustomInput] = useState(false);
  const [dateRange] = useState<'7' | '30'>('30');
  const customInputRef = useRef<HTMLInputElement>(null);

  const [contentType, setContentType] = useState<'all' | 'long' | 'short'>('all');
  const [language, setLanguage] = useState('all');
  const [channelSize, setChannelSize] = useState('any');
  const [sortBy, setSortBy] = useState('outlier');
  const [region, setRegion] = useState<'IN' | 'global'>('IN');
  const [outliersOnly, setOutliersOnly] = useState(false);
  const [view, setView] = useState<'grid' | 'table'>('grid');

  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [prefsLoaded, setPrefsLoaded] = useState(false);

  const [trendSummary, setTrendSummary] = useState<string[]>([]);
  const [formulas, setFormulas] = useState<TitleFormula[]>([]);
  const [videos, setVideos] = useState<ResearchVideo[]>([]);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [resilienceMode, setResilienceMode] = useState(false);
  const [videoWatchlist, setVideoWatchlist] = useState<WatchlistVideo[]>([]);
  const [teardownVideo, setTeardownVideo] = useState<ResearchVideo | null>(null);

  useEffect(() => {
    setMounted(true);
    setVideoWatchlist(getVideoWatchlist());
  }, []);

  useEffect(() => {
    if (showCustomInput) customInputRef.current?.focus();
  }, [showCustomInput]);

  useEffect(() => {
    if (!mounted || !user) return;
    async function loadPrefs() {
      try {
        const snapshot = await getDoc(doc('users', user!.uid));
        if (snapshot.exists()) {
          const data = snapshot.data();
          if (data.selectedNiche) setSelectedNiche(data.selectedNiche);
          if (data.contentType) setContentType(data.contentType);
          if (data.language) setLanguage(data.language);
          if (data.channelSize) setChannelSize(data.channelSize);
          if (data.sortBy) setSortBy(data.sortBy);
          if (data.region) setRegion(data.region);
        }
      } catch (e) {
        console.error('Error loading user preferences:', e);
      } finally {
        setPrefsLoaded(true);
      }
    }
    loadPrefs();
  }, [user, mounted]);

  useEffect(() => {
    if (mounted && prefsLoaded && selectedNiche && user) fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedNiche, dateRange, contentType, language, channelSize, region, user, mounted, prefsLoaded]);

  async function fetchData(forceRefresh = false) {
    if (!selectedNiche || !user) return;
    if (videos.length === 0) setLoading(true);
    else setRefreshing(true);
    setError(null);
    setResilienceMode(false);

    const today = new Date().toISOString().split('T')[0];
    const nicheKey = selectedNiche.replace(/\s+/g, '');
    // Sort order is applied client-side, so it must not fragment the cache.
    const filterKey = `${nicheKey}_${dateRange}_${contentType}_${language}_${channelSize}_${region}`;
    const now = Date.now();

    try {
      const videosRef = doc('insightVideos', `${filterKey}_${today}`);
      const videosSnap = await getDoc(videosRef);
      const videosCache = videosSnap.data();
      const cacheAge = videosSnap.exists() ? now - new Date(videosCache?.cachedAt).getTime() : Infinity;

      let videoData: ResearchVideo[] = [];
      let servedFromCache = false;

      if (!forceRefresh && cacheAge < VIDEO_CACHE_TTL_MS) {
        videoData = videosCache?.videos || [];
        servedFromCache = true;
        setLastUpdated(new Date(videosCache?.cachedAt));
      } else {
        const size = CHANNEL_SIZES.find(s => s.value === channelSize);
        const publishedAfter = new Date(now - parseInt(dateRange) * 24 * 60 * 60 * 1000).toISOString();
        try {
          videoData = await searchOutlierVideos({
            niche: selectedNiche,
            publishedAfter,
            language,
            contentType,
            region,
            subscriberMin: size?.subscriberMin,
            subscriberMax: size?.subscriberMax,
          });
          if (videoData.length > 0) {
            setDoc(videosRef, { videos: videoData, cachedAt: serverTimestamp() });
            setLastUpdated(new Date());
          }
        } catch (ytErr: any) {
          if (videosSnap.exists()) {
            videoData = videosCache?.videos || [];
            servedFromCache = true;
            setResilienceMode(true);
            setLastUpdated(new Date(videosCache?.cachedAt));
            setError('YouTube API limits reached. Serving the latest cached research.');
          } else {
            setError(ytErr.message || 'Quota limit hit and no local cache found yet.');
          }
        }
      }

      setVideos(videoData);
      await loadInsights(videoData, filterKey, today, forceRefresh && !servedFromCache);

      setDoc(doc('users', user!.uid), { selectedNiche, contentType, language, channelSize, sortBy, region }, { merge: true });
    } catch (err: any) {
      console.error('General fetch error:', err);
      if (videos.length === 0) setError('Research system is currently limited. Please check your API key.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  /**
   * The trend bullets and title formulas are read off `videoData` itself, so they
   * are cached against the same filter key — a summary of one filter's videos is
   * meaningless for another's.
   */
  async function loadInsights(videoData: ResearchVideo[], filterKey: string, today: string, forceRefresh: boolean) {
    if (videoData.length === 0) {
      setTrendSummary([]);
      setFormulas([]);
      return;
    }

    const now = Date.now();
    const briefVideos = videoData.map(v => ({
      title: v.title,
      views: toNum(v.viewCount),
      outlierScore: v.outlierScore,
      ageDays: Math.max(0, Math.round((now - new Date(v.publishedAt).getTime()) / 86_400_000)),
      durationSeconds: parseIsoDuration(v.duration),
      subscriberCount: toNum(v.subscriberCount),
      channelTitle: v.channelTitle,
    }));

    const summaryRef = doc('trendSummaries', `${filterKey}_${today}`);
    const formulasRef = doc('titleFormulas', `${filterKey}_${today}`);
    const [summarySnap, formulasSnap] = await Promise.all([getDoc(summaryRef), getDoc(formulasRef)]);

    const summaryCache = summarySnap.data();
    const summaryFresh =
      !forceRefresh && summarySnap.exists() && now - new Date(summaryCache?.cachedAt).getTime() < INSIGHT_CACHE_TTL_MS;

    if (summaryFresh) {
      setTrendSummary(summaryCache?.bullets || []);
    } else {
      try {
        const { bullets } = await getTrendSummary({ niche: selectedNiche, videos: briefVideos });
        setTrendSummary(bullets);
        setDoc(summaryRef, { bullets, cachedAt: serverTimestamp() });
      } catch {
        setTrendSummary(summaryCache?.bullets || []);
      }
    }

    const formulasCache = formulasSnap.data();
    const formulasFresh =
      !forceRefresh && formulasSnap.exists() && now - new Date(formulasCache?.cachedAt).getTime() < INSIGHT_CACHE_TTL_MS;

    if (formulasFresh) {
      setFormulas(formulasCache?.formulas || []);
    } else {
      try {
        const { formulas: extracted } = await getTitleFormulas({ niche: selectedNiche, videos: briefVideos });
        setFormulas(extracted);
        setDoc(formulasRef, { formulas: extracted, cachedAt: serverTimestamp() });
      } catch {
        setFormulas(formulasCache?.formulas || []);
      }
    }
  }

  const handleAddCustomNiche = () => {
    const trimmed = customNicheInput.trim();
    if (trimmed && !RESEARCH_NICHES.includes(trimmed) && !customNiches.includes(trimmed)) {
      setCustomNiches(prev => [...prev, trimmed]);
      setSelectedNiche(trimmed);
    }
    setCustomNicheInput('');
    setShowCustomInput(false);
  };

  const handleRemoveCustomNiche = (niche: string) => {
    setCustomNiches(prev => prev.filter(item => item !== niche));
    if (selectedNiche === niche) setSelectedNiche(RESEARCH_NICHES[0]);
  };

  const toggleVideoBookmark = (video: ResearchVideo) => {
    const isSaved = videoWatchlist.some(item => item.id === video.id);
    const next = isSaved
      ? videoWatchlist.filter(item => item.id !== video.id)
      : [
          ...videoWatchlist,
          {
            id: video.id,
            title: video.title,
            thumbnail: video.thumbnail,
            channelTitle: video.channelTitle,
            channelId: video.channelId,
            viewCount: video.viewCount,
            outlierScore: video.outlierScore,
            niche: selectedNiche,
            savedAt: new Date().toISOString(),
          },
        ];
    setVideoWatchlist(next);
    saveVideoWatchlist(next);
  };

  const openChannel = (video: ResearchVideo) => {
    router.push(`/?url=${encodeURIComponent(`https://www.youtube.com/channel/${video.channelId}`)}`);
  };

  const visibleVideos = useMemo(() => {
    const result = outliersOnly ? videos.filter(v => v.outlierScore >= OUTLIER_THRESHOLD) : [...videos];
    const comparators: Record<string, (a: ResearchVideo, b: ResearchVideo) => number> = {
      outlier: (a, b) => b.outlierScore - a.outlierScore,
      vph: (a, b) => b.vph - a.vph,
      views: (a, b) => toNum(b.viewCount) - toNum(a.viewCount),
      date: (a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime(),
    };
    return result.sort(comparators[sortBy] ?? comparators.outlier);
  }, [videos, sortBy, outliersOnly]);

  const outlierCount = useMemo(() => videos.filter(v => v.outlierScore >= OUTLIER_THRESHOLD).length, [videos]);

  if (!mounted) return null;

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <SidebarNav />
      <main className="relative flex-1 scroll-smooth overflow-y-auto p-8">
        <header className="mb-8 flex flex-col justify-between gap-4 md:flex-row md:items-center">
          <div>
            <div className="mb-1 flex items-center gap-2">
              <Video className="h-6 w-6 text-primary" />
              <h1 className="font-headline text-3xl font-bold tracking-tight text-slate-900">Content Insights</h1>
            </div>
            <p className="text-muted-foreground">
              Videos that beat their own channel's average — the ones whose topic and packaging actually did the work.
            </p>
          </div>
          <div className="flex items-center gap-4">
            {lastUpdated && (
              <span className="text-xs text-slate-400">Data from {timeAgo(lastUpdated.toISOString())}</span>
            )}
            {resilienceMode && (
              <Badge className="animate-pulse gap-1.5 border-none bg-amber-100 px-3 py-1 text-amber-700">
                <Database className="h-3 w-3" /> Resilience Mode
              </Badge>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={() => fetchData(true)}
              disabled={loading || refreshing}
              className="gap-2 rounded-full border-slate-200"
            >
              <RefreshCw className={cn('h-3.5 w-3.5', refreshing && 'animate-spin')} /> Refresh
            </Button>
          </div>
        </header>

        <section className="mb-6 space-y-6">
          <div className="flex flex-wrap gap-2">
            {RESEARCH_NICHES.map(niche => (
              <Button
                key={niche}
                variant={selectedNiche === niche ? 'default' : 'outline'}
                size="sm"
                onClick={() => setSelectedNiche(niche)}
                className={cn('h-8 rounded-full px-5', selectedNiche === niche ? 'bg-primary' : 'border-slate-200')}
              >
                {niche}
              </Button>
            ))}
            {customNiches.map(niche => (
              <Button
                key={niche}
                variant={selectedNiche === niche ? 'default' : 'outline'}
                size="sm"
                onClick={() => setSelectedNiche(niche)}
                className="group h-8 gap-2 rounded-full pl-5 pr-3"
              >
                {niche}
                <X
                  className="h-3 w-3"
                  onClick={e => {
                    e.stopPropagation();
                    handleRemoveCustomNiche(niche);
                  }}
                />
              </Button>
            ))}
            {!showCustomInput ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowCustomInput(true)}
                className="h-8 rounded-full border-dashed px-5"
              >
                + Custom
              </Button>
            ) : (
              <Input
                ref={customInputRef}
                placeholder="Niche…"
                value={customNicheInput}
                onChange={e => setCustomNicheInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleAddCustomNiche()}
                onBlur={handleAddCustomNiche}
                className="h-8 w-32 rounded-full border-primary"
              />
            )}
          </div>

          <div className="rounded-2xl border border-slate-100 bg-white p-6 shadow-sm">
            <div className="flex flex-wrap items-end gap-6">
              <FilterGroup label="Content Type" value={contentType} onChange={setContentType} options={['all', 'long', 'short']} />
              <FilterGroup label="Region" value={region} onChange={setRegion} options={REGIONS} />
              <FilterSelectGroup label="Language" value={language} onChange={setLanguage} options={LANGUAGES} />
              <FilterSelectGroup label="Channel Size" value={channelSize} onChange={setChannelSize} options={CHANNEL_SIZES} />
              <FilterSelectGroup label="Sort By" value={sortBy} onChange={setSortBy} options={SORT_OPTIONS} />
            </div>
          </div>
        </section>

        <div className="space-y-8 animate-in fade-in duration-500">
          <ResearchBrief
            niche={selectedNiche}
            videos={videos}
            trends={trendSummary}
            formulas={formulas}
            loading={loading}
          />

          {videos.length > 0 && <ThumbnailDnaPanel niche={selectedNiche} videos={visibleVideos} />}

          {error && (
            <div className={cn('flex gap-3 rounded-xl border p-4', resilienceMode ? 'bg-amber-50' : 'bg-red-50')}>
              <AlertTriangle className="h-5 w-5 shrink-0" />
              <p className="text-sm font-medium">{error}</p>
            </div>
          )}

          {videos.length > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <Button
                  variant={outliersOnly ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setOutliersOnly(v => !v)}
                  className="h-8 gap-2 rounded-full text-xs font-bold"
                >
                  <Flame className="h-3.5 w-3.5" />
                  Outliers only
                  <Badge className="border-none bg-white/20 px-1.5 text-[10px] tabular-nums">{outlierCount}</Badge>
                </Button>
                <span className="text-xs text-slate-400">
                  Showing {visibleVideos.length} of {videos.length}
                </span>
              </div>

              <div className="flex rounded-lg bg-slate-50 p-1">
                <Button
                  variant={view === 'grid' ? 'secondary' : 'ghost'}
                  size="sm"
                  onClick={() => setView('grid')}
                  aria-label="Grid view"
                  className={cn('h-7 px-3', view === 'grid' && 'bg-white shadow-sm')}
                >
                  <LayoutGrid className="h-3.5 w-3.5" />
                </Button>
                <Button
                  variant={view === 'table' ? 'secondary' : 'ghost'}
                  size="sm"
                  onClick={() => setView('table')}
                  aria-label="Table view"
                  className={cn('h-7 px-3', view === 'table' && 'bg-white shadow-sm')}
                >
                  <Rows3 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          )}

          {loading ? (
            <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
              {Array(8)
                .fill(0)
                .map((_, i) => (
                  <Skeleton key={i} className="aspect-video rounded-xl" />
                ))}
            </div>
          ) : visibleVideos.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-3 rounded-3xl border border-dashed border-slate-200 py-24 text-center">
              <SearchX className="h-8 w-8 text-slate-300" />
              <p className="text-sm font-bold text-slate-700">
                {outliersOnly && videos.length > 0
                  ? `Nothing beat its channel by ${OUTLIER_THRESHOLD}x in "${selectedNiche}"`
                  : `No trending videos found for "${selectedNiche}"`}
              </p>
              <p className="max-w-xs text-xs text-muted-foreground">
                {outliersOnly && videos.length > 0
                  ? 'That itself is a signal: this niche is being carried by big channels rather than by topics. Turn the filter off to see the full pool.'
                  : 'Try widening the date range, switching region, or loosening the channel size filter.'}
              </p>
            </div>
          ) : view === 'table' ? (
            <OutlierTable
              videos={visibleVideos}
              watchlist={videoWatchlist}
              onToggleSave={toggleVideoBookmark}
              onTeardown={setTeardownVideo}
            />
          ) : (
            <TooltipProvider delayDuration={150}>
              <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
                {visibleVideos.map(video => (
                  <OutlierCard
                    key={video.id}
                    video={video}
                    isSaved={videoWatchlist.some(item => item.id === video.id)}
                    onToggleSave={toggleVideoBookmark}
                    onAnalyse={openChannel}
                    onTeardown={setTeardownVideo}
                  />
                ))}
              </div>
            </TooltipProvider>
          )}
        </div>

        <TeardownDialog video={teardownVideo} onClose={() => setTeardownVideo(null)} />
      </main>
    </div>
  );
}

function FilterGroup({ label, value, onChange, options }: any) {
  const normalized = options.map((option: any) => (typeof option === 'string' ? { value: option, label: option } : option));
  return (
    <div className="space-y-2">
      <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{label}</p>
      <div className="flex rounded-lg bg-slate-50 p-1">
        {normalized.map((option: any) => (
          <Button
            key={option.value}
            variant={value === option.value ? 'secondary' : 'ghost'}
            size="sm"
            onClick={() => onChange(option.value)}
            className={cn('h-7 rounded-md px-4 text-xs', value === option.value && 'bg-white shadow-sm')}
          >
            {option.label}
          </Button>
        ))}
      </div>
    </div>
  );
}

function FilterSelectGroup({ label, value, onChange, options }: any) {
  return (
    <div className="space-y-2">
      <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{label}</p>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="h-9 w-[140px] rounded-lg border-none bg-slate-50 text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((option: any) => (
            <SelectItem key={option.value} value={option.value} className="text-xs">
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
