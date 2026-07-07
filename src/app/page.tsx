'use client';

import { useState, useMemo, useEffect, useCallback, Suspense } from "react"
import {
  Video,
  ArrowRight,
  Loader2,
  Fingerprint,
  DollarSign,
  Target,
  AlertCircle,
  RefreshCw,
  BarChart3,
  Gauge,
  TrendingUp,
  ChevronDown,
  Plus,
  Instagram,
  Twitter,
  Facebook,
  Youtube,
  Twitch,
  Linkedin,
  Music2,
  MessageCircle,
  Globe,
  Send,
  AtSign,
  Ghost,
  ShoppingBag,
  Mail,
  Link as LinkIcon,
  Search
} from "lucide-react"
import { SidebarNav } from "@/components/dashboard/SidebarNav"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"
import { useSearchParams } from "next/navigation"
import { fetchYouTubeChannelData, fetchChannelVideosPage, fetchChannelLinks, type YouTubeChannelData, type YouTubeVideoData } from "@/services/youtube"
import { analyzeChannelDemographics, type AnalyzeChannelOutput } from "@/ai/flows/analyze-channel-demographics-flow"
import { analyzeChannelOverview, type AnalyzeChannelOverviewOutput } from "@/ai/flows/analyze-channel-overview-flow"
import { organizeChannelSocials, type OrganizeSocialsOutput } from "@/ai/flows/organize-channel-socials-flow"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import {
  Bar,
  BarChart,
  XAxis,
  YAxis,
  CartesianGrid,
  Cell
} from "recharts"
import { ChartContainer, ChartTooltip, type ChartConfig } from "@/components/ui/chart"
import { formatDuration, isShort, parseIsoDuration, timeAgo, estimateEarnings, formatEarningsRange } from "@/lib/video-utils"

type SocialItem = OrganizeSocialsOutput["socials"][number]

const SOCIAL_ICONS: Record<string, typeof Globe> = {
  instagram: Instagram,
  twitter: Twitter,
  x: Twitter,
  tiktok: Music2,
  facebook: Facebook,
  youtube: Youtube,
  twitch: Twitch,
  linkedin: Linkedin,
  discord: MessageCircle,
  telegram: Send,
  threads: AtSign,
  snapchat: Ghost,
  website: Globe,
  store: ShoppingBag,
  newsletter: Mail,
  other: LinkIcon,
}

const getSocialIcon = (platform: string) => SOCIAL_ICONS[platform?.toLowerCase()] || Globe

// Canonical profile bases — lets us rebuild a working URL from the AI-corrected
// handle when YouTube truncated the original link (e.g. instagram.com/financewith…).
const SOCIAL_BASES: Record<string, string> = {
  instagram: 'https://instagram.com/',
  twitter: 'https://twitter.com/',
  x: 'https://x.com/',
  tiktok: 'https://tiktok.com/@',
  twitch: 'https://twitch.tv/',
  linkedin: 'https://linkedin.com/in/',
  telegram: 'https://t.me/',
  threads: 'https://threads.net/@',
  snapchat: 'https://snapchat.com/add/',
}

const socialHref = (s: SocialItem): string => {
  if (s.category === 'social') {
    const base = SOCIAL_BASES[s.platform?.toLowerCase()]
    const handle = s.label?.replace(/^@/, '').trim()
    // Only rebuild when the handle is a plain username; otherwise trust the URL.
    if (base && handle && /^[a-zA-Z0-9_.]+$/.test(handle)) return base + handle
  }
  return s.url
}

const formatNumber = (num?: string | number) => {
  if (!num) return "0"
  const n = typeof num === 'string' ? parseInt(num) : num
  if (isNaN(n)) return "0"
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M'
  if (n >= 1000) return (n / 1000).toFixed(1) + 'K'
  return n.toString()
}

const chartConfig = {
  views: { label: "Views", color: "hsl(var(--primary))" },
} satisfies ChartConfig

const GROWTH_STAGE_STYLES: Record<string, string> = {
  Emerging: "bg-sky-100 text-sky-700",
  Established: "bg-emerald-100 text-emerald-700",
  Authority: "bg-violet-100 text-violet-700",
  Legendary: "bg-amber-100 text-amber-700",
}

function DashboardContent() {
  const [mounted, setMounted] = useState(false);
  const [searchUrl, setSearchUrl] = useState("")
  const [loading, setLoading] = useState(false)
  const [channelData, setChannelData] = useState<YouTubeChannelData | null>(null)
  const [recentVideos, setRecentVideos] = useState<YouTubeVideoData[]>([])
  const [demographics, setDemographics] = useState<AnalyzeChannelOutput | null>(null)
  const [overview, setOverview] = useState<AnalyzeChannelOverviewOutput | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [aiLoading, setAiLoading] = useState(false)
  const [aiError, setAiError] = useState<string | null>(null)
  const [videosPageToken, setVideosPageToken] = useState<string | undefined>(undefined)
  const [loadingMore, setLoadingMore] = useState(false)
  const [audienceExpanded, setAudienceExpanded] = useState(false)
  const [socialsData, setSocialsData] = useState<SocialItem[] | null>(null)
  const [socialsLoading, setSocialsLoading] = useState(false)
  // Content Library controls
  const [libSort, setLibSort] = useState<'recent' | 'popular' | 'oldest' | 'earnings' | 'longest'>('recent')
  const [libSearch, setLibSearch] = useState('')

  const [recentAnalyses, setRecentAnalyses] = useState<any[]>([])

  const searchParams = useSearchParams()

  useEffect(() => {
    setMounted(true);
    const saved = localStorage.getItem('creator-hub-history');
    if (saved) setRecentAnalyses(JSON.parse(saved));
  }, []);

  // Runs the two AI analyses independently so one failing doesn't block the other,
  // and can be re-invoked by the per-section retry button.
  const runAiAnalysis = useCallback(async (data: YouTubeChannelData, videos: YouTubeVideoData[]) => {
    setAiLoading(true)
    setAiError(null)

    const [demoResult, overviewResult] = await Promise.allSettled([
      analyzeChannelDemographics({
        title: data.title,
        description: data.description,
        viewCount: data.statistics.viewCount,
        subscriberCount: data.statistics.subscriberCount,
        videoCount: data.statistics.videoCount,
        publishedAt: data.publishedAt,
      }),
      analyzeChannelOverview({
        channelTitle: data.title,
        channelDescription: data.description,
        recentVideoTitles: videos.slice(0, 10).map(v => v.title),
        recentVideoDescriptions: videos.slice(0, 10).map(v => v.description || ""),
      }),
    ])

    let failed = false
    if (demoResult.status === 'fulfilled') setDemographics(demoResult.value)
    else { failed = true; console.warn('Demographics analysis failed:', demoResult.reason) }
    if (overviewResult.status === 'fulfilled') setOverview(overviewResult.value)
    else { failed = true; console.warn('Overview analysis failed:', overviewResult.reason) }

    if (failed) setAiError("AI insights couldn't be generated. Your channel stats are still accurate.")
    setAiLoading(false)
  }, [])

  // Resolve social/external handles: scrape the About "Links" section + description
  // URLs, then let the AI classify + organize them. Runs async, non-blocking.
  const resolveSocials = useCallback(async (data: YouTubeChannelData) => {
    setSocialsLoading(true)
    setSocialsData(null)
    try {
      const aboutLinks = await fetchChannelLinks(data.id)
      const descUrls = (data.description.match(/https?:\/\/[^\s]+/g) || [])
        .map(u => u.replace(/[)\]}.,'"]+$/, ''))
        .map(url => ({ label: '', url }))
      const candidates = [...aboutLinks, ...descUrls]
      if (candidates.length === 0) { setSocialsData([]); return }
      const res = await organizeChannelSocials({
        channelTitle: data.title,
        channelHandle: data.customUrl || undefined,
        links: candidates,
      })
      setSocialsData(res.socials || [])
    } catch (e) {
      console.warn('Socials resolution failed:', e)
      setSocialsData([])
    } finally {
      setSocialsLoading(false)
    }
  }, [])

  const handleSearch = useCallback(async (overrideUrl?: string) => {
    const url = (overrideUrl ?? searchUrl).trim()
    if (!url) {
      setError("Please enter a YouTube channel URL, handle, or ID.")
      return
    }

    setLoading(true)
    setError(null)
    setAiError(null)
    setDemographics(null)
    setOverview(null)
    setRecentVideos([])
    setVideosPageToken(undefined)
    setAudienceExpanded(false)
    setSocialsData(null)
    setLibSearch('')
    setLibSort('recent')

    try {
      const data = await fetchYouTubeChannelData(url)
      if (!data) {
        setError("Could not find that channel. Please check the handle or URL.")
        setChannelData(null)
        setLoading(false)
        return
      }
      setChannelData(data)

      // Save to local history
      const savedHistory = localStorage.getItem('creator-hub-history');
      const history = savedHistory ? JSON.parse(savedHistory) : [];
      const newHistory = [{ id: data.id, title: data.title, thumbnail: data.thumbnails.high.url, analyzedAt: new Date().toISOString() }, ...history.filter((h: any) => h.id !== data.id)].slice(0, 5);
      localStorage.setItem('creator-hub-history', JSON.stringify(newHistory));
      setRecentAnalyses(newHistory);

      const { videos, nextPageToken } = await fetchChannelVideosPage(data.uploadsPlaylistId, 50)
      setRecentVideos(videos)
      setVideosPageToken(nextPageToken)
      setLoading(false)

      // AI analysis + social resolution run after core data is on screen.
      runAiAnalysis(data, videos)
      resolveSocials(data)
    } catch (err: any) {
      console.error('Channel analysis error:', err)
      setError(err?.message || "An error occurred during research.")
      setLoading(false)
    }
  }, [searchUrl, runAiAnalysis, resolveSocials])

  useEffect(() => {
    const urlParam = searchParams.get('url')
    if (urlParam && mounted) {
      const decoded = decodeURIComponent(urlParam)
      setSearchUrl(decoded)
      handleSearch(decoded)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, mounted])

  const loadMore = useCallback(async () => {
    if (!channelData || !videosPageToken) return
    setLoadingMore(true)
    try {
      const { videos, nextPageToken } = await fetchChannelVideosPage(channelData.uploadsPlaylistId, 50, videosPageToken)
      setRecentVideos(prev => {
        const seen = new Set(prev.map(v => v.id))
        return [...prev, ...videos.filter(v => !seen.has(v.id))]
      })
      setVideosPageToken(nextPageToken)
    } catch (e) {
      console.warn('Load more failed:', e)
    } finally {
      setLoadingMore(false)
    }
  }, [channelData, videosPageToken])

  // Niche-specific RPM band from the AI overview, used across all earnings estimates.
  const rpmBand = useMemo(() => (
    overview?.monetization
      ? { rpmLow: overview.monetization.estimatedRpmLowUsd, rpmHigh: overview.monetization.estimatedRpmHighUsd }
      : undefined
  ), [overview])

  // Chart of the most recent uploads (oldest → newest), enriched for a rich hover card.
  const chartData = useMemo(() => {
    const recent = recentVideos.slice(0, 8)
    return recent
      .map((v, i) => ({
        name: `#${recent.length - i}`,
        views: parseInt(v.viewCount || "0") || 0,
        title: v.title,
        thumbnail: v.thumbnail,
        publishedAt: v.publishedAt,
        duration: v.duration,
        short: isShort(v.duration),
      }))
      .reverse()
  }, [recentVideos])

  const avgViews = useMemo(() => {
    const counted = recentVideos.slice(0, 8)
    if (counted.length === 0) return 0
    const total = counted.reduce((sum, v) => sum + (parseInt(v.viewCount || "0") || 0), 0)
    return Math.round(total / counted.length)
  }, [recentVideos])

  // Counts per format (independent of search) keep the tab labels stable.
  const longCount = useMemo(() => recentVideos.filter(v => !isShort(v.duration)).length, [recentVideos])
  const shortCount = useMemo(() => recentVideos.filter(v => isShort(v.duration)).length, [recentVideos])

  // Filter (format + title search) and sort the library for a given tab.
  const applyLibView = useCallback((format: 'all' | 'long' | 'short') => {
    let list = recentVideos
    if (format === 'long') list = list.filter(v => !isShort(v.duration))
    else if (format === 'short') list = list.filter(v => isShort(v.duration))
    const q = libSearch.trim().toLowerCase()
    if (q) list = list.filter(v => v.title.toLowerCase().includes(q))
    const views = (v: YouTubeVideoData) => parseInt(v.viewCount || '0') || 0
    const date = (v: YouTubeVideoData) => new Date(v.publishedAt).getTime() || 0
    const earn = (v: YouTubeVideoData) => estimateEarnings(v.viewCount, { short: isShort(v.duration), ...rpmBand }).high
    const sorted = [...list]
    switch (libSort) {
      case 'popular': sorted.sort((a, b) => views(b) - views(a)); break
      case 'oldest': sorted.sort((a, b) => date(a) - date(b)); break
      case 'longest': sorted.sort((a, b) => parseIsoDuration(b.duration) - parseIsoDuration(a.duration)); break
      case 'earnings': sorted.sort((a, b) => earn(b) - earn(a)); break
      case 'recent':
      default: sorted.sort((a, b) => date(b) - date(a)); break
    }
    return sorted
  }, [recentVideos, libSearch, libSort, rpmBand])

  if (!mounted) return null

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <SidebarNav />
      <main className="flex-1 overflow-y-auto p-8">
        <header className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-slate-900">Channel Analyzer</h1>
            <p className="text-muted-foreground mt-1">Deep search without limits.</p>
          </div>
          <div className="flex items-center gap-4">
            <input
              type="text"
              placeholder="Paste channel URL, @handle, or ID..."
              value={searchUrl}
              onChange={(e) => setSearchUrl(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleSearch() }}
              className="px-4 py-2 border rounded-full text-sm w-80"
            />
            <Button onClick={() => handleSearch()} disabled={loading} className="bg-primary rounded-full">
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Analyze"}
            </Button>
          </div>
        </header>

        {error && <Alert variant="destructive" className="mb-8"><AlertCircle className="h-4 w-4" /><AlertTitle>Error</AlertTitle><AlertDescription>{error}</AlertDescription></Alert>}

        {!channelData && !loading && (
          <div className="space-y-12">
            {recentAnalyses.length > 0 && (
              <section className="space-y-4">
                <h3 className="text-[11px] font-bold uppercase tracking-widest text-slate-500">Recently Analyzed</h3>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  {recentAnalyses.map((analysis) => (
                    <Card key={analysis.id} className="cursor-pointer" onClick={() => { setSearchUrl(analysis.id); handleSearch(analysis.id); }}>
                      <CardContent className="p-4 flex items-center gap-4">
                        <div className="h-10 w-10 rounded overflow-hidden relative"><img src={analysis.thumbnail} alt="" className="object-cover h-full w-full" /></div>
                        <p className="text-sm font-bold truncate flex-1">{analysis.title}</p>
                        <ArrowRight className="h-4 w-4 text-slate-300" />
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </section>
            )}

            <section className="grid grid-cols-1 md:grid-cols-3 gap-6">
               {[
                  { title: "Identity", desc: "Niche, tone, and positioning", icon: Fingerprint },
                  { title: "Growth", desc: "Upload velocity and momentum", icon: Gauge },
                  { title: "Audience", desc: "Personas and reach", icon: Target },
                ].map((item, i) => (
                  <Card key={i} className="border-none shadow-sm bg-white/50">
                    <CardContent className="p-6 space-y-3">
                      <div className="h-10 w-10 rounded-xl bg-primary/10 flex items-center justify-center"><item.icon className="h-5 w-5 text-primary" /></div>
                      <h4 className="font-bold">{item.title}</h4>
                      <p className="text-xs text-slate-500">{item.desc}</p>
                    </CardContent>
                  </Card>
                ))}
            </section>
          </div>
        )}

        {channelData && (
          <div className="space-y-8 animate-in fade-in">
             <Card className="border-none shadow-sm overflow-hidden bg-white">
                <CardContent className="p-6 flex flex-col md:flex-row md:items-center gap-6">
                  <div className="h-20 w-20 rounded-full overflow-hidden border-4 shrink-0"><img src={channelData.thumbnails.high.url} alt="" className="h-full w-full object-cover" /></div>
                  <div className="flex-1 min-w-0">
                    <h2 className="text-2xl font-bold truncate">{channelData.title}</h2>
                    <div className="flex items-center gap-2 mt-1 flex-wrap">
                      <p className="text-slate-500 font-medium">{demographics?.estimatedNiche || (aiLoading ? "Analyzing…" : "—")}</p>
                      {demographics?.growthStage && (
                        <Badge className={cn("border-none text-[10px] font-bold uppercase", GROWTH_STAGE_STYLES[demographics.growthStage] || "bg-slate-100 text-slate-700")}>
                          {demographics.growthStage}
                        </Badge>
                      )}
                    </div>
                    {socialsLoading && !socialsData && (
                      <div className="flex items-center gap-1.5 mt-2">
                        <div className="h-7 w-20 rounded-full bg-slate-100 animate-pulse" />
                        <div className="h-7 w-20 rounded-full bg-slate-100 animate-pulse" />
                        <div className="h-7 w-20 rounded-full bg-slate-100 animate-pulse" />
                      </div>
                    )}
                    {socialsData && socialsData.length > 0 && (
                      <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                        {socialsData.map((s, idx) => {
                          const Icon = getSocialIcon(s.platform)
                          const isSocial = s.category === 'social'
                          return (
                            <a key={`${s.url}-${idx}`} href={socialHref(s)} target="_blank" rel="noopener noreferrer" title={`${s.platform}: ${socialHref(s)}`}
                               className={cn(
                                 "flex items-center gap-1 h-7 px-2.5 rounded-full text-[11px] font-semibold transition-colors",
                                 isSocial ? "bg-primary/10 text-primary hover:bg-primary/20" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                               )}>
                              <Icon className="h-3.5 w-3.5" />
                              <span className="max-w-[140px] truncate">{s.label}</span>
                            </a>
                          )
                        })}
                      </div>
                    )}
                  </div>
                  <div className="flex gap-8 md:gap-12 md:mr-8">
                    <div className="text-center"><p className="text-2xl font-bold">{formatNumber(channelData.statistics.subscriberCount)}</p><p className="text-[10px] font-bold text-slate-400 uppercase">Subs</p></div>
                    <div className="text-center"><p className="text-2xl font-bold">{formatNumber(channelData.statistics.viewCount)}</p><p className="text-[10px] font-bold text-slate-400 uppercase">Views</p></div>
                    <div className="text-center">
                      <p className="text-2xl font-bold text-primary">{demographics ? `${demographics.performanceScore}` : (aiLoading ? "…" : "—")}<span className="text-sm text-slate-400 font-medium">/100</span></p>
                      <p className="text-[10px] font-bold text-slate-400 uppercase">Score</p>
                    </div>
                  </div>
                </CardContent>
             </Card>

             {aiError && (
               <div className="p-4 border border-amber-200 bg-amber-50 rounded-xl flex items-center justify-between gap-3">
                 <div className="flex items-center gap-3">
                   <AlertCircle className="h-5 w-5 text-amber-600 shrink-0" />
                   <p className="text-sm font-medium text-amber-800">{aiError}</p>
                 </div>
                 <Button size="sm" variant="outline" onClick={() => runAiAnalysis(channelData, recentVideos)} disabled={aiLoading} className="rounded-full gap-2 border-amber-300 shrink-0">
                   <RefreshCw className={cn("h-3.5 w-3.5", aiLoading && "animate-spin")} /> Retry insights
                 </Button>
               </div>
             )}

             <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <Card className="p-6 space-y-4">
                  <div className="flex items-center gap-2"><Fingerprint className="h-4 w-4 text-primary" /><h3 className="font-bold text-sm">Identity</h3></div>
                  {overview ? (
                    <div className="space-y-2">
                      <div className="flex flex-wrap gap-2">
                        <Badge className="bg-primary/10 text-primary border-none uppercase text-[10px]">{overview.identity.nicheTag}</Badge>
                        <Badge variant="outline" className="text-[10px] uppercase">{overview.identity.contentTone}</Badge>
                      </div>
                      <p className="text-sm text-slate-700">{overview.identity.targetAudience}</p>
                    </div>
                  ) : aiError ? <p className="text-xs text-slate-400">Insights unavailable — retry above.</p> : <Skeleton className="h-12 w-full" />}
                </Card>
                <Card className="p-6 space-y-4">
                  <div className="flex items-center gap-2"><Target className="h-4 w-4 text-emerald-500" /><h3 className="font-bold text-sm">Audience</h3></div>
                  {demographics ? (
                    <div className="space-y-2">
                      <p className={cn("text-xs text-slate-700 leading-relaxed", !audienceExpanded && "line-clamp-4")}>{demographics.audiencePersona}</p>
                      {audienceExpanded && demographics.demographicInsights && (
                        <p className="text-xs text-slate-500 leading-relaxed border-t border-slate-100 pt-2">{demographics.demographicInsights}</p>
                      )}
                      <button onClick={() => setAudienceExpanded(v => !v)} className="flex items-center gap-1 text-[11px] font-bold text-primary hover:underline">
                        {audienceExpanded ? "Show less" : "Show more"}
                        <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", audienceExpanded && "rotate-180")} />
                      </button>
                    </div>
                  ) : aiError ? <p className="text-xs text-slate-400">Insights unavailable — retry above.</p> : <Skeleton className="h-12 w-full" />}
                </Card>
                <Card className="p-6 space-y-4">
                  <div className="flex items-center gap-2"><DollarSign className="h-4 w-4 text-blue-500" /><h3 className="font-bold text-sm">Monetization</h3></div>
                  {overview ? (
                    <div className="space-y-3">
                      <div className="rounded-xl bg-gradient-to-br from-emerald-50 to-emerald-100/40 p-3 border border-emerald-100">
                        <p className="text-[9px] font-bold text-emerald-700/70 uppercase tracking-wider">Est. Ad Revenue · Lifetime</p>
                        <p className="text-lg font-bold text-emerald-700">{formatEarningsRange(estimateEarnings(channelData.statistics.viewCount, rpmBand))}</p>
                        <p className="text-[9px] text-emerald-600/60">
                          {rpmBand ? `Niche RPM ~$${rpmBand.rpmLow}–$${rpmBand.rpmHigh}/1K · AdSense only` : 'Rough estimate from total views · AdSense only'}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge className="bg-blue-50 text-blue-700 border-none text-[10px] uppercase">{overview.monetization.revenueStage} stage</Badge>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {overview.monetization.hasAdSense && <Badge variant="outline" className="text-[10px]">ADSENSE</Badge>}
                        {overview.monetization.hasMerch && <Badge variant="outline" className="text-[10px]">MERCH</Badge>}
                        {overview.monetization.hasMemberships && <Badge variant="outline" className="text-[10px]">MEMBERSHIPS</Badge>}
                      </div>
                    </div>
                  ) : aiError ? <p className="text-xs text-slate-400">Insights unavailable — retry above.</p> : <Skeleton className="h-12 w-full" />}
                </Card>
             </div>

             {chartData.length > 0 && (
               <Card className="border-none shadow-sm bg-white p-6 space-y-4">
                 <div className="flex items-center justify-between flex-wrap gap-2">
                   <h3 className="text-sm font-bold flex items-center gap-2"><BarChart3 className="h-4 w-4 text-primary" /> Recent Upload Performance</h3>
                   <div className="flex items-center gap-2 text-xs text-slate-500">
                     <TrendingUp className="h-3.5 w-3.5 text-emerald-500" />
                     Avg <span className="font-bold text-slate-700">{formatNumber(avgViews)}</span> views / recent upload
                   </div>
                 </div>
                 <ChartContainer config={chartConfig} className="h-[240px] w-full">
                   <BarChart data={chartData} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
                     <CartesianGrid vertical={false} strokeDasharray="3 3" className="stroke-slate-100" />
                     <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 11 }} />
                     <YAxis axisLine={false} tickLine={false} width={44} tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 11 }} tickFormatter={(v) => formatNumber(v)} />
                     <ChartTooltip cursor={{ fill: 'hsl(var(--primary) / 0.06)' }} content={<VideoHoverCard avgViews={avgViews} rpmBand={rpmBand} />} />
                     <Bar dataKey="views" radius={[4, 4, 0, 0]} maxBarSize={48}>
                       {chartData.map((entry, i) => (
                         <Cell key={i} fill={entry.views >= avgViews ? 'hsl(var(--primary))' : 'hsl(var(--primary) / 0.35)'} />
                       ))}
                     </Bar>
                   </BarChart>
                 </ChartContainer>
                 <div className="flex items-center gap-4 text-[10px] text-slate-400">
                   <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm bg-primary" /> Above avg</span>
                   <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm bg-primary/35" /> Below avg</span>
                   <span className="ml-auto">Hover a bar for the video →</span>
                 </div>
               </Card>
             )}

             {recentVideos.length > 0 && (
               <div className="space-y-4">
                 <h3 className="text-xl font-bold flex items-center gap-2"><Video className="h-5 w-5 text-primary" /> Content Library</h3>
                 <Tabs defaultValue="all" className="w-full">
                   <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
                     <TabsList className="bg-slate-100 rounded-full p-1">
                       <TabsTrigger value="all" className="rounded-full text-xs data-[state=active]:bg-white">All ({recentVideos.length})</TabsTrigger>
                       <TabsTrigger value="long" className="rounded-full text-xs data-[state=active]:bg-white">Long-form ({longCount})</TabsTrigger>
                       <TabsTrigger value="short" className="rounded-full text-xs data-[state=active]:bg-white">Shorts ({shortCount})</TabsTrigger>
                     </TabsList>
                     <div className="flex items-center gap-2">
                       <div className="relative">
                         <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
                         <Input value={libSearch} onChange={(e) => setLibSearch(e.target.value)} placeholder="Search titles…" className="h-9 w-44 pl-8 rounded-full bg-slate-50 border-none text-xs" />
                       </div>
                       <Select value={libSort} onValueChange={(v) => setLibSort(v as any)}>
                         <SelectTrigger className="h-9 w-40 rounded-full bg-slate-50 border-none text-xs"><SelectValue /></SelectTrigger>
                         <SelectContent>
                           <SelectItem value="recent">Latest</SelectItem>
                           <SelectItem value="popular">Most popular</SelectItem>
                           <SelectItem value="oldest">Oldest</SelectItem>
                           <SelectItem value="earnings">Top earning</SelectItem>
                           <SelectItem value="longest">Longest</SelectItem>
                         </SelectContent>
                       </Select>
                     </div>
                   </div>
                   <TabsContent value="all" className="mt-4"><VideoGrid videos={applyLibView('all')} formatNumber={formatNumber} rank={libSort === 'popular' || libSort === 'earnings'} rpmBand={rpmBand} emptyLabel={libSearch ? `No videos match "${libSearch}".` : undefined} /></TabsContent>
                   <TabsContent value="long" className="mt-4"><VideoGrid videos={applyLibView('long')} formatNumber={formatNumber} rank={libSort === 'popular' || libSort === 'earnings'} rpmBand={rpmBand} emptyLabel={libSearch ? `No long-form videos match "${libSearch}".` : "No long-form uploads in the loaded set."} /></TabsContent>
                   <TabsContent value="short" className="mt-4"><VideoGrid videos={applyLibView('short')} formatNumber={formatNumber} rank={libSort === 'popular' || libSort === 'earnings'} rpmBand={rpmBand} emptyLabel={libSearch ? `No Shorts match "${libSearch}".` : "No Shorts in the loaded set."} /></TabsContent>
                 </Tabs>
                 {videosPageToken && (
                   <div className="flex justify-center pt-2">
                     <Button variant="outline" onClick={loadMore} disabled={loadingMore} className="rounded-full gap-2">
                       {loadingMore ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                       {loadingMore ? "Loading…" : `See more (${recentVideos.length} loaded)`}
                     </Button>
                   </div>
                 )}
               </div>
             )}
          </div>
        )}
      </main>
    </div>
  )
}

function VideoGrid({
  videos,
  formatNumber,
  emptyLabel,
  rank,
  rpmBand,
}: {
  videos: YouTubeVideoData[]
  formatNumber: (n?: string | number) => string
  emptyLabel?: string
  rank?: boolean
  rpmBand?: { rpmLow: number; rpmHigh: number }
}) {
  if (videos.length === 0) {
    return <p className="text-sm text-slate-400 py-8 text-center">{emptyLabel || "No videos to show."}</p>
  }
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
      {videos.map((video, i) => {
        const durationLabel = formatDuration(video.duration)
        const short = isShort(video.duration)
        return (
          <a key={video.id} href={`https://www.youtube.com/watch?v=${video.id}`} target="_blank" rel="noopener noreferrer" className="block">
            <Card className="overflow-hidden border-none shadow-sm group hover:shadow-md transition-shadow h-full">
              <div className="relative aspect-video">
                <img src={video.thumbnail} alt="" className="object-cover w-full h-full" />
                {rank && <span className="absolute top-1.5 left-1.5 h-6 w-6 rounded-full bg-primary text-white text-[11px] font-bold flex items-center justify-center shadow">{i + 1}</span>}
                {durationLabel && (
                  <span className={cn("absolute bottom-1.5 right-1.5 text-[9px] font-bold text-white px-1.5 py-0.5 rounded", short ? "bg-rose-500" : "bg-black/75")}>
                    {short ? "SHORT" : durationLabel}
                  </span>
                )}
                {/* Estimated earnings — revealed on hover */}
                <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex items-end p-2.5">
                  <div className="text-white">
                    <p className="text-[8px] font-bold uppercase tracking-wider text-emerald-300 flex items-center gap-1"><DollarSign className="h-2.5 w-2.5" /> Est. Earnings</p>
                    <p className="text-sm font-bold leading-tight">{formatEarningsRange(estimateEarnings(video.viewCount, { short, ...rpmBand }))}</p>
                  </div>
                </div>
              </div>
              <CardContent className="p-3 space-y-1">
                <p className="text-[10px] font-bold line-clamp-2 h-8">{video.title}</p>
                <div className="flex items-center justify-between text-[10px] text-slate-400">
                  <span className="font-semibold text-slate-500">{formatNumber(video.viewCount)} views</span>
                  <span>{timeAgo(video.publishedAt)}</span>
                </div>
              </CardContent>
            </Card>
          </a>
        )
      })}
    </div>
  )
}

// Rich hover card for the performance chart — shows the actual video with its
// thumbnail, upload timing, views, and estimated earnings.
function VideoHoverCard({ active, payload, avgViews, rpmBand }: any) {
  if (!active || !payload?.length) return null
  const d = payload[0].payload
  const earnings = estimateEarnings(d.views, { short: d.short, ...rpmBand })
  const vsAvg = avgViews > 0 ? Math.round((d.views / avgViews) * 100) - 100 : 0
  return (
    <div className="rounded-xl border border-slate-200 bg-white shadow-xl p-2 w-56">
      <div className="relative aspect-video rounded-lg overflow-hidden mb-2">
        <img src={d.thumbnail} alt="" className="object-cover w-full h-full" />
        {d.duration && (
          <span className={cn("absolute bottom-1 right-1 text-[8px] font-bold text-white px-1.5 py-0.5 rounded", d.short ? "bg-rose-500" : "bg-black/75")}>
            {d.short ? "SHORT" : formatDuration(d.duration)}
          </span>
        )}
      </div>
      <p className="text-[11px] font-bold leading-snug line-clamp-2">{d.title}</p>
      <div className="flex items-center justify-between text-[10px] text-slate-500 mt-1">
        <span className="font-semibold">{formatNumber(d.views)} views</span>
        <span>{timeAgo(d.publishedAt)}</span>
      </div>
      <div className="flex items-center justify-between mt-1.5 pt-1.5 border-t border-slate-100">
        <span className="flex items-center gap-1 text-[10px] font-bold text-emerald-600"><DollarSign className="h-3 w-3" />{formatEarningsRange(earnings)}</span>
        {avgViews > 0 && (
          <span className={cn("text-[10px] font-bold", vsAvg >= 0 ? "text-emerald-600" : "text-slate-400")}>
            {vsAvg >= 0 ? "+" : ""}{vsAvg}% vs avg
          </span>
        )}
      </div>
    </div>
  )
}

export default function Dashboard() {
  return (
    <Suspense fallback={<div className="flex h-screen items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>}>
      <DashboardContent />
    </Suspense>
  )
}
