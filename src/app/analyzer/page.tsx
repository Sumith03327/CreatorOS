'use client';

import { useState } from 'react';
import { SidebarNav } from '@/components/dashboard/SidebarNav';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Loader2, BarChart3, Sparkles, FileText, TrendingUp, AlertCircle, ChevronDown, FileVideo, Search } from 'lucide-react';
import { analyzeLatestVideoPerformance, type AnalyzeLatestVideoPerformanceOutput } from '@/ai/flows/analyze-latest-video-performance';
import { fetchVideoDetails, fetchTranscript, type YouTubeVideoData } from '@/services/youtube';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { extractVideoId, formatDuration, timeAgo } from '@/lib/video-utils';

const formatNumber = (num?: string | number) => {
  if (!num) return '0';
  const n = typeof num === 'string' ? parseInt(num) : num;
  if (isNaN(n)) return '0';
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
  if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
  return n.toString();
};

export default function VideoPerformancePage() {
  const [url, setUrl] = useState('');
  const [fetching, setFetching] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [video, setVideo] = useState<YouTubeVideoData | null>(null);
  const [transcript, setTranscript] = useState<string>('');
  const [hasTranscript, setHasTranscript] = useState(true);
  const [result, setResult] = useState<AnalyzeLatestVideoPerformanceOutput | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);

  // Optional real numbers a creator can copy from YouTube Studio.
  const [niche, setNiche] = useState('');
  const [watchTime, setWatchTime] = useState('');
  const [avd, setAvd] = useState('');

  async function handleFetch() {
    const videoId = extractVideoId(url);
    if (!videoId) {
      setError('Please paste a valid YouTube video URL (watch, youtu.be, or shorts link).');
      return;
    }
    setFetching(true);
    setError(null);
    setResult(null);
    setVideo(null);
    try {
      const details = await fetchVideoDetails(videoId);
      if (!details) {
        setError('Could not find that video. Check the URL and try again.');
        setFetching(false);
        return;
      }
      setVideo(details);
      setNiche(details.channelTitle || '');
      // Transcript is best-effort; some videos have captions disabled.
      const segs = await fetchTranscript(videoId);
      const text = segs.map(s => s.text).join(' ').trim();
      setTranscript(text);
      setHasTranscript(text.length > 0);
    } catch (err: any) {
      console.error(err);
      setError(err?.message || 'Failed to fetch video data.');
    } finally {
      setFetching(false);
    }
  }

  async function handleAnalyze() {
    if (!video) return;
    setAnalyzing(true);
    setError(null);
    try {
      const views = parseInt(video.viewCount || '0') || 0;
      const avdSec = Number(avd) || 0;
      const output = await analyzeLatestVideoPerformance({
        videoTitle: video.title,
        videoDescription: video.description || '',
        videoTranscript: transcript || '(Transcript unavailable — analyze from title, description, and metrics.)',
        channelNiche: niche || video.channelTitle || 'General',
        videoMetrics: {
          views,
          watchTimeHours: Number(watchTime) || Math.round((views * (avdSec || 120)) / 3600),
          averageViewDurationSeconds: avdSec || 120,
          audienceRetentionData: [
            { timeInSeconds: 0, percentage: 100 },
            { timeInSeconds: 30, percentage: 70 },
            { timeInSeconds: 60, percentage: 65 },
            { timeInSeconds: 120, percentage: 60 },
            { timeInSeconds: 180, percentage: 55 },
          ],
        },
      });
      setResult(output);
    } catch (err: any) {
      console.error(err);
      setError('Failed to analyze video. Please try again.');
    } finally {
      setAnalyzing(false);
    }
  }

  const metricsProvided = Boolean(watchTime || avd);

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <SidebarNav />
      <main className="flex-1 overflow-y-auto p-8">
        <header className="mb-8">
          <div className="flex items-center gap-2 mb-1">
            <FileVideo className="h-6 w-6 text-primary" />
            <h1 className="text-3xl font-bold tracking-tight text-slate-900">Video Performance Check</h1>
          </div>
          <p className="text-muted-foreground">Paste any YouTube video URL for an AI teardown of its hook, retention, and next-step fixes.</p>
        </header>

        <div className="flex items-center gap-3 mb-8 max-w-2xl">
          <Input
            placeholder="https://www.youtube.com/watch?v=…  or  youtu.be/…  or  shorts link"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleFetch(); }}
            className="rounded-full"
          />
          <Button onClick={handleFetch} disabled={fetching} className="rounded-full gap-2 shrink-0">
            {fetching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />} Fetch
          </Button>
        </div>

        {error && (
          <Alert variant="destructive" className="mb-6 max-w-2xl">
            <AlertCircle className="h-4 w-4" /><AlertTitle>Error</AlertTitle><AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {fetching && <Skeleton className="h-40 w-full max-w-2xl rounded-2xl mb-6" />}

        {video && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            <div className="space-y-6">
              <Card className="border-none shadow-sm overflow-hidden">
                <div className="relative aspect-video">
                  <img src={video.thumbnail} alt="" className="object-cover w-full h-full" />
                  {formatDuration(video.duration) && <span className="absolute bottom-2 right-2 text-[11px] font-bold text-white bg-black/75 px-2 py-0.5 rounded">{formatDuration(video.duration)}</span>}
                </div>
                <CardContent className="p-5 space-y-3">
                  <h3 className="font-bold leading-snug">{video.title}</h3>
                  <div className="flex items-center gap-2 flex-wrap text-xs text-slate-500">
                    <span className="font-semibold text-slate-700">{video.channelTitle}</span>
                    <span>·</span><span>{formatNumber(video.viewCount)} views</span>
                    <span>·</span><span>{timeAgo(video.publishedAt)}</span>
                  </div>
                  {!hasTranscript && <Badge variant="outline" className="text-[10px] text-amber-600 border-amber-200">No captions — analysis uses title, description & metrics</Badge>}
                </CardContent>
              </Card>

              <Collapsible open={showAdvanced} onOpenChange={setShowAdvanced}>
                <CollapsibleTrigger asChild>
                  <button className="flex items-center justify-between w-full p-4 bg-slate-50 rounded-xl text-left">
                    <div>
                      <p className="text-sm font-bold">Add your Studio metrics <span className="font-normal text-slate-400">(optional)</span></p>
                      <p className="text-xs text-slate-500">Paste real watch-time & retention from YouTube Studio for a sharper read.</p>
                    </div>
                    <ChevronDown className={showAdvanced ? 'rotate-180 transition-transform' : 'transition-transform'} />
                  </button>
                </CollapsibleTrigger>
                <CollapsibleContent className="pt-4 space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="niche">Niche</Label>
                    <Input id="niche" value={niche} onChange={(e) => setNiche(e.target.value)} placeholder="e.g., Personal Finance" />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="watchTime">Watch Time (hours)</Label>
                      <Input id="watchTime" type="number" value={watchTime} onChange={(e) => setWatchTime(e.target.value)} placeholder="e.g., 250" />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="avd">Avg. View Duration (sec)</Label>
                      <Input id="avd" type="number" value={avd} onChange={(e) => setAvd(e.target.value)} placeholder="e.g., 180" />
                    </div>
                  </div>
                </CollapsibleContent>
              </Collapsible>

              <Button onClick={handleAnalyze} disabled={analyzing} className="w-full rounded-xl">
                {analyzing ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Analyzing…</> : <><Sparkles className="mr-2 h-4 w-4" /> Run AI Analysis</>}
              </Button>
              {!metricsProvided && <p className="text-[11px] text-slate-400 text-center">Watch-time & retention are estimated. Add Studio metrics above for precision.</p>}
            </div>

            <div className="space-y-6">
              {!result && !analyzing && (
                <Card className="border-dashed border-2 flex flex-col items-center justify-center p-12 text-center h-full">
                  <div className="h-12 w-12 bg-slate-50 rounded-full flex items-center justify-center mb-4"><BarChart3 className="h-6 w-6 text-slate-400" /></div>
                  <h3 className="text-lg font-semibold">Ready when you are</h3>
                  <p className="text-sm text-muted-foreground max-w-[250px] mt-2">Run the analysis to get a full performance teardown.</p>
                </Card>
              )}
              {analyzing && <><Skeleton className="h-32 w-full rounded-2xl" /><Skeleton className="h-32 w-full rounded-2xl" /></>}
              {result && (
                <div className="space-y-6 animate-in fade-in">
                  <ResultCard icon={<FileText className="h-5 w-5 text-primary" />} title="Performance Summary" body={result.summary} accent="primary" />
                  <ResultCard icon={<TrendingUp className="h-5 w-5 text-emerald-500" />} title="Key Insights" body={result.insights} />
                  <ResultCard icon={<BarChart3 className="h-5 w-5 text-amber-500" />} title="Retention Analysis" body={result.retentionAnalysis} />
                  <ResultCard title="Recommendations" body={result.recommendations} accent="emerald" />
                </div>
              )}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

function ResultCard({ icon, title, body, accent }: { icon?: React.ReactNode; title: string; body: string; accent?: 'primary' | 'emerald' }) {
  const accentClass = accent === 'primary' ? 'bg-primary/5 border-l-4 border-primary' : accent === 'emerald' ? 'bg-emerald-50/50 border-l-4 border-emerald-500' : '';
  return (
    <Card className={`border-none shadow-sm ${accentClass}`}>
      <CardHeader className="pb-2">
        <CardTitle className="text-lg flex items-center gap-2">{icon}{title}</CardTitle>
      </CardHeader>
      <CardContent><p className="text-sm leading-relaxed text-slate-700">{body}</p></CardContent>
    </Card>
  );
}
