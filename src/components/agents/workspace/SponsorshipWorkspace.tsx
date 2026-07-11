'use client';

/**
 * Sponsorship Manager — a deal inbox + CRM, not a chat.
 * Reads real Gmail sponsorship emails through Composio, triages each into a
 * card with a scope checklist (which required terms the brand left out), and
 * offers a rate calculator anchored on median views x CPM.
 */

import { useMemo, useState } from 'react';
import { Loader2, RotateCcw, Mail, Check, X, Calculator, Inbox, Plug } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { cn } from '@/lib/utils';
import type { BuiltinAgent } from '@/ai/agents/builtin-agents';
import type { SponsorshipResult } from '@/ai/agents/deliverables';
import { useAgentRun } from './useAgentRun';
import { WorkspaceHeader, PhaseStepper, ActivityRail, SectionLabel } from './shell';
import { SendToMenu } from '../SendToMenu';

const DARK_INPUT = 'bg-white/5 border-white/10 text-white placeholder:text-slate-500 focus-visible:ring-primary/40';

/** The scope terms the sponsorship-negotiation skill says must be nailed down. */
const REQUIRED_TERMS = ['deliverable', 'usage rights', 'exclusivity', 'timeline', 'payment terms'];

function money(n: number) {
  return `$${Math.round(n).toLocaleString()}`;
}

/** Prices an integration on median views x CPM, with the skill's modifiers. */
function RateCalculator({ initialViews }: { initialViews: number }) {
  const [views, setViews] = useState(initialViews || 40000);
  const [cpm, setCpm] = useState(25);
  const [dedicated, setDedicated] = useState(false);
  const [usageRights, setUsageRights] = useState(false);
  const [exclusivity, setExclusivity] = useState(false);

  const { low, high } = useMemo(() => {
    let base = (views / 1000) * cpm;
    if (dedicated) base *= 3; // dedicated video: 2-4x an integration
    let lo = base;
    let hi = base;
    if (usageRights) { lo *= 1.3; hi *= 2.0; }
    if (exclusivity) { lo *= 1.2; hi *= 1.5; }
    return { low: lo, high: Math.max(hi, lo * 1.2) };
  }, [views, cpm, dedicated, usageRights, exclusivity]);

  const Toggle = ({ on, set, label }: { on: boolean; set: (v: boolean) => void; label: string }) => (
    <button
      onClick={() => set(!on)}
      className={cn(
        'rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors',
        on ? 'border-primary/40 bg-primary/15 text-primary' : 'border-white/10 bg-white/5 text-slate-400 hover:text-white'
      )}
    >
      {label}
    </button>
  );

  return (
    <div className="cc-card p-5 space-y-4">
      <div className="flex items-center gap-2">
        <Calculator className="h-4 w-4 text-primary" />
        <p className="text-sm font-semibold text-white">Rate calculator</p>
      </div>

      <div className="grid sm:grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label className="text-[11px] text-slate-400">Median views (last 10 videos)</Label>
          <Input
            type="number"
            value={views}
            onChange={(e) => setViews(Math.max(0, Number(e.target.value) || 0))}
            className={DARK_INPUT}
          />
        </div>
        <div className="space-y-2">
          <Label className="text-[11px] text-slate-400">CPM · {money(cpm)} per 1,000 views</Label>
          <Slider value={[cpm]} onValueChange={([v]) => setCpm(v)} min={5} max={60} step={1} className="pt-3" />
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <Toggle on={dedicated} set={setDedicated} label="Dedicated video (3×)" />
        <Toggle on={usageRights} set={setUsageRights} label="Usage rights" />
        <Toggle on={exclusivity} set={setExclusivity} label="Exclusivity" />
      </div>

      <div className="rounded-xl border border-emerald-400/25 bg-emerald-400/5 p-4">
        <p className="text-[10px] font-mono uppercase tracking-widest text-emerald-400/70">Suggested range</p>
        <p className="mt-1 text-2xl font-bold tabular-nums text-emerald-300">
          {money(low)} <span className="text-slate-500">–</span> {money(high)}
        </p>
        <p className="mt-1 text-[11px] text-slate-500">
          Priced on views, never subscribers. Never open with a discount.
        </p>
      </div>
    </div>
  );
}

function DealCard({ deal }: { deal: SponsorshipResult['deals'][number] }) {
  const missing = new Set((deal.missing ?? []).map((m) => m.toLowerCase()));
  const gaps = REQUIRED_TERMS.filter((t) => missing.has(t)).length;

  return (
    <div className="cc-card cc-card-hover p-5 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h4 className="font-semibold text-white">{deal.brand}</h4>
          {deal.from && <p className="truncate text-[11px] text-slate-500">{deal.from}</p>}
        </div>
        {gaps > 0 && (
          <span className="shrink-0 rounded-full border border-red-400/30 bg-red-400/10 px-2 py-0.5 text-[9px] font-bold text-red-300">
            {gaps} gap{gaps > 1 ? 's' : ''}
          </span>
        )}
      </div>

      <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-slate-400">
        {deal.offer && <span><span className="text-slate-500">Offer:</span> {deal.offer}</span>}
        {deal.deliverable && <span><span className="text-slate-500">Deliverable:</span> {deal.deliverable}</span>}
        {deal.deadline && <span><span className="text-slate-500">Deadline:</span> {deal.deadline}</span>}
      </div>

      <p className="text-xs leading-relaxed text-slate-400">{deal.summary}</p>

      {/* Scope checklist — what the brand did and didn't specify */}
      <div className="space-y-1.5 border-t border-white/10 pt-3">
        <p className="text-[10px] font-mono uppercase tracking-widest text-slate-500">Scope</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-1">
          {REQUIRED_TERMS.map((term) => {
            const absent = missing.has(term);
            return (
              <div key={term} className="flex items-center gap-1.5">
                {absent ? <X className="h-3 w-3 shrink-0 text-red-400" /> : <Check className="h-3 w-3 shrink-0 text-emerald-400" />}
                <span className={cn('text-[11px] capitalize', absent ? 'text-red-300/80' : 'text-slate-400')}>{term}</span>
              </div>
            );
          })}
        </div>
        {gaps > 0 && (
          <p className="pt-1 text-[11px] text-amber-400/80">Reply with questions before quoting a price.</p>
        )}
      </div>
    </div>
  );
}

export function SponsorshipWorkspace({ agent, onBack }: { agent: BuiltinAgent; onBack: () => void }) {
  const [query, setQuery] = useState('sponsorship OR "brand deal" OR collaboration');
  const { run, reset, phase, statuses, result, error } = useAgentRun<SponsorshipResult>();

  const canRun = phase !== 'running';

  function start() {
    run({
      instructions: agent.instructions ?? '',
      userMessage:
        `Search my Gmail for sponsorship / brand-deal emails matching: ${query.trim()}. ` +
        `Triage each one: brand, offer, deliverable, deadline, and which required scope terms they did NOT specify.`,
      deliverable: 'sponsorship-manager',
      tools: agent.tools,
      connectors: agent.connectors,
      skills: agent.skills,
      model: agent.model,
    });
  }

  const deals = result?.deals ?? [];

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
        <div className="space-y-2">
          <Label className="text-slate-300">Search your inbox</Label>
          <div className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3">
            <Mail className="h-4 w-4 shrink-0 text-cyan-400" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && canRun) start(); }}
              className="border-none bg-transparent shadow-none focus-visible:ring-0 px-0 text-white placeholder:text-slate-500"
            />
          </div>
          <p className="flex items-center gap-1.5 text-[11px] text-slate-500">
            <Plug className="h-3 w-3" /> Reads your real Gmail via Composio. Connect Gmail first if you haven’t.
          </p>
        </div>
        <div className="flex gap-2">
          <Button onClick={start} disabled={!canRun} className="gap-2 cc-glow">
            {phase === 'running' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Inbox className="h-4 w-4" />}
            {phase === 'running' ? 'Reading inbox…' : 'Triage my deals'}
          </Button>
          {phase === 'done' && (
            <Button variant="outline" onClick={reset} className="gap-2 border-white/10 bg-white/5 text-slate-200 hover:bg-white/10 hover:text-white">
              <RotateCcw className="h-4 w-4" /> Start over
            </Button>
          )}
        </div>
      </div>

      {(phase === 'running' || statuses.length > 0) && <ActivityRail statuses={statuses} phase={phase} />}

      {error && <div className="cc-card border-destructive/30 p-4 text-sm text-red-300">{error}</div>}

      {/* RESULT */}
      {result && phase === 'done' && (
        <div className="grid lg:grid-cols-[1.4fr_1fr] gap-6 animate-in fade-in slide-in-from-bottom-2">
          <section className="space-y-4">
            <div className="flex items-center justify-between">
              <SectionLabel accent="bg-cyan-400">Deal inbox</SectionLabel>
              <div className="flex items-center gap-3">
                <span className="text-[11px] font-mono text-slate-500">{deals.length} deal{deals.length === 1 ? '' : 's'}</span>
                {deals.length > 0 && (
                  <SendToMenu
                    title="Sponsorship pipeline"
                    body={deals
                      .map((d) =>
                        [
                          `Brand: ${d.brand}`,
                          `From: ${d.from ?? '-'}`,
                          `Offer: ${d.offer ?? '-'}`,
                          `Deliverable: ${d.deliverable ?? '-'}`,
                          `Deadline: ${d.deadline ?? '-'}`,
                          `Missing terms: ${(d.missing ?? []).join(', ') || 'none'}`,
                          `Summary: ${d.summary}`,
                        ].join('\n')
                      )
                      .join('\n\n')}
                  />
                )}
              </div>
            </div>
            {deals.length === 0 ? (
              <div className="cc-card p-8 text-center text-sm text-slate-500">
                No sponsorship emails found. Try a different search, or connect Gmail in Connections.
              </div>
            ) : (
              <div className="space-y-4">
                {deals.map((d, i) => <DealCard key={i} deal={d} />)}
              </div>
            )}
          </section>

          <aside className="space-y-4">
            <SectionLabel accent="bg-emerald-400">Pricing</SectionLabel>
            <RateCalculator initialViews={result.rate?.medianViews ?? 0} />
          </aside>
        </div>
      )}
    </div>
  );
}
