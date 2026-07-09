'use client';

import { useState } from 'react';
import Image from 'next/image';
import { Loader2, Image as ImageIcon, Copy, Wand2 } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { toast } from '@/hooks/use-toast';
import { getThumbnailDna, type ThumbnailDna } from '@/ai/flows/video-teardown-flow';
import type { ResearchVideo } from '@/services/youtube';

interface ThumbnailDnaPanelProps {
  niche: string;
  videos: ResearchVideo[];
}

const SAMPLE_SIZE = 12;

/**
 * Reads the top outliers' thumbnails and states the visual rule they share.
 * Opt-in rather than automatic: vision calls are billed per image, so we don't
 * spend them on every filter change.
 */
export function ThumbnailDnaPanel({ niche, videos }: ThumbnailDnaPanelProps) {
  const [dna, setDna] = useState<ThumbnailDna | null>(null);
  const [loading, setLoading] = useState(false);

  const sample = videos.slice(0, SAMPLE_SIZE);

  const run = async () => {
    setLoading(true);
    try {
      const result = await getThumbnailDna({
        niche,
        thumbnails: sample.map(v => v.thumbnail),
        titles: sample.map(v => v.title),
      });
      setDna(result);
    } catch (e: any) {
      toast({ variant: 'destructive', title: 'Could not read the thumbnails', description: e?.message });
    } finally {
      setLoading(false);
    }
  };

  const copyPrompt = () => {
    if (!dna?.generationPrompt) return;
    navigator.clipboard.writeText(dna.generationPrompt);
    toast({ title: 'Prompt copied', description: 'Paste it into the Thumbnail Studio.' });
  };

  if (sample.length < 3) return null;

  return (
    <Card className="border-none bg-white p-6 shadow-sm space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <ImageIcon className="h-4 w-4 text-[#7B5CF0]" />
          <h2 className="text-sm font-bold">Thumbnail DNA</h2>
        </div>
        {!dna && (
          <Button onClick={run} disabled={loading} size="sm" className="h-8 gap-2 rounded-full text-xs font-bold">
            {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Wand2 className="h-3.5 w-3.5" />}
            Read the top {sample.length}
          </Button>
        )}
      </div>

      <div className="flex gap-1.5 overflow-x-auto pb-1">
        {sample.map(video => (
          <div key={video.id} className="relative h-12 w-20 shrink-0 overflow-hidden rounded">
            <Image src={video.thumbnail} alt="" fill className="object-cover" />
          </div>
        ))}
      </div>

      {!dna && !loading && (
        <p className="text-xs text-muted-foreground">
          Analyse what these {sample.length} thumbnails have in common, and get a rule you can design against.
        </p>
      )}

      {dna && (
        <div className="space-y-4 animate-in fade-in duration-300">
          <p className="rounded-xl bg-[#7B5CF0]/5 p-4 text-sm font-semibold text-slate-900">{dna.rule}</p>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">What they share</p>
              <ul className="space-y-1">
                {dna.observations.map((observation, i) => (
                  <li key={i} className="flex gap-2 text-xs text-slate-600">
                    <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-[#7B5CF0]" />
                    {observation}
                  </li>
                ))}
              </ul>
            </div>

            <div className="space-y-1.5">
              <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Design against this</p>
              <ul className="space-y-1">
                {dna.checklist.map((item, i) => (
                  <li key={i} className="flex gap-2 text-xs text-slate-600">
                    <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-emerald-500" />
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          </div>

          {dna.generationPrompt && (
            <div className="flex items-start justify-between gap-3 rounded-xl border border-dashed border-slate-200 p-3">
              <p className="text-xs italic text-slate-500">{dna.generationPrompt}</p>
              <Button variant="ghost" size="sm" onClick={copyPrompt} className="h-7 shrink-0 gap-1.5 text-xs">
                <Copy className="h-3 w-3" /> Copy
              </Button>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
