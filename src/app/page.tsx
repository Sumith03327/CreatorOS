'use client';

import { useState, useMemo, useEffect, useCallback, Suspense } from "react"
import {
  Video,
  Loader2,
  Fingerprint,
  DollarSign,
  Target,
  AlertCircle,
  RefreshCw,
  BarChart3,
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
import { ChannelSearch } from "@/components/dashboard/ChannelSearch"
import { AnalyzerSkeleton, type LoadStage } from "@/components/dashboard/AnalyzerSkeleton"
import { RecentAnalyses } from "@/components/dashboard/RecentAnalyses"
import { StarterChannels } from "@/components/dashboard/StarterChannels"
import { ScorePanel } from "@/components/dashboard/ScorePanel"
import { SimilarChannels } from "@/components/research/SimilarChannels"
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
import { formatNumber } from "@/lib/format"
import { readHistory, pushHistory, patchHistory, clearHistory, type ChannelHistoryEntry } from "@/lib/history"

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
  const [loadStage, setLoadStage] = useState<LoadStage>("channel")
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

  const [recentAnalyses, setRecentAnalyses] = useState<ChannelHistoryEntry[]>([])

  const searchParams = useSearchParams()

  useEffect(() => {
    setMounted(true);
    setRecentAnalyses(readHistory());
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
    if (demoResult.status === 'fulfilled') {
      setDemographics(demoResult.value)
      // Second pass on the history entry: the score and niche only exist now.
      setRecentAnalyses(patchHistory(data.id, {
        performanceScore: demoResult.value.performanceScore,
        niche: demoResult.value.estimatedNiche,
      }))
    }
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
    setLoadStage("channel")
    setError(null)
    setAiError(null)
    // Cleared so the skeleton — not a stale channel — fills the wait.
    setChannelData(null)
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
      setLoadStage("videos")

      // First pass on history: the channel facts, available immediately.
      setRecentAnalyses(pushHistory({
        id: data.id,
        title: data.title,
        thumbnail: data.thumbnails.high.url,
        analyzedAt: new Date().toISOString(),
        subscriberCount: data.statistics.subscriberCount,
        viewCount: data.statistics.viewCount,
        videoCount: data.statistics.videoCount,
      }))

      const { videos, nextPageToken } = await fetchChannelVideosPage(data.uploadsPlaylistId, 50)
      setRecentVideos(videos)
      setVideosPageToken(nextPageToken)
      setLoadStage("insights")
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

  const handlePick = useCallback((idOrHandle: string) => {
    setSearchUrl(idOrHandle)
    handleSearch(idOrHandle)
  }, [handleSearch])

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

  const showEmptyState = !channelData && !loading

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <SidebarNav />
      <main className="flex-1 overflow-y-auto p-8">
        <header className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-foreground">Channel Analyzer</h1>
            <p className="text-muted-foreground mt-1">Deep search without limits.</p>
          </div>
          {/* The search moves to the hero on an empty screen; here once there's data. */}
          {!showEmptyState && (
            <ChannelSearch
              variant="compact"
              value={searchUrl}
              onChange={setSearchUrl}
              onSubmit={() => handleSearch()}
              loading={loading}
            />
          )}
        </header>

        {error && <Alert variant="destructive" className="mb-8"><AlertCircle className="h-4 w-4" /><AlertTitle>Error</AlertTitle><AlertDescription>{error}</AlertDescription></Alert>}

        {/* Wide enough that the 3-up history grid has room; the hero search
            constrains itself to max-w-2xl and stays centered within it. */}
        {showEmptyState && (
          <div className="mx-auto w-full max-w-5xl pt-4 md:pt-10 space-y-12 animate-in fade-in duration-300">
            <ChannelSearch
              variant="hero"
              value={searchUrl}
              onChange={setSearchUrl}
              onSubmit={() => handleSearch()}
              loading={loading}
            />

            <div className="space-y-10">
              <RecentAnalyses
                entries={recentAnalyses}
                onSelect={handlePick}
                onClear={() => setRecentAnalyses(clearHistory())}
              />
              <StarterChannels onSelect={handlePick} hasHistory={recentAnalyses.length > 0} />
            </div>
          </div>
        )}

        {loading && <AnalyzerSkeleton stage={loadStage} />}

        {channelData && !loading && (
          <div className="space-y-8 animate-in fade-in">
             <Card className="border-none shadow-sm overflow-hidden bg-card">
                <CardContent className="p-6 flex flex-col md:flex-row md:items-center gap-6">
                  <div className="h-20 w-20 rounded-full overflow-hidden border-4 shrink-0"><img src={channelData.thumbnails.high.url} alt="" className="h-full w-full object-cover" /></div>
                  <div className="flex-1 min-w-0">
                    <h2 className="text-2xl font-bold truncate">{channelData.title}</h2>
                    <div className="flex items-center gap-2 mt-1 flex-wrap">
                      <p className="text-muted-foreground font-medium">{demographics?.estimatedNiche || (aiLoading ? "Analyzing…" : "—")}</p>
                      {demographics?.growthStage && (
                        <Badge className={cn("border-none text-micro font-semibold uppercase", GROWTH_STAGE_STYLES[demographics.growthStage] || "bg-muted text-muted-foreground")}>
                          {demographics.growthStage}
                        </Badge>
                      )}
                    </div>
                    {socialsLoading && !socialsData && (
                      <div className="flex items-center gap-1.5 mt-2">
                        <Skeleton className="h-7 w-20 rounded-full" />
                        <Skeleton className="h-7 w-20 rounded-full" />
                        <Skeleton className="h-7 w-20 rounded-full" />
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
                                 "flex items-center gap-1 h-7 px-2.5 rounded-full text-xs font-semibold transition-colors",
                                 isSocial ? "bg-primary/10 text-primary hover:bg-primary/20" : "bg-muted text-muted-foreground hover:bg-muted/70"
                               )}>
                              <Icon className="h-3.5 w-3.5" />
                              <span className="max-w-[140px] truncate">{s.label}</span>
                            </a>
                          )
                        })}
                      </div>
                    )}
                  </div>
                  <div className="flex items-start gap-8 md:gap-12 md:mr-8">
                    <div className="text-center"><p className="text-2xl font-bold tabular">{formatNumber(channelData.statistics.subscriberCount)}</p><p className="label-caps mt-1">Subs</p></div>
                    <div className="text-center"><p className="text-2xl font-bold tabular">{formatNumber(channelData.statistics.viewCount)}</p><p className="label-caps mt-1">Views</p></div>
                    <ScorePanel score={demographics?.performanceScore} channel={channelData} loading={aiLoading} />
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
                  <div className="flex items-center gap-2"><Fingerprint className="h-4 w-4 text-primary" /><h3 className="font-semibold text-sm">Identity</h3></div>
                  {overview ? (
                    <div className="space-y-2">
                      <div className="flex flex-wrap gap-2">
                        <Badge className="bg-primary/10 text-primary border-none uppercase text-micro">{overview.identity.nicheTag}</Badge>
                        <Badge variant="outline" className="text-micro uppercase">{overview.identity.contentTone}</Badge>
                      </div>
                      <p className="text-sm text-foreground/80">{overview.identity.targetAudience}</p>
                    </div>
                  ) : aiError ? <p className="text-xs text-muted-foreground/70">Insights unavailable — retry above.</p> : <Skeleton className="h-12 w-full" />}
                </Card>
                <Card className="p-6 space-y-4">
                  <div className="flex items-center gap-2"><Target className="h-4 w-4 text-emerald-500" /><h3 className="font-semibold text-sm">Audience</h3></div>
                  {demographics ? (
                    <div className="space-y-2">
                      <p className={cn("text-xs text-foreground/80 leading-relaxed", !audienceExpanded && "line-clamp-4")}>{demographics.audiencePersona}</p>
                      {audienceExpanded && demographics.demographicInsights && (
                        <p className="text-xs text-muted-foreground leading-relaxed border-t border-border/60 pt-2">{demographics.demographicInsights}</p>
                      )}
                      <button onClick={() => setAudienceExpanded(v => !v)} className="flex items-center gap-1 text-xs font-semibold text-primary hover:underline">
                        {audienceExpanded ? "Show less" : "Show more"}
                        <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", audienceExpanded && "rotate-180")} />
                      </button>
                    </div>
                  ) : aiError ? <p className="text-xs text-muted-foreground/70">Insights unavailable — retry above.</p> : <Skeleton className="h-12 w-full" />}
                </Card>
                <Card className="p-6 space-y-4">
                  <div className="flex items-center gap-2"><DollarSign className="h-4 w-4 text-blue-500" /><h3 className="font-semibold text-sm">Monetization</h3></div>
                  {overview ? (
                    <div className="space-y-3">
                      <div className="rounded-xl bg-gradient-to-br from-emerald-50 to-emerald-100/40 p-3 border border-emerald-100">
                        <p className="label-caps-on-tint text-emerald-700/70">Est. Ad Revenue · Lifetime</p>
                        <p className="text-lg font-bold text-emerald-700 tabular">{formatEarningsRange(estimateEarnings(channelData.statistics.viewCount, rpmBand))}</p>
                        <p className="text-micro text-emerald-600/70">
                          {rpmBand ? `Niche RPM ~$${rpmBand.rpmLow}–$${rpmBand.rpmHigh}/1K · AdSense only` : 'Rough estimate from total views · AdSense only'}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge className="bg-blue-50 text-blue-700 border-none text-micro uppercase">{overview.monetization.revenueStage} stage</Badge>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {overview.monetization.hasAdSense && <Badge variant="outline" className="text-micro">ADSENSE</Badge>}
                        {overview.monetization.hasMerch && <Badge variant="outline" className="text-micro">MERCH</Badge>}
                        {overview.monetization.hasMemberships && <Badge variant="outline" className="text-micro">MEMBERSHIPS</Badge>}
                      </div>
                    </div>
                  ) : aiError ? <p className="text-xs text-muted-foreground/70">Insights unavailable — retry above.</p> : <Skeleton className="h-12 w-full" />}
                </Card>
             </div>

             <SimilarChannels
               channelId={channelData.id}
               channelTitle={channelData.title}
               onAnalyse={(id) => {
                 window.scrollTo({ top: 0, behavior: "smooth" })
                 setSearchUrl(id)
                 handleSearch(id)
               }}
             />

             {chartData.length > 0 && (
               <Card className="border-none shadow-sm bg-card p-6 space-y-4">
                 <div className="flex items-center justify-between flex-wrap gap-2">
                   <h3 className="text-sm font-semibold flex items-center gap-2"><BarChart3 className="h-4 w-4 text-primary" /> Recent Upload Performance</h3>
                   <div className="flex items-center gap-2 text-xs text-muted-foreground">
                     <TrendingUp className="h-3.5 w-3.5 text-emerald-500" />
                     Avg <span className="font-semibold text-foreground tabular">{formatNumber(avgViews)}</span> views / recent upload
                   </div>
                 </div>
                 <ChartContainer config={chartConfig} className="h-[240px] w-full">
                   <BarChart data={chartData} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
                     <CartesianGrid vertical={false} strokeDasharray="3 3" className="stroke-border/60" />
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
                 <div className="flex items-center gap-4 text-micro text-muted-foreground/70">
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
                     <TabsList className="bg-muted rounded-full p-1">
                       <TabsTrigger value="all" className="rounded-full text-xs data-[state=active]:bg-card">All ({recentVideos.length})</TabsTrigger>
                       <TabsTrigger value="long" className="rounded-full text-xs data-[state=active]:bg-card">Long-form ({longCount})</TabsTrigger>
                       <TabsTrigger value="short" className="rounded-full text-xs data-[state=active]:bg-card">Shorts ({shortCount})</TabsTrigger>
                     </TabsList>
                     <div className="flex items-center gap-2">
                       <div className="relative">
                         <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground/70" />
                         <Input value={libSearch} onChange={(e) => setLibSearch(e.target.value)} placeholder="Search titles…" className="h-9 w-44 pl-8 rounded-full bg-muted/60 border-none text-xs" />
                       </div>
                       <Select value={libSort} onValueChange={(v) => setLibSort(v as any)}>
                         <SelectTrigger className="h-9 w-40 rounded-full bg-muted/60 border-none text-xs"><SelectValue /></SelectTrigger>
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
                   <TabsContent value="all" className="mt-4"><VideoGrid videos={applyLibView('all')} rank={libSort === 'popular' || libSort === 'earnings'} rpmBand={rpmBand} emptyLabel={libSearch ? `No videos match "${libSearch}".` : undefined} /></TabsContent>
                   <TabsContent value="long" className="mt-4"><VideoGrid videos={applyLibView('long')} rank={libSort === 'popular' || libSort === 'earnings'} rpmBand={rpmBand} emptyLabel={libSearch ? `No long-form videos match "${libSearch}".` : "No long-form uploads in the loaded set."} /></TabsContent>
                   <TabsContent value="short" className="mt-4"><VideoGrid videos={applyLibView('short')} rank={libSort === 'popular' || libSort === 'earnings'} rpmBand={rpmBand} emptyLabel={libSearch ? `No Shorts match "${libSearch}".` : "No Shorts in the loaded set."} /></TabsContent>
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
  emptyLabel,
  rank,
  rpmBand,
}: {
  videos: YouTubeVideoData[]
  emptyLabel?: string
  rank?: boolean
  rpmBand?: { rpmLow: number; rpmHigh: number }
}) {
  if (videos.length === 0) {
    return <p className="text-sm text-muted-foreground/70 py-8 text-center">{emptyLabel || "No videos to show."}</p>
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
                {rank && <span className="absolute top-1.5 left-1.5 h-6 w-6 rounded-full bg-primary text-primary-foreground text-xs font-bold flex items-center justify-center shadow tabular">{i + 1}</span>}
                {durationLabel && (
                  <span className={cn("absolute bottom-1.5 right-1.5 text-micro font-semibold text-white px-1.5 py-0.5 rounded tabular", short ? "bg-rose-500" : "bg-black/75")}>
                    {short ? "SHORT" : durationLabel}
                  </span>
                )}
                {/* Estimated earnings — revealed on hover */}
                <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex items-end p-2.5">
                  <div className="text-white">
                    <p className="label-caps-on-tint text-emerald-300 flex items-center gap-1"><DollarSign className="h-2.5 w-2.5" /> Est. Earnings</p>
                    <p className="text-sm font-bold leading-tight tabular">{formatEarningsRange(estimateEarnings(video.viewCount, { short, ...rpmBand }))}</p>
                  </div>
                </div>
              </div>
              <CardContent className="p-3 space-y-1">
                <p className="text-xs font-medium line-clamp-2 h-8 leading-4">{video.title}</p>
                <div className="flex items-center justify-between text-micro text-muted-foreground/70">
                  <span className="font-semibold text-muted-foreground tabular">{formatNumber(video.viewCount)} views</span>
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
    <div className="rounded-xl border border-border bg-popover shadow-xl p-2 w-56">
      <div className="relative aspect-video rounded-lg overflow-hidden mb-2">
        <img src={d.thumbnail} alt="" className="object-cover w-full h-full" />
        {d.duration && (
          <span className={cn("absolute bottom-1 right-1 text-micro font-semibold text-white px-1.5 py-0.5 rounded tabular", d.short ? "bg-rose-500" : "bg-black/75")}>
            {d.short ? "SHORT" : formatDuration(d.duration)}
          </span>
        )}
      </div>
      <p className="text-xs font-semibold leading-snug line-clamp-2">{d.title}</p>
      <div className="flex items-center justify-between text-micro text-muted-foreground mt-1">
        <span className="font-semibold tabular">{formatNumber(d.views)} views</span>
        <span>{timeAgo(d.publishedAt)}</span>
      </div>
      <div className="flex items-center justify-between mt-1.5 pt-1.5 border-t border-border/60">
        <span className="flex items-center gap-1 text-xs font-semibold text-emerald-600 tabular"><DollarSign className="h-3 w-3" />{formatEarningsRange(earnings)}</span>
        {avgViews > 0 && (
          <span className={cn("text-xs font-semibold tabular", vsAvg >= 0 ? "text-emerald-600" : "text-muted-foreground/70")}>
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
