
'use client';

import { useState, useEffect, useMemo, useRef } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import { 
  Zap, 
  RefreshCw, 
  Flame, 
  TrendingUp, 
  User, 
  BarChart, 
  AlertTriangle,
  Loader2,
  Globe,
  Users,
  Clock,
  Filter,
  RotateCcw,
  Video,
  X,
  Plus,
  Database
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { SidebarNav } from '@/components/dashboard/SidebarNav';
import { useFirebase, doc, getDoc, setDoc, serverTimestamp } from '@/firebase';
import { searchTrendingVideos, type YouTubeVideoData } from '@/services/youtube';
import { getTrendSummary, getTitlePatterns } from '@/ai/flows/get-insane-insights-flow';
import { cn } from '@/lib/utils';
import { errorEmitter } from '@/firebase/error-emitter';
import { FirestorePermissionError } from '@/firebase/errors';

const BUILT_IN_NICHES = [
  "Finance India", "Tech Hindi", "Current Affairs", "Motivation", 
  "Documentary", "Gaming", "Health & Fitness", "Business"
];

const LANGUAGES = [
  { label: "All Languages", value: "all" },
  { label: "Hindi", value: "hi" },
  { label: "English", value: "en" },
  { label: "Tamil", value: "ta" },
  { label: "Telugu", value: "te" },
  { label: "Malayalam", value: "ml" },
  { label: "Kannada", value: "kn" },
  { label: "Bengali", value: "bn" },
  { label: "Marathi", value: "mr" }
];

const CHANNEL_SIZES = [
  { label: "Any Size", value: "any" },
  { label: "Nano (<10K)", value: "nano" },
  { label: "Micro (10K–100K)", value: "micro" },
  { label: "Mid (100K–1M)", value: "mid" },
  { label: "Large (>1M)", value: "large" }
];

const SORT_OPTIONS = [
  { label: "Most Views", value: "viewCount" },
  { label: "Most Recent", value: "date" },
  { label: "Most Relevant", value: "relevance" },
  { label: "Rising Fast", value: "rising" }
];

export default function InsaneInsightsPage() {
  const [mounted, setMounted] = useState(false);
  const { user, firestore, isUserLoading } = useFirebase();
  const router = useRouter();

  // Primary Preferences
  const [selectedNiche, setSelectedNiche] = useState<string>("Finance India");
  const [customNiches, setCustomNiches] = useState<string[]>([]);
  const [customNicheInput, setCustomNicheInput] = useState("");
  const [showCustomInput, setShowCustomInput] = useState(false);
  const [dateRange, setDateRange] = useState<"7" | "30">("30");
  const customInputRef = useRef<HTMLInputElement>(null);

  // Advanced Filters
  const [contentType, setContentType] = useState<'all' | 'long' | 'short'>('all');
  const [language, setLanguage] = useState('all');
  const [channelSize, setChannelSize] = useState('any');
  const [sortBy, setSortBy] = useState('viewCount');
  const [region, setRegion] = useState<'IN' | 'global'>('IN');

  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [prefsLoaded, setPrefsLoaded] = useState(false);
  
  const [trendSummary, setTrendSummary] = useState<string[]>([]);
  const [videos, setVideos] = useState<YouTubeVideoData[]>([]);
  const [titleInsights, setTitleInsights] = useState<string[]>([]);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [resilienceMode, setResilienceMode] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Focus input when shown
  useEffect(() => {
    if (showCustomInput && customInputRef.current) {
      customInputRef.current.focus();
    }
  }, [showCustomInput]);

  useEffect(() => {
    if (!mounted || !user) return;
    async function loadPrefs() {
      try {
        const prefRef = doc('users', user!.uid);
        const docSnap = await getDoc(prefRef);
        if (docSnap.exists()) {
          const data = docSnap.data();
          if (data.selectedNiche) setSelectedNiche(data.selectedNiche);
          if (data.selectedRange) setDateRange(data.selectedRange as "7" | "30");
          if (data.contentType) setContentType(data.contentType);
          if (data.language) setLanguage(data.language);
          if (data.channelSize) setChannelSize(data.channelSize);
          if (data.sortBy) setSortBy(data.sortBy);
          if (data.region) setRegion(data.region);
        }
      } catch (e) { console.error("Error loading user preferences:", e); }
      finally { setPrefsLoaded(true); }
    }
    loadPrefs();
  }, [user, mounted]);

  useEffect(() => {
    if (mounted && prefsLoaded && selectedNiche && user) fetchData();
  }, [selectedNiche, dateRange, contentType, language, channelSize, sortBy, region, user, mounted, prefsLoaded]);

  async function fetchData(forceRefresh = false) {
    if (!selectedNiche || !user) return;
    if (videos.length === 0) setLoading(true);
    else setRefreshing(true);
    setError(null);
    setResilienceMode(false);
    const today = new Date().toISOString().split('T')[0];
    const nicheKey = selectedNiche.replace(/\s+/g, '');
    const filterKey = `${nicheKey}_${dateRange}_${contentType}_${language}_${sortBy}_${region}`;
    const now = Date.now();
    
    try {
      // 1. Trend Summary
      const summaryRef = doc('trendSummaries', `${nicheKey}_${today}`);
      const summarySnap = await getDoc(summaryRef);
      let summaryData: string[] = [];
      const summaryCache = summarySnap.data();
      if (!forceRefresh && summarySnap.exists() && (now - new Date(summaryCache?.cachedAt).getTime()) < 24 * 60 * 60 * 1000) {
        summaryData = summaryCache?.bullets || [];
      } else {
        try {
          const aiSummary = await getTrendSummary({ niche: selectedNiche });
          summaryData = aiSummary.bullets;
          setDoc(summaryRef, { bullets: summaryData, cachedAt: serverTimestamp() });
        } catch (aiErr) {
          if (summarySnap.exists()) summaryData = summaryCache?.bullets || [];
          else summaryData = ["Resilience mode active: Loading patterns..."];
        }
      }
      setTrendSummary(summaryData);

      // 2. YouTube Videos
      const videosRef = doc('insightVideos', `${filterKey}_${today}`);
      const videosSnap = await getDoc(videosRef);
      let videoData: YouTubeVideoData[] = [];
      const videosCache = videosSnap.data();
      if (!forceRefresh && videosSnap.exists() && (now - new Date(videosCache?.cachedAt).getTime()) < 6 * 60 * 60 * 1000) {
        videoData = videosCache?.videos || [];
        setLastUpdated(new Date(videosCache?.cachedAt));
      } else {
        try {
          const publishedAfter = new Date(Date.now() - (parseInt(dateRange) * 24 * 60 * 60 * 1000)).toISOString();
          videoData = await searchTrendingVideos(selectedNiche, publishedAfter, language, contentType, region, sortBy === 'rising' ? 'viewCount' : sortBy);
          if (videoData.length > 0) {
            setDoc(videosRef, { videos: videoData, cachedAt: serverTimestamp() });
            setLastUpdated(new Date());
          }
        } catch (ytErr: any) {
          if (videosSnap.exists()) {
            videoData = videosCache?.videos || [];
            setResilienceMode(true);
            setLastUpdated(new Date(videosCache?.cachedAt));
            setError("YouTube API limits reached. Serving latest cached research.");
          } else {
            setError(ytErr.message || "Quota limit hit and no local cache found yet.");
          }
        }
      }
      setVideos(videoData);

      // 3. Title Insights
      const patternsRef = doc('titlePatterns', `${filterKey}_${today}`);
      const patternsSnap = await getDoc(patternsRef);
      let patternData: string[] = [];
      const patternsCache = patternsSnap.data();
      if (!forceRefresh && patternsSnap.exists() && (now - new Date(patternsCache?.cachedAt).getTime()) < 24 * 60 * 60 * 1000) {
        patternData = patternsCache?.insights || [];
      } else if (videoData.length > 0) {
        try {
          const aiPatterns = await getTitlePatterns({ niche: selectedNiche, titles: videoData.map(v => v.title) });
          patternData = aiPatterns.insights;
          setDoc(patternsRef, { insights: patternData, cachedAt: serverTimestamp() });
        } catch (aiErr) {
          if (patternsSnap.exists()) patternData = patternsCache?.insights || [];
        }
      }
      setTitleInsights(patternData);

      const prefRef = doc('users', user!.uid);
      setDoc(prefRef, { selectedNiche, selectedRange: dateRange, contentType, language, channelSize, sortBy, region }, { merge: true });
    } catch (err: any) {
      console.error("General Fetch Error:", err);
      if (videos.length === 0) setError("Research system is currently limited. Please check your API key.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  const handleAddCustomNiche = () => {
    const trimmed = customNicheInput.trim();
    if (trimmed && !BUILT_IN_NICHES.includes(trimmed) && !customNiches.includes(trimmed)) {
      setCustomNiches(prev => [...prev, trimmed]);
      setSelectedNiche(trimmed);
    }
    setCustomNicheInput("");
    setShowCustomInput(false);
  };

  const handleRemoveCustomNiche = (n: string) => {
    setCustomNiches(prev => prev.filter(item => item !== n));
    if (selectedNiche === n) setSelectedNiche(BUILT_IN_NICHES[0]);
  };

  const filteredVideos = useMemo(() => {
    let result = [...videos];
    if (channelSize !== 'any') {
      result = result.filter(v => {
        const subs = parseInt(v.subscriberCount || "0");
        if (channelSize === 'nano') return subs < 10000;
        if (channelSize === 'micro') return subs >= 10000 && subs < 100000;
        if (channelSize === 'mid') return subs >= 100000 && subs < 1000000;
        if (channelSize === 'large') return subs >= 1000000;
        return true;
      });
    }
    if (sortBy === 'rising') {
      result.sort((a, b) => {
        const ratioA = parseInt(a.viewCount || "0") / Math.max(1, parseInt(a.subscriberCount || "1"));
        const ratioB = parseInt(b.viewCount || "0") / Math.max(1, parseInt(b.subscriberCount || "1"));
        return ratioB - ratioA;
      });
    }
    return result;
  }, [videos, channelSize, sortBy]);

  const formatNumber = (num?: string | number) => {
    if (!num) return "0";
    const n = typeof num === 'string' ? parseInt(num) : num;
    if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
    if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
    return n.toString();
  };

  if (!mounted) return null;

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <SidebarNav />
      <main className="flex-1 overflow-y-auto p-8 relative scroll-smooth">
        <header className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <Video className="h-6 w-6 text-primary" />
              <h1 className="text-3xl font-bold tracking-tight text-slate-900 font-headline">Content Insights</h1>
            </div>
            <p className="text-muted-foreground">What's blowing up on YouTube right now in your niche.</p>
          </div>
          <div className="flex items-center gap-4">
            {resilienceMode && <Badge className="bg-amber-100 text-amber-700 border-none gap-1.5 px-3 py-1 animate-pulse"><Database className="h-3 w-3" /> Resilience Mode</Badge>}
            <Button variant="outline" size="sm" onClick={() => fetchData(true)} disabled={loading || refreshing} className="rounded-full gap-2 border-slate-200">
              <RefreshCw className={cn("h-3.5 w-3.5", refreshing && "animate-spin")} /> Refresh
            </Button>
          </div>
        </header>

        <section className="mb-6 space-y-6">
          <div className="flex flex-wrap gap-2">
            {BUILT_IN_NICHES.map(n => <Button key={n} variant={selectedNiche === n ? "default" : "outline"} size="sm" onClick={() => setSelectedNiche(n)} className={cn("rounded-full px-5 h-8", selectedNiche === n ? "bg-primary" : "border-slate-200")}>{n}</Button>)}
            {customNiches.map(n => <Button key={n} variant={selectedNiche === n ? "default" : "outline"} size="sm" onClick={() => setSelectedNiche(n)} className="rounded-full pl-5 pr-3 h-8 group gap-2">{n}<X className="h-3 w-3" onClick={(e) => { e.stopPropagation(); handleRemoveCustomNiche(n); }} /></Button>)}
            {!showCustomInput ? <Button variant="outline" size="sm" onClick={() => setShowCustomInput(true)} className="rounded-full px-5 h-8 border-dashed">+ Custom</Button> : (
              <div className="flex items-center gap-1 animate-in slide-in-from-left-2"><Input ref={customInputRef} placeholder="Niche..." value={customNicheInput} onChange={(e) => setCustomNicheInput(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleAddCustomNiche()} className="h-8 w-32 rounded-full border-primary" /></div>
            )}
          </div>

          <div className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm space-y-6">
            <div className="flex flex-wrap items-end gap-6">
              <FilterGroup label="Content Type" value={contentType} onChange={(v: any) => setContentType(v)} options={['all', 'long', 'short']} />
              <FilterSelectGroup label="Language" value={language} onChange={setLanguage} options={LANGUAGES} />
              <FilterSelectGroup label="Channel Size" value={channelSize} onChange={setChannelSize} options={CHANNEL_SIZES} />
              <FilterSelectGroup label="Sort By" value={sortBy} onChange={setSortBy} options={SORT_OPTIONS} />
            </div>
          </div>
        </section>

        <div className="space-y-12 animate-in fade-in duration-500">
          <Card className="border-none shadow-sm overflow-hidden bg-white border-l-4 border-l-primary p-6">
            <CardTitle className="text-lg font-bold flex items-center gap-2 mb-4"><Zap className="h-4 w-4 text-primary" /> Current Trends</CardTitle>
            {loading ? <Loader2 className="h-4 w-4 animate-spin text-primary" /> : (
              <ul className="space-y-2">
                {trendSummary.map((b, i) => <li key={i} className="text-sm text-slate-700 flex gap-2"><span className="h-1.5 w-1.5 rounded-full bg-primary mt-1.5 shrink-0" />{b}</li>)}
              </ul>
            )}
          </Card>

          {error && <div className={cn("p-4 border rounded-xl flex gap-3", resilienceMode ? "bg-amber-50" : "bg-red-50")}><AlertTriangle className="h-5 w-5 shrink-0" /><p className="text-sm font-medium">{error}</p></div>}

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {loading ? Array(8).fill(0).map((_, i) => <Skeleton key={i} className="aspect-video rounded-xl" />) : filteredVideos.map(v => (
              <Card key={v.id} className="overflow-hidden border-none shadow-sm bg-white group">
                <div className="relative aspect-video"><Image src={v.thumbnail} alt={v.title} fill className="object-cover" /></div>
                <CardContent className="p-4 space-y-3">
                  <h4 className="text-sm font-bold line-clamp-2 h-10">{v.title}</h4>
                  <div className="flex justify-between text-[10px] text-slate-400"><span>{v.channelTitle}</span><span>{formatNumber(v.viewCount)} views</span></div>
                  <Button variant="outline" className="w-full h-8 text-xs font-bold" onClick={() => router.push(`/?url=${encodeURIComponent(`https://www.youtube.com/channel/${v.channelId}`)}`)}>Analyse</Button>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </main>
    </div>
  );
}

function FilterGroup({ label, value, onChange, options }: any) {
  return (
    <div className="space-y-2">
      <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">{label}</p>
      <div className="flex bg-slate-50 p-1 rounded-lg">
        {options.map((opt: string) => <Button key={opt} variant={value === opt ? "secondary" : "ghost"} size="sm" onClick={() => onChange(opt)} className={cn("h-7 px-4 text-xs rounded-md", value === opt && "bg-white shadow-sm")}>{opt}</Button>)}
      </div>
    </div>
  );
}

function FilterSelectGroup({ label, value, onChange, options }: any) {
  return (
    <div className="space-y-2">
      <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">{label}</p>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="w-[140px] h-9 rounded-lg bg-slate-50 border-none text-xs"><SelectValue /></SelectTrigger>
        <SelectContent>{options.map((o: any) => <SelectItem key={o.value} value={o.value} className="text-xs">{o.label}</SelectItem>)}</SelectContent>
      </Select>
    </div>
  );
}
