'use client';

/**
 * SEO Optimizer — a YouTube upload-page simulator.
 * Brief (video URL) → Activity Rail → the description rendered exactly as
 * YouTube shows it (with the "Show more" fold drawn), a chapter validator that
 * flags chapters the agent could NOT verify against the real transcript, tag
 * chips, and a pinned-comment composer.
 */

import { useState } from 'react';
import { Loader2, Copy, RotateCcw, Search, Check, AlertTriangle, MessageSquare, Youtube } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import type { BuiltinAgent } from '@/ai/agents/builtin-agents';
import type { SeoResult } from '@/ai/agents/deliverables';
import { useAgentRun } from './useAgentRun';
import { WorkspaceHeader, PhaseStepper, ActivityRail, SectionLabel } from './shell';
import { WinningFormulaPanel, useWinningFormula } from './WinningFormula';
import { SendToMenu } from '../SendToMenu';

const DARK_INPUT = 'bg-white/5 border-white/10 text-white placeholder:text-slate-500 focus-visible:ring-primary/40';

/** YouTube collapses the description after roughly the first two lines. */
const SNIPPET_CHARS = 150;

function CopyButton({ text, label = 'Copy' }: { text: string; label?: string }) {
  return (
    <button
      onClick={() => {
        navigator.clipboard.writeText(text);
        toast({ title: 'Copied', description: label });
      }}
      className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] text-slate-300 hover:bg-white/10 hover:text-white"
    >
      <Copy className="h-3 w-3" /> Copy
    </button>
  );
}

/** The description as YouTube actually renders it: a snippet, then the fold. */
function DescriptionPreview({ description }: { description: string }) {
  const snippet = description.slice(0, SNIPPET_CHARS);
  const rest = description.slice(SNIPPET_CHARS);
  return (
    <div className="cc-card p-5 space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-[10px] font-mono uppercase tracking-widest text-slate-500">Upload page preview</p>
        <CopyButton text={description} label="Description" />
      </div>
      <div className="rounded-xl border border-white/10 bg-black/20 p-4">
        <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-200">{snippet}</p>
        {rest && (
          <>
            <div className="my-3 flex items-center gap-2">
              <div className="h-px flex-1 border-t border-dashed border-white/15" />
              <span className="text-[10px] font-medium uppercase tracking-wider text-slate-500">Show more</span>
              <div className="h-px flex-1 border-t border-dashed border-white/15" />
            </div>
            <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-500">{rest}</p>
          </>
        )}
      </div>
      <p className="text-[11px] text-slate-500">
        Only the first ~{SNIPPET_CHARS} characters show before the fold. Make them earn the click.
      </p>
    </div>
  );
}

/**
 * The trust feature: the agent marks each chapter `verified` only if it found
 * the topic in the real transcript. Unverified chapters get flagged, because
 * inventing a chapter breaks viewer trust and spikes drop-off there.
 */
function ChapterValidator({ chapters }: { chapters: SeoResult['chapters'] }) {
  const unverified = chapters.filter((c) => !c.verified).length;
  const asText = chapters.map((c) => `${c.time} ${c.label}`).join('\n');

  return (
    <div className="cc-card p-5 space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-[10px] font-mono uppercase tracking-widest text-slate-500">Chapters · validated against transcript</p>
        <CopyButton text={asText} label="Chapters" />
      </div>

      <ul className="space-y-1.5">
        {chapters.map((c, i) => (
          <li
            key={i}
            className={cn(
              'flex items-center gap-3 rounded-lg border px-3 py-2',
              c.verified ? 'border-white/10 bg-white/[0.03]' : 'border-amber-400/30 bg-amber-400/5'
            )}
          >
            <span className="w-12 shrink-0 font-mono text-xs tabular-nums text-slate-400">{c.time}</span>
            <span className="min-w-0 flex-1 truncate text-sm text-slate-200">{c.label}</span>
            {c.verified ? (
              <span className="flex shrink-0 items-center gap-1 text-[10px] font-medium text-emerald-400">
                <Check className="h-3 w-3" /> in transcript
              </span>
            ) : (
              <span className="flex shrink-0 items-center gap-1 text-[10px] font-medium text-amber-400">
                <AlertTriangle className="h-3 w-3" /> unverified
              </span>
            )}
          </li>
        ))}
      </ul>

      {unverified > 0 && (
        <p className="text-[11px] text-amber-400/80">
          {unverified} chapter{unverified > 1 ? 's' : ''} couldn’t be confirmed in the transcript. Check {unverified > 1 ? 'them' : 'it'} before publishing — a chapter that doesn’t exist spikes drop-off.
        </p>
      )}
    </div>
  );
}

export function SeoOptimizerWorkspace({ agent, onBack }: { agent: BuiltinAgent; onBack: () => void }) {
  const [video, setVideo] = useState('');
  const { run, reset, phase, statuses, result, error } = useAgentRun<SeoResult>();
  const { items: formula, refresh: refreshFormula } = useWinningFormula(agent.evidence);

  const canRun = video.trim().length > 5 && phase !== 'running';

  function start() {
    run({
      instructions: agent.instructions ?? '',
      userMessage: `Optimise this video for YouTube search: ${video.trim()}. Read the transcript and build the full upload package.`,
      deliverable: 'seo-optimizer',
      formula,
      tools: agent.tools,
      skills: agent.skills,
      model: agent.model,
    });
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6 py-2 animate-in fade-in">
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
          <Label className="text-slate-300">Your video</Label>
          <div className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3">
            <Youtube className="h-4 w-4 shrink-0 text-red-500" />
            <Input
              placeholder="https://youtube.com/watch?v=…"
              value={video}
              onChange={(e) => setVideo(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && canRun) start(); }}
              className="border-none bg-transparent shadow-none focus-visible:ring-0 px-0 text-white placeholder:text-slate-500"
            />
          </div>
          <p className="text-[11px] text-slate-500">The agent reads the real transcript — chapters are validated against it.</p>
        </div>
        <div className="flex gap-2">
          <Button onClick={start} disabled={!canRun} className="gap-2 cc-glow">
            {phase === 'running' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
            {phase === 'running' ? 'Optimising…' : 'Build upload package'}
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

      {/* RESULT */}
      {result && phase === 'done' && (
        <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2">
          <div className="flex items-center justify-between">
            <SectionLabel accent="bg-lime-400">Upload package</SectionLabel>
            <SendToMenu
              title="YouTube upload package"
              body={[
                'DESCRIPTION\n' + (result.description ?? ''),
                'CHAPTERS\n' + (result.chapters ?? []).map((c) => `${c.time} ${c.label}${c.verified ? '' : '  (unverified)'}`).join('\n'),
                'TAGS\n' + (result.tags ?? []).join(', '),
                'PINNED COMMENT\n' + (result.pinnedComment ?? ''),
              ].join('\n\n')}
            />
          </div>

          {result.description && <DescriptionPreview description={result.description} />}

          {result.chapters?.length > 0 && <ChapterValidator chapters={result.chapters} />}

          {result.tags?.length > 0 && (
            <section className="space-y-3">
              <div className="flex items-center justify-between">
                <SectionLabel accent="bg-lime-400">Tags</SectionLabel>
                <CopyButton text={result.tags.join(', ')} label="All tags" />
              </div>
              <div className="cc-card p-4">
                <div className="flex flex-wrap gap-2">
                  {result.tags.map((t, i) => (
                    <span key={i} className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] text-slate-300">
                      {t}
                    </span>
                  ))}
                </div>
              </div>
            </section>
          )}

          {result.pinnedComment && (
            <section className="space-y-3">
              <SectionLabel accent="bg-sky-400">Pinned comment</SectionLabel>
              <div className="cc-card p-5">
                <div className="flex items-start gap-3">
                  <div className="mt-0.5 h-8 w-8 shrink-0 rounded-lg border border-sky-400/25 bg-sky-500/15 flex items-center justify-center">
                    <MessageSquare className="h-4 w-4 text-sky-300" />
                  </div>
                  <p className="min-w-0 flex-1 text-sm leading-relaxed text-slate-200">{result.pinnedComment}</p>
                  <CopyButton text={result.pinnedComment} label="Pinned comment" />
                </div>
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  );
}
