'use client';

/**
 * Shared furniture for every Agent Workspace, so the nine agents feel like one
 * product: a header, a phase stepper, and the Activity Rail that turns the
 * agent's skill loads and tool calls into visible proof of work.
 */

import {
  ChevronLeft,
  BookOpen,
  Search,
  Plug,
  Sparkles,
  Loader2,
  Check,
  type LucideIcon,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { RunPhase } from './useAgentRun';

export function WorkspaceHeader({
  icon: Icon,
  gradient,
  name,
  category,
  onBack,
  right,
}: {
  icon: LucideIcon;
  gradient: string;
  name: string;
  category: string;
  onBack: () => void;
  right?: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-4">
      <Button variant="ghost" size="icon" onClick={onBack} className="text-slate-300 hover:text-white hover:bg-white/5">
        <ChevronLeft className="h-5 w-5" />
      </Button>
      <div className={cn('h-11 w-11 rounded-2xl bg-gradient-to-br flex items-center justify-center shrink-0 cc-glow', gradient)}>
        <Icon className="h-5 w-5 text-white" />
      </div>
      <div>
        <h2 className="font-semibold text-lg text-white leading-tight">{name}</h2>
        <span className="text-[10px] font-mono uppercase tracking-wider text-slate-500">{category}</span>
      </div>
      <div className="ml-auto flex items-center gap-2">{right}</div>
    </div>
  );
}

/** Brief → Working → Result. Communicates that this is a process, not a chatbot. */
export function PhaseStepper({ phase }: { phase: RunPhase }) {
  const steps = [
    { key: 'brief', label: 'Brief' },
    { key: 'working', label: 'Working' },
    { key: 'result', label: 'Result' },
  ];
  const activeIndex = phase === 'idle' ? 0 : phase === 'running' ? 1 : 2;

  return (
    <div className="flex items-center gap-2">
      {steps.map((s, i) => {
        const done = i < activeIndex;
        const active = i === activeIndex;
        return (
          <div key={s.key} className="flex items-center gap-2">
            <div
              className={cn(
                'flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-mono uppercase tracking-wider transition-colors',
                done && 'border-emerald-400/30 bg-emerald-400/10 text-emerald-300',
                active && 'border-primary/40 bg-primary/10 text-primary',
                !done && !active && 'border-white/10 text-slate-500'
              )}
            >
              {done ? <Check className="h-3 w-3" /> : active && phase === 'running' ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
              {s.label}
            </div>
            {i < steps.length - 1 && <div className={cn('h-px w-5', done ? 'bg-emerald-400/40' : 'bg-white/10')} />}
          </div>
        );
      })}
    </div>
  );
}

/** Map a streamed status string onto an icon, so the trail reads at a glance. */
function statusIcon(status: string): LucideIcon {
  if (/loading skill/i.test(status)) return BookOpen;
  if (/acting via/i.test(status)) return Plug;
  if (/search|scan|read|studying|analy/i.test(status)) return Search;
  return Sparkles;
}

/**
 * The Activity Rail: every skill loaded and tool called, in order. This is the
 * agent showing its work — and it's what makes the run feel like a process
 * rather than a spinner.
 */
export function ActivityRail({ statuses, phase }: { statuses: string[]; phase: RunPhase }) {
  if (!statuses.length && phase !== 'running') return null;

  return (
    <div className="cc-card p-4">
      <p className="text-[10px] font-mono uppercase tracking-widest text-slate-500 mb-3">Activity</p>
      <ol className="space-y-2.5">
        {statuses.map((s, i) => {
          const Icon = statusIcon(s);
          const isLast = i === statuses.length - 1;
          const stillRunning = isLast && phase === 'running';
          return (
            <li key={i} className="flex items-start gap-2.5">
              <div
                className={cn(
                  'mt-0.5 h-6 w-6 shrink-0 rounded-lg flex items-center justify-center border',
                  stillRunning
                    ? 'border-primary/40 bg-primary/10 text-primary'
                    : 'border-emerald-400/25 bg-emerald-400/10 text-emerald-300'
                )}
              >
                {stillRunning ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Icon className="h-3.5 w-3.5" />}
              </div>
              <span className={cn('text-xs leading-6', stillRunning ? 'text-slate-200' : 'text-slate-400')}>
                {s.replace(/…$/, '')}
              </span>
            </li>
          );
        })}
        {phase === 'running' && statuses.length === 0 && (
          <li className="flex items-center gap-2.5 text-xs text-slate-400">
            <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" /> Thinking…
          </li>
        )}
      </ol>
    </div>
  );
}

export function SectionLabel({ children, accent = 'bg-primary' }: { children: React.ReactNode; accent?: string }) {
  return (
    <h3 className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-widest text-slate-400">
      <span className={cn('h-3 w-0.5 rounded', accent)} /> {children}
    </h3>
  );
}
