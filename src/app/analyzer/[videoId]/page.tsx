'use client';

import { useState, useEffect, use } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import Link from 'next/link';
import { 
  ArrowLeft, 
  Loader2, 
  Copy, 
  Download, 
  FileText, 
  Zap, 
  Star, 
  AlertCircle, 
  Heart, 
  Lightbulb, 
  CheckCircle2,
  TrendingUp,
  Magnet,
  Layers
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { toast } from '@/hooks/use-toast';
import { fetchVideoDetails, fetchTranscript, type YouTubeVideoData, type TranscriptSegment } from '@/services/youtube';
import { analyzeScript, type AnalyzeScriptOutput } from '@/ai/flows/analyze-script-flow';
import { cn } from '@/lib/utils';

interface PageProps {
  params: Promise<{ videoId: string }>;
}

export default function VideoAnalysisPage({ params }: PageProps) {
  const resolvedParams = use(params);
  const videoId = resolvedParams.videoId;
  const router = useRouter();
  
  const [loading, setLoading] = useState(true);
  const [loadingStep, setLoadingStep] = useState(1);
  const [progress, setProgress] = useState(0);
  const [videoData, setVideoData] = useState<YouTubeVideoData | null>(null);
  const [transcript, setTranscript] = useState<TranscriptSegment[]>([]);
  const [analysis, setAnalysis] = useState<AnalyzeScriptOutput | null>(null);

  useEffect(() => {
    async function runFullAnalysis() {
      try {
        setLoadingStep(1);
        setProgress(10);
        const details = await fetchVideoDetails(videoId);
        if (!details) {
          toast({ variant: "destructive", title: "Error", description: "Video not found." });
          router.push('/');
          return;
        }
        setVideoData(details);
        setProgress(30);

        setLoadingStep(2);
        const transcriptData = await fetchTranscript(videoId);
        setTranscript(transcriptData);
        setProgress(60);

        if (transcriptData.length === 0) {
          toast({ variant: "destructive", title: "Transcript Error", description: "Could not retrieve transcript for this video." });
        }

        setLoadingStep(3);
        const fullText = transcriptData.map(t => t.text).join(' ');
        const result = await analyzeScript({
          transcript: fullText || "No transcript available.",
          videoTitle: details.title
        });
        setAnalysis(result);
        setProgress(100);
        setLoading(false);
      } catch (error) {
        console.error(error);
        toast({ variant: "destructive", title: "Analysis Failed", description: "Jade encountered an error during analysis." });
        setLoading(false);
      }
    }

    runFullAnalysis();
  }, [videoId, router]);

  useEffect(() => {
    if (loading && progress < 90) {
      const timer = setInterval(() => {
        setProgress(prev => Math.min(prev + 1, progress + 10));
      }, 500);
      return () => clearInterval(timer);
    }
  }, [loading, progress]);

  const formatTime = (ms: number) => {
    const totalSeconds = Math.floor(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  };

  const copyTranscript = () => {
    const text = transcript.map(t => t.text).join('\n');
    navigator.clipboard.writeText(text);
    toast({ title: "Copied!", description: "Transcript copied to clipboard." });
  };

  const downloadTranscript = () => {
    const text = transcript.map(t => `${formatTime(t.offset)} - ${t.text}`).join('\n');
    const blob = new Blob([text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${videoData?.title || 'transcript'}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-background p-8">
        <div className="max-w-md w-full text-center space-y-8">
          <div className="relative inline-block">
            <div className="h-24 w-24 rounded-full border-4 border-primary/20 border-t-primary animate-spin" />
            <div className="absolute inset-0 flex items-center justify-center">
              <Zap className="h-8 w-8 text-primary fill-primary" />
            </div>
          </div>
          <div className="space-y-4">
            <h2 className="text-2xl font-bold tracking-tight">
              {loadingStep === 1 && "Fetching video context..."}
              {loadingStep === 2 && "Jade is transcribing this video..."}
              {loadingStep === 3 && "Analyzing script patterns..."}
            </h2>
            <div className="space-y-2">
              <Progress value={progress} className="h-2" />
              <p className="text-sm text-muted-foreground font-medium">{progress}% Complete</p>
            </div>
            <p className="text-slate-500 italic">"Good things take time. I'm digging deep into the content." - Jade</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50/50">
      <header className="sticky top-0 z-30 bg-white/80 backdrop-blur-md border-b">
        <div className="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between">
          <Button variant="ghost" size="sm" onClick={() => router.back()} className="gap-2">
            <ArrowLeft className="h-4 w-4" /> Back to Dashboard
          </Button>
          <div className="flex items-center gap-2">
            <Zap className="h-5 w-5 text-primary fill-primary" />
            <span className="font-bold">Jade AI Analysis</span>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-8 space-y-8">
        {videoData && (
          <Card className="overflow-hidden border-none shadow-sm">
            <div className="flex flex-col md:flex-row gap-6 p-6">
              <div className="relative aspect-video w-full md:w-80 rounded-lg overflow-hidden shrink-0">
                <Image src={videoData.thumbnail} alt={videoData.title} fill className="object-cover" />
              </div>
              <div className="flex-1 space-y-3">
                <div className="flex items-center gap-2">
                  <Badge variant="secondary" className="bg-primary/10 text-primary hover:bg-primary/20 transition-colors uppercase tracking-widest text-[10px]">
                    Analysis Complete
                  </Badge>
                  <span className="text-xs text-muted-foreground">{new Date(videoData.publishedAt).toLocaleDateString()}</span>
                </div>
                <h1 className="text-2xl md:text-3xl font-bold text-slate-900 leading-tight">{videoData.title}</h1>
                <div className="flex items-center gap-2 text-slate-600 font-medium">
                  <div className="h-6 w-6 rounded-full bg-slate-100 flex items-center justify-center">
                    <CheckCircle2 className="h-3.5 w-3.5 text-primary" />
                  </div>
                  {videoData.channelTitle}
                </div>
              </div>
            </div>
          </Card>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          <div className="lg:col-span-1 space-y-6">
            <Card className="h-[600px] flex flex-col border-none shadow-sm">
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <div>
                  <CardTitle className="text-lg flex items-center gap-2">
                    <FileText className="h-5 w-5 text-slate-400" />
                    Transcript
                  </CardTitle>
                </div>
                <div className="flex gap-1">
                  <Button variant="ghost" size="icon" onClick={copyTranscript} title="Copy Transcript">
                    <Copy className="h-4 w-4" />
                  </Button>
                  <Button variant="ghost" size="icon" onClick={downloadTranscript} title="Download .txt">
                    <Download className="h-4 w-4" />
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="flex-1 overflow-hidden p-0">
                <ScrollArea className="h-full px-6 pb-6">
                  <div className="space-y-4">
                    {transcript.length > 0 ? (
                      transcript.map((item, i) => (
                        <div key={i} className="flex gap-4 group">
                          <span className="text-[10px] font-mono text-slate-400 shrink-0 mt-1">{formatTime(item.offset)}</span>
                          <p className="text-sm text-slate-700 leading-relaxed group-hover:text-slate-900 transition-colors">{item.text}</p>
                        </div>
                      ))
                    ) : (
                      <div className="py-12 text-center text-slate-400">
                        <AlertCircle className="h-8 w-8 mx-auto mb-2 opacity-20" />
                        <p className="text-sm">No transcript data available.</p>
                      </div>
                    )}
                  </div>
                </ScrollArea>
              </CardContent>
            </Card>
          </div>

          <div className="lg:col-span-2 space-y-6">
            {analysis && (
              <div className="space-y-6">
                <h2 className="text-xl font-bold flex items-center gap-2 px-1">
                  <Zap className="h-5 w-5 text-primary fill-primary" />
                  Script Analysis Report
                </h2>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <Card className="border-none shadow-sm overflow-hidden bg-emerald-50/30 border-t-4 border-emerald-500">
                    <CardHeader className="pb-2">
                      <div className="flex items-center justify-between">
                        <CardTitle className="text-base flex items-center gap-2 text-emerald-700">
                          <Magnet className="h-4 w-4" />
                          Hook Strength
                        </CardTitle>
                        <Badge className="bg-emerald-500 text-white border-none">{analysis.hook.score}/10</Badge>
                      </div>
                    </CardHeader>
                    <CardContent>
                      <p className="text-sm text-slate-700 leading-relaxed italic">"{analysis.hook.text}"</p>
                    </CardContent>
                  </Card>

                  <Card className="border-none shadow-sm overflow-hidden bg-primary/5 border-t-4 border-primary">
                    <CardHeader className="pb-2">
                      <CardTitle className="text-base flex items-center gap-2 text-primary">
                        <Layers className="h-4 w-4" />
                        Structure Rating
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <p className="text-sm font-bold text-slate-900 mb-1">{analysis.structure.rating}</p>
                      <p className="text-xs text-slate-600">{analysis.structure.details}</p>
                    </CardContent>
                  </Card>
                </div>

                <Card className="border-none shadow-sm bg-amber-50/30 border-l-4 border-amber-500">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base flex items-center gap-2 text-amber-700">
                      <Star className="h-4 w-4 fill-amber-500" />
                      Best Performing Moment
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-sm text-slate-800 font-medium leading-relaxed">{analysis.bestMoment}</p>
                  </CardContent>
                </Card>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <Card className="border-none shadow-sm border-t-4 border-red-500 bg-red-50/20">
                    <CardHeader className="pb-2">
                      <CardTitle className="text-base flex items-center gap-2 text-red-600">
                        <AlertCircle className="h-4 w-4" />
                        Weak Spots
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <ul className="space-y-2">
                        {analysis.weakSpots.map((spot, i) => (
                          <li key={i} className="text-sm text-slate-700 flex gap-2">
                            <span className="text-red-400 mt-1">•</span> {spot}
                          </li>
                        ))}
                      </ul>
                    </CardContent>
                  </Card>

                  <Card className="border-none shadow-sm bg-pink-50/20 border-t-4 border-pink-500">
                    <CardHeader className="pb-2">
                      <CardTitle className="text-base flex items-center gap-2 text-pink-600">
                        <Heart className="h-4 w-4" />
                        Emotional Tone
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <p className="text-sm text-slate-700 leading-relaxed font-medium">{analysis.emotionalTone}</p>
                    </CardContent>
                  </Card>
                </div>

                <Card className="border-none shadow-sm border-t-4 border-blue-500 bg-blue-50/20">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base flex items-center gap-2 text-blue-700">
                      <Lightbulb className="h-4 w-4" />
                      Three Improvements
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-3">
                      {analysis.improvements.map((improvement, i) => (
                        <div key={i} className="flex gap-3 items-start bg-white p-3 rounded-lg border border-blue-100 shadow-sm">
                          <div className="h-6 w-6 rounded-full bg-blue-500 text-white flex items-center justify-center shrink-0 text-xs font-bold">
                            {i + 1}
                          </div>
                          <p className="text-sm text-slate-800 font-medium">{improvement}</p>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>

                <div className="flex justify-center pt-4">
                  <Link href="/plan">
                    <Button className="rounded-full px-8 bg-slate-900 hover:bg-slate-800 gap-2">
                      <TrendingUp className="h-4 w-4" />
                      Add to Content Strategy
                    </Button>
                  </Link>
                </div>
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
