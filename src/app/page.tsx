'use client';

import { useState, useMemo, useEffect, Suspense } from "react"
import Image from "next/image"
import { 
  Youtube, 
  Search, 
  Video, 
  ArrowRight,
  Zap,
  Loader2,
  Fingerprint,
  Gauge,
  DollarSign,
  Check,
  Minus,
  BarChart3,
  TrendingUp,
  Sparkles,
  AlertCircle,
  Activity,
  Target
} from "lucide-react"
import { SidebarNav } from "@/components/dashboard/SidebarNav"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"
import { useRouter, useSearchParams } from "next/navigation"
import { fetchYouTubeChannelData, fetchRecentVideos, type YouTubeChannelData, type YouTubeVideoData } from "@/services/youtube"
import { analyzeChannelDemographics, type AnalyzeChannelOutput } from "@/ai/flows/analyze-channel-demographics-flow"
import { analyzeChannelOverview, type AnalyzeChannelOverviewOutput } from "@/ai/flows/analyze-channel-overview-flow"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { useToast } from "@/hooks/use-toast"
import { 
  Bar, 
  BarChart, 
  Line, 
  LineChart, 
  XAxis, 
  YAxis, 
  ResponsiveContainer 
} from "recharts"
import { ChartContainer, type ChartConfig } from "@/components/ui/chart"
import Link from "next/link"

const chartConfig = {
  count: { label: "Uploads", color: "hsl(var(--primary))" },
  views: { label: "Views", color: "hsl(var(--primary))" },
} satisfies ChartConfig

function DashboardContent() {
  const [mounted, setMounted] = useState(false);
  const [searchUrl, setSearchUrl] = useState("")
  const [loading, setLoading] = useState(false)
  const [channelData, setChannelData] = useState<YouTubeChannelData | null>(null)
  const [recentVideos, setRecentVideos] = useState<YouTubeVideoData[]>([])
  const [demographics, setDemographics] = useState<AnalyzeChannelOutput | null>(null)
  const [overview, setOverview] = useState<AnalyzeChannelOverviewOutput | null>(null)
  const [error, setError] = useState<string | null>(null)
  
  const [recentAnalyses, setRecentAnalyses] = useState<any[]>([])
  
  const router = useRouter()
  const searchParams = useSearchParams()
  const { toast } = useToast()

  useEffect(() => {
    setMounted(true);
    const saved = localStorage.getItem('creator-hub-history');
    if (saved) setRecentAnalyses(JSON.parse(saved));
  }, []);

  useEffect(() => {
    const urlParam = searchParams.get('url')
    if (urlParam && mounted) {
      setSearchUrl(decodeURIComponent(urlParam))
      handleSearch(decodeURIComponent(urlParam))
    }
  }, [searchParams, mounted])

  async function handleSearch(overrideUrl?: string) {
    const url = overrideUrl || searchUrl
    if (!url) return;

    setLoading(true)
    setError(null)
    
    try {
      const data = await fetchYouTubeChannelData(url)
      if (!data) {
        setError("Could not find channel. Please check the handle or URL.")
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

      const videos = await fetchRecentVideos(data.uploadsPlaylistId, 20)
      setRecentVideos(videos)

      // Fetch AI Analysis (Mesh API)
      const [demoResult, overviewResult] = await Promise.all([
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
          recentVideoDescriptions: videos.slice(0, 10).map(v => v.title),
        })
      ])

      setDemographics(demoResult)
      setOverview(overviewResult)

    } catch (err: any) {
      setError("An error occurred during research.")
    } finally {
      setLoading(false)
    }
  }

  const formatNumber = (num?: string | number) => {
    if (!num) return "0"
    const n = typeof num === 'string' ? parseInt(num) : num
    if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M'
    if (n >= 1000) return (n / 1000).toFixed(1) + 'K'
    return n.toString()
  }

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
              placeholder="Paste channel URL or handle..." 
              value={searchUrl}
              onChange={(e) => setSearchUrl(e.target.value)}
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
                    <Card key={analysis.id} className="cursor-pointer" onClick={() => handleSearch(analysis.id)}>
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
                <CardContent className="p-6 flex items-center gap-6">
                  <div className="h-20 w-20 rounded-full overflow-hidden border-4"><img src={channelData.thumbnails.high.url} alt="" className="h-full w-full object-cover" /></div>
                  <div className="flex-1">
                    <h2 className="text-2xl font-bold">{channelData.title}</h2>
                    <p className="text-slate-500 font-medium">{demographics?.estimatedNiche || "Analyzing..."}</p>
                  </div>
                  <div className="flex gap-12 mr-8">
                    <div className="text-center"><p className="text-2xl font-bold">{formatNumber(channelData.statistics.subscriberCount)}</p><p className="text-[10px] font-bold text-slate-400 uppercase">Subs</p></div>
                    <div className="text-center"><p className="text-2xl font-bold">{formatNumber(channelData.statistics.viewCount)}</p><p className="text-[10px] font-bold text-slate-400 uppercase">Views</p></div>
                  </div>
                </CardContent>
             </Card>

             <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <Card className="p-6 space-y-4">
                  <div className="flex items-center gap-2"><Fingerprint className="h-4 w-4 text-primary" /><h3 className="font-bold text-sm">Identity</h3></div>
                  {!overview ? <Skeleton className="h-12 w-full" /> : <div className="space-y-2"><Badge className="bg-primary/10 text-primary border-none uppercase text-[10px]">{overview.identity.nicheTag}</Badge><p className="text-sm text-slate-700">{overview.identity.targetAudience}</p></div>}
                </Card>
                <Card className="p-6 space-y-4">
                  <div className="flex items-center gap-2"><Target className="h-4 w-4 text-emerald-500" /><h3 className="font-bold text-sm">Audience</h3></div>
                  {!demographics ? <Skeleton className="h-12 w-full" /> : <p className="text-sm text-slate-700">{demographics.audiencePersona}</p>}
                </Card>
                <Card className="p-6 space-y-4">
                  <div className="flex items-center gap-2"><DollarSign className="h-4 w-4 text-blue-500" /><h3 className="font-bold text-sm">Monetization</h3></div>
                  {!overview ? <Skeleton className="h-12 w-full" /> : <div className="flex flex-wrap gap-2">{overview.monetization.hasAdSense && <Badge variant="outline" className="text-[10px]">ADSENSE</Badge>}{overview.monetization.hasSponsorships && <Badge variant="outline" className="text-[10px]">SPONSORS</Badge>}</div>}
                </Card>
             </div>

             {recentVideos.length > 0 && (
               <div className="space-y-4">
                 <h3 className="text-xl font-bold flex items-center gap-2"><Video className="h-5 w-5 text-primary" /> Content Library</h3>
                 <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                   {recentVideos.map(video => (
                     <Card key={video.id} className="overflow-hidden border-none shadow-sm group">
                       <div className="relative aspect-video"><img src={video.thumbnail} alt="" className="object-cover w-full h-full" /></div>
                       <CardContent className="p-3"><p className="text-[10px] font-bold line-clamp-2 h-8">{video.title}</p></CardContent>
                     </Card>
                   ))}
                 </div>
               </div>
             )}
          </div>
        )}
      </main>
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
