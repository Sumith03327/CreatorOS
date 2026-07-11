'use client';

/**
 * Title & Hook Doctor — a diagnostic clinic, not a chat.
 * Brief (title + niche) → Activity Rail → a scorecard with the 5 CTR levers,
 * rewrite cards tagged by the levers they pull, a YouTube truncation preview,
 * and an improved 10-second hook.
 */

import { useState, useEffect, useRef } from 'react';
import { Wand2, Loader2, Copy, RotateCcw, Target, Zap, BookmarkPlus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import type { BuiltinAgent } from '@/ai/agents/builtin-agents';
import type { TitleDoctorResult, Lever } from '@/ai/agents/deliverables';
import { useAgentRun } from './useAgentRun';
import { WorkspaceHeader, PhaseStepper, ActivityRail, SectionLabel } from './shell';
import { WinningFormulaPanel, useWinningFormula } from './WinningFormula';
import { SendToMenu } from '../SendToMenu';
import { TitleProjectPanel } from './TitleProjectPanel';
import * as titles from '@/lib/title-projects';
import type { TitleProject, TitleIdea } from '@/lib/title-projects';

const DARK_INPUT = 'bg-white/5 border-white/10 text-white placeholder:text-slate-500 focus-visible:ring-primary/40';

const LEVERS: Lever[] = ['curiosity', 'stakes', 'specificity', 'clarity', 'deliverability'];

/** YouTube truncates titles around 50 characters on mobile search. */
const TRUNCATE_AT = 50;

function scoreColor(score: number) {
  if (score >= 8) return { stroke: '#34d399', text: 'text-emerald-400' };
  if (score >= 6) return { stroke: '#fbbf24', text: 'text-amber-400' };
  return { stroke: '#f87171', text: 'text-red-400' };
}

function ScoreDial({ score }: { score: number }) {
  const r = 46;
  const c = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(10, score)) / 10;
  const { stroke, text } = scoreColor(score);
  return (
    <div className="relative h-32 w-32 shrink-0">
      <svg viewBox="0 0 110 110" className="h-full w-full -rotate-90">
        <circle cx="55" cy="55" r={r} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="8" />
        <circle
          cx="55"
          cy="55"
          r={r}
          fill="none"
          stroke={stroke}
          strokeWidth="8"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - pct)}
          style={{ transition: 'stroke-dashoffset 900ms cubic-bezier(0.4,0,0.2,1)' }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className={cn('text-3xl font-bold tabular-nums', text)}>{score}</span>
        <span className="text-[10px] font-mono uppercase tracking-wider text-slate-500">/ 10</span>
      </div>
    </div>
  );
}

function LeverBar({ name, value }: { name: string; value: number }) {
  const pct = (Math.max(0, Math.min(2, value)) / 2) * 100;
  const color = value === 2 ? 'bg-emerald-400' : value === 1 ? 'bg-amber-400' : 'bg-red-400/70';
  return (
    <div className="flex items-center gap-3">
      <span className="w-24 shrink-0 text-[11px] capitalize text-slate-400">{name}</span>
      <div className="h-1.5 flex-1 rounded-full bg-white/5 overflow-hidden">
        <div className={cn('h-full rounded-full transition-[width] duration-700', color)} style={{ width: `${pct}%` }} />
      </div>
      <span className="w-7 shrink-0 text-right text-[11px] font-mono tabular-nums text-slate-500">{value}/2</span>
    </div>
  );
}

/** Renders the title as a real YouTube search row, with the truncation fold drawn. */
function TruncationPreview({ title }: { title: string }) {
  const over = title.length > TRUNCATE_AT;
  const head = title.slice(0, TRUNCATE_AT);
  const tail = title.slice(TRUNCATE_AT);
  return (
    <div className="cc-card p-4 space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-[10px] font-mono uppercase tracking-widest text-slate-500">Mobile search preview</p>
        <span className={cn('text-[11px] font-mono tabular-nums', over ? 'text-amber-400' : 'text-emerald-400')}>
          {title.length} chars
        </span>
      </div>
      <div className="flex gap-3">
        <div className="h-16 w-28 shrink-0 rounded-lg bg-white/5 border border-white/10" />
        <div className="min-w-0">
          <p className="text-sm leading-snug text-white">
            {head}
            {over && <span className="text-slate-600">{tail}</span>}
          </p>
          <p className="mt-1 text-[11px] text-slate-500">Your Channel · 42K views · 2 days ago</p>
        </div>
      </div>
      {over && (
        <p className="text-[11px] text-amber-400/80">
          Everything after {TRUNCATE_AT} characters is cut on mobile. Front-load the hook word.
        </p>
      )}
    </div>
  );
}

export function TitleDoctorWorkspace({
  agent,
  onBack,
  initialTitle,
}: {
  agent: BuiltinAgent;
  onBack: () => void;
  /** Prefilled when arriving from a content idea on the Action Plan. */
  initialTitle?: string;
}) {
  const [title, setTitle] = useState(initialTitle ?? '');
  const [niche, setNiche] = useState('');
  const { run, reset, phase, statuses, result, error } = useAgentRun<TitleDoctorResult>();
  const { items: formula, refresh: refreshFormula } = useWinningFormula(agent.evidence);

  // Projects — a named bundle of candidate titles the creator keeps working on.
  const [projects, setProjects] = useState<TitleProject[]>([]);
  const [project, setProject] = useState<TitleProject | null>(null);
  const [inbox, setInbox] = useState<string[]>([]);
  /** Which idea the current run belongs to, so the score lands back on it. */
  const scoringIdeaRef = useRef<string | null>(null);

  useEffect(() => {
    setProjects(titles.listTitleProjects());
    setInbox(titles.peekInbox());
    return titles.subscribeToTitleProjects(() => setProjects(titles.listTitleProjects()));
  }, []);

  /**
   * When a run finishes, write the score back onto the idea it came from — that
   * persistence is the whole point of a project: come back tomorrow and see the
   * shortlist rather than re-running everything.
   */
  useEffect(() => {
    if (phase !== 'done' || !result || !project || !scoringIdeaRef.current) return;
    const updated = titles.updateIdea(project.id, scoringIdeaRef.current, {
      status: 'scored',
      score: result.score,
      verdict: result.verdict,
      rewrites: (result.rewrites ?? []).map((r) => r.title),
    });
    if (updated) setProject(updated);
    scoringIdeaRef.current = null;
  }, [phase, result, project?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const canRun = title.trim().length > 2 && phase !== 'running';

  function start(titleToScore = title) {
    if (!titleToScore.trim()) return;
    run({
      instructions: agent.instructions ?? '',
      userMessage:
        `Score and rewrite this title: "${titleToScore.trim()}".` +
        (niche.trim() ? ` The channel's niche is: ${niche.trim()}.` : ''),
      deliverable: 'title-doctor',
      formula,
      tools: agent.tools,
      skills: agent.skills,
      model: agent.model,
    });
  }

  /** Score an idea straight from the project, and remember where to put the score. */
  function scoreIdea(idea: TitleIdea) {
    scoringIdeaRef.current = idea.id;
    setTitle(idea.title);
    start(idea.title);
  }

  /** Keep a rewrite the Doctor produced — it becomes a new idea in the project. */
  function keepRewrite(rewrite: string) {
    if (!project) return;
    const updated = titles.addIdeas(project.id, [titles.makeIdea(rewrite, 'rewrite')]);
    if (updated) {
      setProject(updated);
      setProjects(titles.listTitleProjects());
      toast({ title: 'Saved to project', description: `Added to "${project.name}".` });
    }
  }

  function copy(text: string) {
    navigator.clipboard.writeText(text);
    toast({ title: 'Copied', description: text });
  }

  /** Re-score one of the suggested rewrites. */
  function scoreRewrite(t: string) {
    setTitle(t);
    start(t);
  }

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

      <TitleProjectPanel
        projects={projects}
        active={project}
        inbox={inbox}
        onSelect={(id) => setProject(id ? titles.getTitleProject(id) : null)}
        onChanged={(list, active) => { setProjects(list); setProject(active); }}
        onScore={scoreIdea}
        onDismissInbox={() => { titles.clearInbox(); setInbox([]); }}
      />

      {/* BRIEF */}
      <div className="cc-card p-6 space-y-5">
        <div className="grid md:grid-cols-[2fr_1fr] gap-4">
          <div className="space-y-2">
            <Label className="text-slate-300">Your title</Label>
            <Input
              placeholder="e.g., How did ancient humans travel the world?"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && canRun) start(); }}
              className={DARK_INPUT}
            />
          </div>
          <div className="space-y-2">
            <Label className="text-slate-300">Niche <span className="text-slate-500 font-normal">(optional)</span></Label>
            <Input
              placeholder="history explainers"
              value={niche}
              onChange={(e) => setNiche(e.target.value)}
              className={DARK_INPUT}
            />
          </div>
        </div>
        <div className="flex gap-2">
          <Button onClick={() => start()} disabled={!canRun} className="gap-2 cc-glow">
            {phase === 'running' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4" />}
            {phase === 'running' ? 'Diagnosing…' : 'Diagnose title'}
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

      {error && (
        <div className="cc-card border-destructive/30 p-4 text-sm text-red-300">{error}</div>
      )}

      {/* RESULT */}
      {result && phase === 'done' && (
        <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2">
          {/* Scorecard */}
          <div className="cc-card p-6">
            <div className="flex flex-col md:flex-row items-center gap-8">
              <ScoreDial score={result.score} />
              <div className="flex-1 w-full space-y-2.5">
                {LEVERS.map((l) => (
                  <LeverBar key={l} name={l} value={result.levers?.[l] ?? 0} />
                ))}
              </div>
            </div>
            {result.verdict && (
              <p className="mt-6 border-t border-white/10 pt-4 text-sm text-slate-300">{result.verdict}</p>
            )}
          </div>

          <TruncationPreview title={title} />

          {/* Rewrites */}
          <section className="space-y-4">
            <div className="flex items-center justify-between">
              <SectionLabel accent="bg-amber-400">Stronger rewrites</SectionLabel>
              <SendToMenu
                title={`Title options — ${title.slice(0, 60)}`}
                body={[
                  `Original: ${title}`,
                  `Score: ${result.score}/10`,
                  `Verdict: ${result.verdict}`,
                  '',
                  'Rewrites:',
                  ...(result.rewrites ?? []).map(
                    (r, n) => `${n + 1}. ${r.title}  [${(r.levers ?? []).join(', ')}]`
                  ),
                  ...(result.hook?.line ? ['', `Hook: ${result.hook.line}`] : []),
                ].join('\n')}
              />
            </div>
            <div className="grid gap-3">
              {result.rewrites?.map((r, i) => (
                <div key={i} className="cc-card cc-card-hover p-4 group">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-white leading-snug">{r.title}</p>
                      <div className="mt-2 flex flex-wrap items-center gap-1.5">
                        {r.levers?.map((lv) => (
                          <span key={lv} className="rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-primary">
                            {lv}
                          </span>
                        ))}
                        <span className={cn('ml-1 text-[10px] font-mono tabular-nums', r.title.length > TRUNCATE_AT ? 'text-amber-400/80' : 'text-slate-500')}>
                          {r.title.length} chars
                        </span>
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        onClick={() => copy(r.title)}
                        title="Copy"
                        className="h-8 w-8 rounded-lg bg-white/5 text-slate-400 hover:text-white hover:bg-white/10 flex items-center justify-center"
                      >
                        <Copy className="h-3.5 w-3.5" />
                      </button>
                      {/* A rewrite you like is only useful if you can keep it. */}
                      {project && (
                        <button
                          onClick={() => keepRewrite(r.title)}
                          title={`Save to "${project.name}"`}
                          className="h-8 w-8 rounded-lg bg-white/5 text-slate-400 hover:text-emerald-400 hover:bg-emerald-400/10 flex items-center justify-center"
                        >
                          <BookmarkPlus className="h-3.5 w-3.5" />
                        </button>
                      )}
                      <button
                        onClick={() => scoreRewrite(r.title)}
                        title="Score this one"
                        className="h-8 w-8 rounded-lg bg-white/5 text-slate-400 hover:text-primary hover:bg-primary/10 flex items-center justify-center"
                      >
                        <Target className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* Hook */}
          {result.hook?.line && (
            <section className="space-y-4">
              <SectionLabel accent="bg-fuchsia-400">Improved 10-second hook</SectionLabel>
              <div className="cc-card p-5">
                <div className="flex items-start gap-3">
                  <div className="mt-0.5 h-8 w-8 shrink-0 rounded-lg bg-fuchsia-500/15 border border-fuchsia-400/25 flex items-center justify-center">
                    <Zap className="h-4 w-4 text-fuchsia-300" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-white leading-relaxed">“{result.hook.line}”</p>
                    {result.hook.why && <p className="mt-2 text-xs text-slate-400">{result.hook.why}</p>}
                  </div>
                  <button
                    onClick={() => copy(result.hook!.line)}
                    className="h-8 w-8 shrink-0 rounded-lg bg-white/5 text-slate-400 hover:text-white hover:bg-white/10 flex items-center justify-center"
                  >
                    <Copy className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  );
}
