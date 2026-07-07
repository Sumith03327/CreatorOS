'use client';

import { useState } from 'react';
import { SidebarNav } from '@/components/dashboard/SidebarNav';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Loader2, BarChart3, Sparkles, FileText, TrendingUp, AlertCircle } from 'lucide-react';
import { analyzeLatestVideoPerformance, type AnalyzeLatestVideoPerformanceOutput } from '@/ai/flows/analyze-latest-video-performance';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';

export default function AnalyzerPage() {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<AnalyzeLatestVideoPerformanceOutput | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const formData = new FormData(e.currentTarget);
    const input = {
      videoTitle: formData.get('title') as string,
      videoDescription: formData.get('description') as string,
      videoTranscript: formData.get('transcript') as string,
      channelNiche: formData.get('niche') as string,
      videoMetrics: {
        views: Number(formData.get('views')),
        watchTimeHours: Number(formData.get('watchTime')),
        averageViewDurationSeconds: Number(formData.get('avd')),
        audienceRetentionData: [
          { timeInSeconds: 0, percentage: 100 },
          { timeInSeconds: 30, percentage: 70 },
          { timeInSeconds: 60, percentage: 65 },
          { timeInSeconds: 120, percentage: 60 },
          { timeInSeconds: 180, percentage: 55 },
        ]
      }
    };

    try {
      const output = await analyzeLatestVideoPerformance(input);
      setResult(output);
    } catch (err) {
      setError('Failed to analyze video. Please try again.');
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <SidebarNav />
      <main className="flex-1 overflow-y-auto p-8">
        <header className="mb-8">
          <h1 className="text-3xl font-bold tracking-tight text-slate-900">Channel Analyzer</h1>
          <p className="text-muted-foreground mt-1">Deep dive into your video performance with AI-powered insights.</p>
        </header>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          <Card className="border-none shadow-sm">
            <CardHeader>
              <CardTitle>Video Details</CardTitle>
              <CardDescription>Enter the data for your latest upload</CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="title">Video Title</Label>
                  <Input id="title" name="title" placeholder="e.g., Why AI is changing everything" required />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="niche">Channel Niche</Label>
                    <Input id="niche" name="niche" placeholder="e.g., Tech & AI" required />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="views">Views</Label>
                    <Input id="views" name="views" type="number" placeholder="5000" required />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="watchTime">Watch Time (Hours)</Label>
                    <Input id="watchTime" name="watchTime" type="number" placeholder="250" required />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="avd">Avg. View Duration (Sec)</Label>
                    <Input id="avd" name="avd" type="number" placeholder="180" required />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="description">Video Description</Label>
                  <Textarea id="description" name="description" placeholder="Paste video description here..." className="h-24" required />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="transcript">Video Transcript</Label>
                  <Textarea id="transcript" name="transcript" placeholder="Paste full transcript here for deep context analysis..." className="h-32" required />
                </div>
                <Button type="submit" className="w-full" disabled={loading}>
                  {loading ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Analyzing Performance...
                    </>
                  ) : (
                    <>
                      <Sparkles className="mr-2 h-4 w-4" />
                      Run AI Analysis
                    </>
                  )}
                </Button>
              </form>
            </CardContent>
          </Card>

          <div className="space-y-6">
            {error && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertTitle>Error</AlertTitle>
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            {!result && !loading && !error && (
              <Card className="border-dashed border-2 flex flex-col items-center justify-center p-12 text-center h-full">
                <div className="h-12 w-12 bg-slate-50 rounded-full flex items-center justify-center mb-4">
                  <BarChart3 className="h-6 w-6 text-slate-400" />
                </div>
                <h3 className="text-lg font-semibold">No Analysis Yet</h3>
                <p className="text-sm text-muted-foreground max-w-[250px] mt-2">
                  Fill out the form to generate a comprehensive performance report.
                </p>
              </Card>
            )}

            {result && (
              <div className="space-y-6">
                <Card className="border-none shadow-sm bg-primary/5 border-l-4 border-primary">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-lg flex items-center gap-2">
                      <FileText className="h-5 w-5 text-primary" />
                      Performance Summary
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-sm leading-relaxed text-slate-700">{result.summary}</p>
                  </CardContent>
                </Card>

                <Card className="border-none shadow-sm">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-lg flex items-center gap-2">
                      <TrendingUp className="h-5 w-5 text-emerald-500" />
                      Key Insights
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-sm leading-relaxed text-slate-700">{result.insights}</p>
                  </CardContent>
                </Card>

                <Card className="border-none shadow-sm">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-lg flex items-center gap-2">
                      <BarChart3 className="h-5 w-5 text-amber-500" />
                      Retention Analysis
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-sm leading-relaxed text-slate-700">{result.retentionAnalysis}</p>
                  </CardContent>
                </Card>

                <Card className="border-none shadow-sm bg-emerald-50/50 border-l-4 border-emerald-500">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-lg">Recommendations</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-sm leading-relaxed text-slate-700 font-medium">{result.recommendations}</p>
                  </CardContent>
                </Card>
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
