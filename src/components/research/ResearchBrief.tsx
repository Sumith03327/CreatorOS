'use client';

import { useMemo, useState } from 'react';
import { Zap, Sparkles, Clock, Ruler, Loader2, Copy, Check, Gauge } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { toast } from '@/hooks/use-toast';
import {
  buildFormatBreakdown,
  buildUploadHeatmap,
  blockLabel,
  DAY_LABELS,
  toNum,
} from '@/lib/research-metrics';
import { scoreTitle, type TitleFormula } from '@/ai/flows/get-insane-insights-flow';
import type { ResearchVideo } from '@/services/youtube';

interface ResearchBriefProps {
  niche: string;
  videos: ResearchVideo[];
  trends: string[];
  formulas: TitleFormula[];
  loading: boolean;
}

/**
 * The one screen a creator can read in twenty seconds and act on: what to make,
 * how to title it, how long it should be, and when to publish it.
 *
 * Format and timing are derived client-side from `duration` and `publishedAt`,
 * which the search already returns — they cost no extra API calls.
 */
export function ResearchBrief({ niche, videos, trends, formulas, loading }: ResearchBriefProps) {
  const formats = useMemo(
    () =>
      buildFormatBreakdown(
        videos.map(v => ({
          duration: v.duration,
          outlierScore: v.outlierScore,
          views: toNum(v.viewCount),
        }))
      ),
    [videos]
  );

  const { slots, bestSlot } = useMemo(
    () => buildUploadHeatmap(videos.map(v => ({ publishedAt: v.publishedAt, outlierScore: v.outlierScore }))),
    [videos]
  );

  return (
    <TooltipProvider delayDuration={150}>
      <Card className="border-none shadow-sm bg-white p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold tracking-tight">The Brief</h2>
            <p className="text-xs text-muted-foreground">
              Everything below is read off the {videos.length} top outliers in {niche} — not from a model's memory.
            </p>
          </div>
          {loading && <Loader2 className="h-4 w-4 animate-spin text-primary" />}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Section icon={<Zap className="h-4 w-4 text-primary" />} title="What's working">
            {trends.length === 0 ? (
              <Empty>Not enough data yet.</Empty>
            ) : (
              <ul className="space-y-2">
                {trends.map((bullet, i) => (
                  <li key={i} className="flex gap-2 text-sm text-slate-700">
                    <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
                    {bullet}
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section icon={<Ruler className="h-4 w-4 text-[#264ADE]" />} title="Which length wins">
            {formats.length === 0 ? (
              <Empty>Not enough data yet.</Empty>
            ) : (
              <FormatBars formats={formats} />
            )}
          </Section>

          <Section icon={<Sparkles className="h-4 w-4 text-[#7B5CF0]" />} title="Title formulas">
            {formulas.length === 0 ? (
              <Empty>Not enough trending videos to spot a repeatable pattern.</Empty>
            ) : (
              <div className="space-y-3">
                {formulas.map((formula, i) => (
                  <FormulaRow key={i} formula={formula} />
                ))}
              </div>
            )}
          </Section>

          <Section icon={<Clock className="h-4 w-4 text-amber-600" />} title="When outliers publish">
            {slots.length === 0 ? (
              <Empty>Not enough data yet.</Empty>
            ) : (
              <div className="space-y-3">
                <UploadHeatmap slots={slots} />
                {bestSlot && (
                  <p className="text-xs text-slate-600">
                    Strongest slot:{' '}
                    <span className="font-bold text-slate-900">
                      {DAY_LABELS[bestSlot.day]} {blockLabel(bestSlot.block)}
                    </span>{' '}
                    <span className="text-slate-400">
                      ({bestSlot.count} outlier{bestSlot.count === 1 ? '' : 's'}, your local time)
                    </span>
                  </p>
                )}
              </div>
            )}
          </Section>
        </div>

        <TitleScorer niche={niche} formulas={formulas} videos={videos} />
      </Card>
    </TooltipProvider>
  );
}

// --- Pieces -----------------------------------------------------------------

function Section({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-3">
      <h3 className="flex items-center gap-2 text-sm font-bold">
        {icon}
        {title}
      </h3>
      {children}
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-muted-foreground">{children}</p>;
}

function FormatBars({ formats }: { formats: ReturnType<typeof buildFormatBreakdown> }) {
  const max = Math.max(...formats.map(f => f.medianOutlier), 1);
  return (
    <div className="space-y-2">
      {formats.map((format, i) => (
        <div key={format.bucket} className="space-y-1">
          <div className="flex items-center justify-between text-xs">
            <span className={cn('font-semibold', i === 0 ? 'text-slate-900' : 'text-slate-500')}>{format.label}</span>
            <span className="tabular-nums text-slate-400">
              {format.medianOutlier.toFixed(1)}x median · {format.count} videos
            </span>
          </div>
          <div className="h-2 rounded-full bg-slate-100">
            <div
              className={cn('h-2 rounded-full', i === 0 ? 'bg-[#264ADE]' : 'bg-slate-300')}
              style={{ width: `${Math.max(4, (format.medianOutlier / max) * 100)}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

function FormulaRow({ formula }: { formula: TitleFormula }) {
  const [copied, setCopied] = useState(false);

  const copy = () => {
    navigator.clipboard.writeText(formula.template);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="group rounded-lg border border-slate-100 bg-slate-50/60 p-3">
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-semibold text-slate-900">{formula.template}</p>
        <button
          onClick={copy}
          aria-label="Copy template"
          className="shrink-0 text-slate-400 opacity-0 transition group-hover:opacity-100 hover:text-slate-900"
        >
          {copied ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
        </button>
      </div>
      <p className="mt-1 text-xs italic text-slate-500">“{formula.example}”</p>
      <p className="mt-1 text-xs text-slate-400">{formula.why}</p>
    </div>
  );
}

function UploadHeatmap({ slots }: { slots: ReturnType<typeof buildUploadHeatmap>['slots'] }) {
  const byKey = new Map(slots.map(s => [`${s.day}:${s.block}`, s]));
  const max = Math.max(...slots.map(s => s.medianOutlier), 1);

  return (
    <div className="overflow-x-auto">
      <div className="inline-grid grid-cols-[auto_repeat(8,minmax(0,1fr))] gap-1">
        <span />
        {Array.from({ length: 8 }, (_, block) => (
          <span key={block} className="text-center text-[8px] font-bold uppercase text-slate-400">
            {block * 3}
          </span>
        ))}

        {DAY_LABELS.map((day, dayIndex) => (
          <FragmentRow key={day} day={day} dayIndex={dayIndex} byKey={byKey} max={max} />
        ))}
      </div>
    </div>
  );
}

function FragmentRow({
  day,
  dayIndex,
  byKey,
  max,
}: {
  day: string;
  dayIndex: number;
  byKey: Map<string, { count: number; medianOutlier: number }>;
  max: number;
}) {
  return (
    <>
      <span className="pr-1 text-[9px] font-bold uppercase leading-6 text-slate-400">{day}</span>
      {Array.from({ length: 8 }, (_, block) => {
        const slot = byKey.get(`${dayIndex}:${block}`);
        const intensity = slot ? Math.max(0.12, slot.medianOutlier / max) : 0;

        const cell = (
          <div
            className={cn('h-6 w-full rounded-sm', !slot && 'bg-slate-50')}
            style={slot ? { backgroundColor: `rgba(123, 92, 240, ${intensity})` } : undefined}
          />
        );

        if (!slot) return <div key={block}>{cell}</div>;

        return (
          <Tooltip key={block}>
            <TooltipTrigger asChild>
              <div className="cursor-default">{cell}</div>
            </TooltipTrigger>
            <TooltipContent>
              <p className="text-xs">
                {day} {blockLabel(block)} — {slot.count} outlier{slot.count === 1 ? '' : 's'},{' '}
                {slot.medianOutlier.toFixed(1)}x median
              </p>
            </TooltipContent>
          </Tooltip>
        );
      })}
    </>
  );
}

// --- Title scorer -----------------------------------------------------------

/**
 * Reading a title pattern and applying it are different acts. This grades the
 * creator's own draft against the titles currently winning in their niche.
 */
function TitleScorer({ niche, formulas, videos }: { niche: string; formulas: TitleFormula[]; videos: ResearchVideo[] }) {
  const [draft, setDraft] = useState('');
  const [scoring, setScoring] = useState(false);
  const [result, setResult] = useState<Awaited<ReturnType<typeof scoreTitle>> | null>(null);

  const canScore = draft.trim().length > 3 && videos.length > 0 && !scoring;

  const run = async () => {
    if (!canScore) return;
    setScoring(true);
    setResult(null);
    try {
      const scored = await scoreTitle({
        niche,
        title: draft.trim(),
        formulas,
        winningTitles: videos.slice(0, 12).map(v => v.title),
      });
      setResult(scored);
    } catch (e: any) {
      toast({ variant: 'destructive', title: 'Could not score that title', description: e?.message });
    } finally {
      setScoring(false);
    }
  };

  const scoreColor = !result
    ? ''
    : result.score >= 70
      ? 'text-emerald-600'
      : result.score >= 45
        ? 'text-amber-600'
        : 'text-rose-600';

  return (
    <div className="space-y-3 rounded-xl border border-dashed border-slate-200 p-4">
      <h3 className="flex items-center gap-2 text-sm font-bold">
        <Gauge className="h-4 w-4 text-emerald-600" />
        Score your title against what's winning
      </h3>

      <div className="flex gap-2">
        <Input
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && run()}
          placeholder={`Your draft title for a ${niche} video…`}
          className="h-9"
        />
        <Button onClick={run} disabled={!canScore} className="h-9 shrink-0 px-5 font-bold">
          {scoring ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Score'}
        </Button>
      </div>

      {result && (
        <div className="space-y-3 animate-in fade-in duration-300">
          <div className="flex items-baseline gap-3">
            <span className={cn('text-3xl font-bold tabular-nums', scoreColor)}>{result.score}</span>
            <span className="text-xs font-bold uppercase text-slate-400">/ 100</span>
            <p className="text-sm text-slate-600">{result.verdict}</p>
          </div>

          <div className="space-y-2">
            {result.suggestions.map((suggestion, i) => (
              <div key={i} className="flex items-center justify-between gap-3 rounded-lg bg-slate-50 px-3 py-2">
                <p className="text-sm text-slate-800">{suggestion}</p>
                <Badge
                  onClick={() => {
                    navigator.clipboard.writeText(suggestion);
                    toast({ title: 'Copied' });
                  }}
                  className="shrink-0 cursor-pointer border-none bg-white text-[9px] font-bold uppercase text-slate-500 hover:text-slate-900"
                >
                  Copy
                </Badge>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
