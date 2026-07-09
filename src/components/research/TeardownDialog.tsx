'use client';

import { useEffect, useState } from 'react';
import { Loader2, Quote, Copy, ListTree, Lightbulb, FileWarning } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { toast } from '@/hooks/use-toast';
import { formatMultiplier } from '@/lib/research-metrics';
import { getVideoTeardown, type VideoTeardown } from '@/ai/flows/video-teardown-flow';
import type { ResearchVideo } from '@/services/youtube';

interface TeardownDialogProps {
  video: ResearchVideo | null;
  onClose: () => void;
}

/**
 * "Why did this work, and how do I do it too." Runs the outlier's transcript
 * through the teardown flow and shows the hook, the structure, and a blank
 * outline the creator can fill in.
 */
export function TeardownDialog({ video, onClose }: TeardownDialogProps) {
  const [teardown, setTeardown] = useState<VideoTeardown | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!video) {
      setTeardown(null);
      setError(null);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);
    setTeardown(null);

    getVideoTeardown({ videoId: video.id })
      .then(result => {
        if (!cancelled) setTeardown(result);
      })
      .catch((e: any) => {
        if (!cancelled) setError(e?.message || 'Could not tear this video down.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [video]);

  const copyOutline = () => {
    if (!teardown?.outline.length) return;
    navigator.clipboard.writeText(teardown.outline.map((step, i) => `${i + 1}. ${step}`).join('\n'));
    toast({ title: 'Outline copied', description: 'Paste it into your script draft.' });
  };

  return (
    <Dialog open={Boolean(video)} onOpenChange={open => !open && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="pr-8 text-base leading-snug">{video?.title}</DialogTitle>
          {video && (
            <div className="flex items-center gap-2 pt-1">
              <Badge className="border-none bg-rose-500 text-[10px] font-bold text-white">
                {formatMultiplier(video.outlierScore)} outlier
              </Badge>
              <span className="text-xs text-muted-foreground">{video.channelTitle}</span>
            </div>
          )}
        </DialogHeader>

        {loading && (
          <div className="flex flex-col items-center gap-3 py-16 text-center">
            <Loader2 className="h-5 w-5 animate-spin text-primary" />
            <p className="text-sm text-muted-foreground">Reading the transcript and mapping the structure…</p>
          </div>
        )}

        {error && (
          <div className="flex gap-3 rounded-xl bg-red-50 p-4">
            <FileWarning className="h-5 w-5 shrink-0 text-red-600" />
            <p className="text-sm font-medium text-red-900">{error}</p>
          </div>
        )}

        {teardown && !teardown.transcriptAvailable && (
          <div className="flex gap-3 rounded-xl bg-amber-50 p-4">
            <FileWarning className="h-5 w-5 shrink-0 text-amber-600" />
            <p className="text-sm font-medium text-amber-900">
              This video has no captions, so there's no transcript to analyse. Try another outlier — most do.
            </p>
          </div>
        )}

        {teardown?.transcriptAvailable && (
          <ScrollArea className="max-h-[65vh] pr-4">
            <div className="space-y-6">
              {teardown.hook && (
                <section className="space-y-2">
                  <div className="flex items-center gap-2">
                    <Quote className="h-4 w-4 text-primary" />
                    <h3 className="text-sm font-bold">The hook</h3>
                    <Badge className="border-none bg-primary/10 text-[10px] font-bold uppercase text-primary">
                      {teardown.hook.hookType}
                    </Badge>
                  </div>
                  <blockquote className="border-l-2 border-primary/40 pl-3 text-sm italic text-slate-700">
                    “{teardown.hook.openingLines}”
                  </blockquote>
                  <p className="text-xs text-slate-500">{teardown.hook.whyItWorks}</p>
                </section>
              )}

              {teardown.beats.length > 0 && (
                <section className="space-y-2">
                  <div className="flex items-center gap-2">
                    <ListTree className="h-4 w-4 text-[#264ADE]" />
                    <h3 className="text-sm font-bold">How it's built</h3>
                  </div>
                  <ol className="space-y-2">
                    {teardown.beats.map((beat, i) => (
                      <li key={i} className="flex gap-3 text-sm">
                        <span className="w-12 shrink-0 pt-0.5 font-mono text-[11px] tabular-nums text-slate-400">
                          {beat.timestamp}
                        </span>
                        <span>
                          <span className="font-semibold text-slate-900">{beat.label}</span>
                          <span className="text-slate-600"> — {beat.summary}</span>
                        </span>
                      </li>
                    ))}
                  </ol>
                </section>
              )}

              {teardown.stealables.length > 0 && (
                <section className="space-y-2">
                  <div className="flex items-center gap-2">
                    <Lightbulb className="h-4 w-4 text-amber-500" />
                    <h3 className="text-sm font-bold">What to steal</h3>
                  </div>
                  <ul className="space-y-1.5">
                    {teardown.stealables.map((item, i) => (
                      <li key={i} className="flex gap-2 text-sm text-slate-700">
                        <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400" />
                        {item}
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              {teardown.outline.length > 0 && (
                <section className="space-y-2 rounded-xl bg-slate-50 p-4">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-bold">Your version</h3>
                    <Button variant="ghost" size="sm" onClick={copyOutline} className="h-7 gap-1.5 text-xs">
                      <Copy className="h-3 w-3" /> Copy outline
                    </Button>
                  </div>
                  <ol className="list-inside list-decimal space-y-1.5 text-sm text-slate-700">
                    {teardown.outline.map((step, i) => (
                      <li key={i}>{step}</li>
                    ))}
                  </ol>
                </section>
              )}
            </div>
          </ScrollArea>
        )}
      </DialogContent>
    </Dialog>
  );
}
