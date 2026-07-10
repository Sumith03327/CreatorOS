'use client';

/**
 * Trend Scout — an opportunity radar, not a chat.
 * Brief (niche + channel) → Activity Rail → a ranked board of ideas, each
 * showing its opportunity score, the real outlier video that proves the signal,
 * a saturation meter, and effort. Every idea must name its evidence.
 */

import { useState } from 'react';
import { Radar, Loader2, Copy, RotateCcw, TrendingUp, Youtube, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import type { BuiltinAgent } from '@/ai/agents/builtin-agents';
import type { TrendScoutResult } from '@/ai/agents/deliverables';
import { useAgentRun } from './useAgentRun';
import { WorkspaceHeader, PhaseStepper, ActivityRail, SectionLabel } from './shell';
import { WinningFormulaPanel, useWinningFormula } from './WinningFormula';
import { SendToMenu } from './SendToMenu';

const DARK_INPUT = 'bg-white/5 border-white/10 text-white placeholder:text-slate-500 focus-visible:ring-primary/40';

function compact(n: number): string {
  if (!Number.isFinite(n)) return '—';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}K`;
  return String(n);
}

function scoreTone(score: number) {
  if (score >= 8) return { ring: 'border-emerald-400/40', text: 'text-emerald-400', chip: 'bg-emerald-400/10 text-emerald-300 border-emerald-400/30', label: 'HIGH' };
  if (score >= 6) return { ring: 'border-amber-400/40', text: 'text-amber-400', chip: 'bg-amber-400/10 text-amber-300 border-amber-400/30', label: 'MED' };
  return { ring: 'border-slate-500/40', text: 'text-slate-400', chip: 'bg-white/5 text-slate-400 border-white/10', label: 'LOW' };
}

const SATURATION: Record<string, { bars: number; tone: string; label: string }> = {
  low: { bars: 1, tone: 'bg-emerald-400', label: 'wide open' },
  medium: { bars: 2, tone: 'bg-amber-400', label: 'competitive' },
  high: { bars: 3, tone: 'bg-red-400', label: 'saturated' },
};

function SaturationMeter({ level }: { level: string }) {
  const s = SATURATION[level] ?? SATURATION.medium;
  return (
    <div className="flex items-center gap-1.5">
      <div className="flex gap-0.5">
        {[1, 2, 3].map((i) => (
          <div key={i} className={cn('h-1.5 w-4 rounded-full', i <= s.bars ? s.tone : 'bg-white/10')} />
        ))}
      </div>
      <span className="text-[10px] text-slate-500">{s.label}</span>
    </div>
  );
}

/** The outlier that proves the idea: views far above the channel's subscriber base. */
function EvidenceRow({ e }: { e: NonNullable<TrendScoutResult['ideas'][number]['evidence']> }) {
  const ratio = e.subscribers > 0 ? e.views / e.subscribers : 0;
  const strong = ratio >= 3;
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
      <div className="flex items-start gap-2.5">
        <Youtube className="mt-0.5 h-4 w-4 shrink-0 text-red-500" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-medium text-slate-200">{e.videoTitle}</p>
          <p className="mt-0.5 text-[11px] text-slate-500">
            {e.channel} · {compact(e.views)} views · {compact(e.subscribers)} subs
          </p>
        </div>
        {ratio > 0 && (
          <span
            className={cn(
              'shrink-0 rounded-full border px-2 py-0.5 text-[9px] font-bold tabular-nums',
              strong ? 'border-emerald-400/30 bg-emerald-400/10 text-emerald-300' : 'border-white/10 bg-white/5 text-slate-400'
            )}
            title="Views ÷ subscribers. Above 3× means the topic carried it, not the audience."
          >
            {ratio.toFixed(1)}× outlier
          </span>
        )}
      </div>
    </div>
  );
}

export function TrendScoutWorkspace({ agent, onBack }: { agent: BuiltinAgent; onBack: () => void }) {
  const [niche, setNiche] = useState('');
  const [channel, setChannel] = useState('');
  const [timeframe, setTimeframe] = useState('month');
  const { run, reset, phase, statuses, result, error } = useAgentRun<TrendScoutResult>();
  const { items: formula, refresh: refreshFormula } = useWinningFormula(agent.evidence);

  const canRun = niche.trim().length > 2 && phase !== 'running';

  function start() {
    run({
      instructions: agent.instructions ?? '',
      userMessage:
        `Find content opportunities in the "${niche.trim()}" niche from the last ${timeframe}.` +
        (channel.trim() ? ` My channel: ${channel.trim()}.` : '') +
        ` Use your tools to ground every idea in a real video or gap you actually found.`,
      deliverable: 'trend-scout',
      formula,
      tools: agent.tools,
      skills: agent.skills,
      model: agent.model,
    });
  }

  function copy(text: string) {
    navigator.clipboard.writeText(text);
    toast({ title: 'Copied', description: text });
  }

  const ideas = [...(result?.ideas ?? [])].sort((a, b) => (b.score ?? 0) - (a.score ?? 0));

  return (
    <div className="max-w-5xl mx-auto space-y-6 py-2 animate-in fade-in">
      <WorkspaceHeader
        icon={agent.icon}
        gradient={agent.gradient}
        name={agent.name}
        category={agent.category}
        onBack={onBack}
        right={<PhaseStepper phase={phase} />}
      />

      {/* BRIEF */}
      <div className="cc-card p-6 space-y-5">
        <div className="grid md:grid-cols-3 gap-4">
          <div className="space-y-2">
            <Label className="text-slate-300">Niche</Label>
            <Input
              placeholder="e.g., beginner Python tutorials"
              value={niche}
              onChange={(e) => setNiche(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && canRun) start(); }}
              className={DARK_INPUT}
            />
          </div>
          <div className="space-y-2">
            <Label className="text-slate-300">Your channel <span className="text-slate-500 font-normal">(optional)</span></Label>
            <Input placeholder="@yourchannel" value={channel} onChange={(e) => setChannel(e.target.value)} className={DARK_INPUT} />
          </div>
          <div className="space-y-2">
            <Label className="text-slate-300">Timeframe</Label>
            <Select value={timeframe} onValueChange={setTimeframe}>
              <SelectTrigger className="bg-white/5 border-white/10 text-white"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="week">Past week</SelectItem>
                <SelectItem value="month">Past month</SelectItem>
                <SelectItem value="year">Past year</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="flex gap-2">
          <Button onClick={start} disabled={!canRun} className="gap-2 cc-glow">
            {phase === 'running' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Radar className="h-4 w-4" />}
            {phase === 'running' ? 'Scanning…' : 'Scan for opportunities'}
          </Button>
          {phase === 'done' && (
            <Button variant="outline" onClick={reset} className="gap-2 border-white/10 bg-white/5 text-slate-200 hover:bg-white/10 hover:text-white">
              <RotateCcw className="h-4 w-4" /> Start over
            </Button>
          )}
        </div>
      </div>

      {(agent.evidence?.length ?? 0) > 0 && phase !== 'done' && (
        <WinningFormulaPanel kinds={agent.evidence ?? []} items={formula} onChanged={refreshFormula} />
      )}

      {(phase === 'running' || statuses.length > 0) && <ActivityRail statuses={statuses} phase={phase} />}

      {error && <div className="cc-card border-destructive/30 p-4 text-sm text-red-300">{error}</div>}

      {/* RESULT — opportunity board */}
      {result && phase === 'done' && (
        <section className="space-y-4 animate-in fade-in slide-in-from-bottom-2">
          <div className="flex items-center justify-between">
            <SectionLabel accent="bg-emerald-400">Opportunity board</SectionLabel>
            <div className="flex items-center gap-3">
              <span className="text-[11px] font-mono text-slate-500">{ideas.length} ideas · ranked</span>
              <SendToMenu
                title={`Content opportunities — ${niche.trim() || 'my niche'}`}
                body={ideas
                  .map(
                    (i, n) =>
                      `${n + 1}. ${i.title}\n   Score: ${i.score}/10 | Saturation: ${i.saturation} | Effort: ${i.effort}\n   Signal: ${i.signal}\n   Why: ${i.why}` +
                      (i.evidence ? `\n   Evidence: "${i.evidence.videoTitle}" — ${i.evidence.channel} (${i.evidence.views} views / ${i.evidence.subscribers} subs)` : '')
                  )
                  .join('\n\n')}
              />
            </div>
          </div>

          {ideas.length === 0 && (
            <div className="cc-card p-8 text-center text-sm text-slate-500">No opportunities found. Try a broader niche.</div>
          )}

          <div className="grid md:grid-cols-2 gap-4">
            {ideas.map((idea, i) => {
              const tone = scoreTone(idea.score ?? 0);
              return (
                <div key={i} className={cn('cc-card cc-card-hover p-5 space-y-3 group', tone.ring)}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-baseline gap-2">
                      <span className={cn('text-2xl font-bold tabular-nums', tone.text)}>{(idea.score ?? 0).toFixed(1)}</span>
                      <span className={cn('rounded-full border px-2 py-0.5 text-[9px] font-bold tracking-wide', tone.chip)}>{tone.label}</span>
                    </div>
                    <button
                      onClick={() => copy(idea.title)}
                      className="h-8 w-8 shrink-0 rounded-lg bg-white/5 text-slate-400 opacity-0 group-hover:opacity-100 hover:text-white hover:bg-white/10 flex items-center justify-center transition-opacity"
                      title="Copy title"
                    >
                      <Copy className="h-3.5 w-3.5" />
                    </button>
                  </div>

                  <h4 className="text-sm font-semibold leading-snug text-white">{idea.title}</h4>

                  <div className="flex items-start gap-2 text-xs text-slate-400">
                    <TrendingUp className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-400" />
                    <span>{idea.signal}</span>
                  </div>

                  {idea.evidence ? (
                    <EvidenceRow e={idea.evidence} />
                  ) : (
                    <div className="flex items-center gap-2 rounded-xl border border-amber-400/20 bg-amber-400/5 p-2.5 text-[11px] text-amber-400/80">
                      <AlertCircle className="h-3.5 w-3.5 shrink-0" /> No verified video evidence for this one.
                    </div>
                  )}

                  <p className="text-xs leading-relaxed text-slate-400">{idea.why}</p>

                  <div className="flex items-center justify-between border-t border-white/10 pt-3">
                    <SaturationMeter level={idea.saturation} />
                    <span className="text-[10px] font-mono uppercase tracking-wider text-slate-500">
                      {idea.effort} effort
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}
