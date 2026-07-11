'use client';

/**
 * Video Repurposer — one video becomes four native deliverables, each of which
 * can be pushed to the real platform it belongs on.
 *
 * The distribution targets are deliberately per-pane rather than one global
 * "Send to": an X thread has no business being mailed to a list, and a
 * newsletter has no business being posted to LinkedIn. Each pane offers only
 * the targets that suit it (see `delivery-targets.ts` kinds).
 *
 * Note on X/Twitter: Composio has no managed OAuth for it, so we cannot offer a
 * one-click connect — the thread is copyable, and can be archived to a doc.
 */

import { useState } from 'react';
import { Loader2, Recycle, Copy, RotateCcw, Twitter, Linkedin, Mail, Clapperboard } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import type { BuiltinAgent } from '@/ai/agents/builtin-agents';
import type { RepurposeResult } from '@/ai/agents/deliverables';
import { useAgentRun } from './useAgentRun';
import { WorkspaceHeader, PhaseStepper, ActivityRail, SectionLabel } from './shell';
import { WinningFormulaPanel, useWinningFormula } from './WinningFormula';
import { SendToMenu } from '../SendToMenu';

const DARK_INPUT = 'bg-white/5 border-white/10 text-white placeholder:text-slate-500 focus-visible:ring-primary/40';

export function RepurposerWorkspace({ agent, onBack }: { agent: BuiltinAgent; onBack: () => void }) {
  const [video, setVideo] = useState('');
  const { run, reset, phase, statuses, result, error } = useAgentRun<RepurposeResult>();
  const { items: formula, refresh: refreshFormula } = useWinningFormula(agent.evidence);

  const canRun = video.trim().length > 3 && phase !== 'running';

  function start() {
    if (!canRun) return;
    run({
      instructions: agent.instructions ?? '',
      userMessage: `Repurpose this video into all four formats: ${video.trim()}`,
      deliverable: 'repurposer',
      formula,
      tools: agent.tools,
      skills: agent.skills,
      model: agent.model,
    });
  }

  function copy(text: string) {
    navigator.clipboard.writeText(text);
    toast({ title: 'Copied' });
  }

  const threadText = result?.thread?.join('\n\n') ?? '';

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

      <div className="cc-card p-6 space-y-5">
        <div className="space-y-2">
          <Label className="text-slate-300">Your video</Label>
          <Input
            placeholder="Paste a YouTube URL or video id…"
            value={video}
            onChange={(e) => setVideo(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && canRun) start(); }}
            className={DARK_INPUT}
          />
        </div>
        <div className="flex gap-2">
          <Button onClick={start} disabled={!canRun} className="gap-2 cc-glow">
            {phase === 'running' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Recycle className="h-4 w-4" />}
            {phase === 'running' ? 'Repurposing…' : 'Repurpose video'}
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

      {result && phase === 'done' && (
        <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2">
          {/* X / Twitter thread — no managed OAuth, so archive or copy only. */}
          <Pane
            icon={<Twitter className="h-4 w-4 text-sky-400" />}
            accent="bg-sky-400"
            title="X thread"
            note="X has no one-click connect — copy it, or archive it to a doc."
            onCopy={() => copy(threadText)}
            send={<SendToMenu variant="dark" label="Archive" kinds={['doc', 'file']} title="X thread" body={threadText} />}
          >
            <ol className="space-y-2">
              {result.thread?.map((post, i) => (
                <li key={i} className="rounded-lg border border-white/10 bg-white/5 p-3">
                  <div className="flex items-start justify-between gap-3">
                    <p className="text-sm leading-relaxed text-slate-200 whitespace-pre-wrap">{post}</p>
                    <span className={cn('shrink-0 text-micro font-mono tabular', post.length > 280 ? 'text-red-400' : 'text-slate-500')}>
                      {post.length}
                    </span>
                  </div>
                </li>
              ))}
            </ol>
          </Pane>

          <Pane
            icon={<Linkedin className="h-4 w-4 text-blue-400" />}
            accent="bg-blue-400"
            title="LinkedIn post"
            onCopy={() => copy(result.linkedin ?? '')}
            send={
              // Social targets ONLY. Including 'doc' here put Gmail under a button
              // labelled "Distribute", which conflates publishing with archiving —
              // if LinkedIn isn't connected the honest answer is no button, not a
              // silent offer to email yourself a copy.
              <SendToMenu
                variant="dark"
                label="Distribute"
                kinds={['social']}
                title="LinkedIn post"
                body={result.linkedin ?? ''}
              />
            }
          >
            <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-200">{result.linkedin}</p>
          </Pane>

          <Pane
            icon={<Mail className="h-4 w-4 text-amber-400" />}
            accent="bg-amber-400"
            title="Newsletter"
            onCopy={() => copy(`${result.newsletter?.subject}\n\n${result.newsletter?.body}`)}
            send={
              <SendToMenu
                variant="dark"
                label="Distribute"
                kinds={['email']}
                title={result.newsletter?.subject ?? 'Newsletter'}
                body={result.newsletter?.body ?? ''}
              />
            }
          >
            <p className="text-sm font-semibold text-white">{result.newsletter?.subject}</p>
            <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-slate-300">{result.newsletter?.body}</p>
          </Pane>

          <Pane
            icon={<Clapperboard className="h-4 w-4 text-fuchsia-400" />}
            accent="bg-fuchsia-400"
            title="Shorts scripts"
            onCopy={() =>
              copy((result.shorts ?? []).map((s, i) => `Short ${i + 1}\nHook: ${s.hook}\n\n${s.script}`).join('\n\n---\n\n'))
            }
            send={
              <SendToMenu
                variant="dark"
                label="Send to"
                kinds={['doc', 'task']}
                title="Shorts scripts"
                body={(result.shorts ?? []).map((s, i) => `Short ${i + 1}\nHook: ${s.hook}\n\n${s.script}`).join('\n\n---\n\n')}
              />
            }
          >
            <div className="grid gap-3 sm:grid-cols-2">
              {result.shorts?.map((s, i) => (
                <div key={i} className="rounded-lg border border-white/10 bg-white/5 p-3">
                  <p className="text-micro font-semibold uppercase tracking-wider text-fuchsia-300">Short {i + 1}</p>
                  <p className="mt-1.5 text-sm font-semibold text-white">“{s.hook}”</p>
                  <p className="mt-2 whitespace-pre-wrap text-xs leading-relaxed text-slate-400">{s.script}</p>
                </div>
              ))}
            </div>
          </Pane>
        </div>
      )}
    </div>
  );
}

function Pane({
  icon, accent, title, note, children, onCopy, send,
}: {
  icon: React.ReactNode;
  accent: string;
  title: string;
  note?: string;
  children: React.ReactNode;
  onCopy: () => void;
  send: React.ReactNode;
}) {
  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <SectionLabel accent={accent}>
          <span className="flex items-center gap-2">{icon} {title}</span>
        </SectionLabel>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={onCopy}
            className="gap-1.5 border-white/10 bg-white/5 text-slate-200 hover:bg-white/10 hover:text-white"
          >
            <Copy className="h-3.5 w-3.5" /> Copy
          </Button>
          {send}
        </div>
      </div>
      {note && <p className="text-micro text-slate-500">{note}</p>}
      <div className="cc-card p-5">{children}</div>
    </section>
  );
}
