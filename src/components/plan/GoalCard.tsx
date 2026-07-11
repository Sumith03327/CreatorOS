'use client';

/**
 * The goal tracker. Its job is to be *right*, not encouraging.
 *
 * Every projection comes from the channel's own measured numbers, and when a
 * target is out of reach the card says so — and names which lever is wrong.
 * "You'd need 34 uploads a week" is far more useful than a progress bar that
 * implies everything is fine.
 */

import { useState } from 'react';
import { Target, Check, X, Pencil, TrendingUp, TrendingDown, Minus, Info } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { projectGoal, type Pace } from '@/lib/plan-progress';
import type { Goal, GoalMetric } from '@/lib/plan-store';
import type { MyChannel } from '@/lib/my-channel';
import type { ChannelMetrics } from '@/lib/channel-diagnosis';

const PACE_STYLE: Record<Pace, { chip: string; label: string; icon: typeof TrendingUp }> = {
  ahead: { chip: 'bg-emerald-100 text-emerald-700', label: 'Ahead of pace', icon: TrendingUp },
  'on-track': { chip: 'bg-emerald-100 text-emerald-700', label: 'On pace', icon: Minus },
  behind: { chip: 'bg-rose-100 text-rose-700', label: 'Behind pace', icon: TrendingDown },
  'too-early': { chip: 'bg-slate-100 text-slate-600', label: 'Too early to call', icon: Minus },
};

/** Default deadline: 90 days out — long enough to matter, short enough to feel real. */
function defaultDeadline(): string {
  const d = new Date(Date.now() + 90 * 86_400_000);
  return d.toISOString().slice(0, 10);
}

export function GoalCard({
  channel,
  metrics,
  goal,
  onSet,
  onClear,
}: {
  channel: MyChannel;
  metrics: ChannelMetrics;
  goal: Goal | null;
  onSet: (goal: Goal) => void;
  onClear: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [metric, setMetric] = useState<GoalMetric>(goal?.metric ?? 'subscribers');
  const [target, setTarget] = useState(goal ? String(goal.target) : '');
  const [deadline, setDeadline] = useState(goal?.deadline ?? defaultDeadline());

  function save() {
    const value = parseInt(target.replace(/[^0-9]/g, ''), 10);
    if (!value || !deadline) return;
    const current =
      metric === 'subscribers'
        ? parseInt(channel.subscriberCount || '0', 10) || 0
        : parseInt(channel.viewCount || '0', 10) || 0;
    onSet({
      metric,
      target: value,
      deadline,
      // Baseline is captured now, so progress later is real rather than assumed.
      startValue: goal && goal.metric === metric ? goal.startValue : current,
      startedAt: goal && goal.metric === metric ? goal.startedAt : new Date().toISOString(),
      channelId: channel.id,
    });
    setEditing(false);
  }

  if (!goal || editing) {
    return (
      <Card className="border-none shadow-sm">
        <CardContent className="p-5 space-y-4">
          <div className="flex items-center gap-2">
            <Target className="h-4 w-4 text-primary" />
            <h2 className="text-sm font-bold">{goal ? 'Edit your goal' : 'Set a goal'}</h2>
          </div>

          <div className="grid gap-3 sm:grid-cols-[1fr_1fr_1fr_auto]">
            <div className="space-y-1.5">
              <Label className="text-xs">Metric</Label>
              <Select value={metric} onValueChange={(v) => setMetric(v as GoalMetric)}>
                <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="subscribers">Subscribers</SelectItem>
                  <SelectItem value="views">Total views</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Target</Label>
              <Input
                className="h-9 tabular"
                inputMode="numeric"
                placeholder="100000"
                value={target}
                onChange={(e) => setTarget(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') save(); }}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">By</Label>
              <Input className="h-9" type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} />
            </div>
            <div className="flex items-end gap-1.5">
              <Button onClick={save} disabled={!target.trim()} size="sm" className="h-9 gap-1.5">
                <Check className="h-3.5 w-3.5" /> Save
              </Button>
              {goal && (
                <Button variant="ghost" size="sm" onClick={() => setEditing(false)} className="h-9">
                  <X className="h-3.5 w-3.5" />
                </Button>
              )}
            </div>
          </div>

          <p className="text-micro text-muted-foreground">
            We’ll project this from your real cadence and median views — and tell you plainly if it isn’t reachable.
          </p>
        </CardContent>
      </Card>
    );
  }

  const p = projectGoal(goal, channel, metrics);
  const pace = PACE_STYLE[p.pace];
  const PaceIcon = pace.icon;
  const pct = p.target > 0 ? Math.min(100, Math.max(0, (p.current / p.target) * 100)) : 0;

  // Colour follows the truth: green only when the arithmetic actually supports it.
  const bar =
    p.reachable === null ? 'bg-slate-400' : p.reachable ? 'bg-emerald-500' : 'bg-amber-500';

  return (
    <Card className="border-none shadow-sm">
      <CardContent className="p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Target className="h-4 w-4 text-primary" />
            <h2 className="text-sm font-bold">
              {p.target.toLocaleString()} {goal.metric} by {new Date(`${goal.deadline}T00:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}
            </h2>
            <span className={cn('flex items-center gap-1 rounded-full px-2 py-0.5 text-micro font-semibold uppercase tracking-wider', pace.chip)}>
              <PaceIcon className="h-2.5 w-2.5" /> {pace.label}
            </span>
          </div>
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="sm" onClick={() => setEditing(true)} className="h-8 gap-1.5 text-xs">
              <Pencil className="h-3 w-3" /> Edit
            </Button>
            <Button variant="ghost" size="sm" onClick={onClear} className="h-8 text-xs text-muted-foreground hover:text-destructive">
              Clear
            </Button>
          </div>
        </div>

        <div className="space-y-1.5">
          <div className="flex items-baseline justify-between text-xs">
            <span className="font-bold tabular text-foreground">{p.current.toLocaleString()}</span>
            <span className="text-muted-foreground tabular">
              {p.remaining.toLocaleString()} to go · {p.daysLeft} days left
            </span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
            <div className={cn('h-full rounded-full transition-[width] duration-700', bar)} style={{ width: `${pct}%` }} />
          </div>
        </div>

        <div
          className={cn(
            'rounded-xl p-3.5 text-sm leading-relaxed',
            p.reachable === true && 'bg-emerald-50 text-emerald-900',
            p.reachable === false && 'bg-amber-50 text-amber-900',
            p.reachable === null && 'bg-muted/60 text-foreground/80'
          )}
        >
          {p.verdict}
        </div>

        <p className="flex items-start gap-1.5 text-micro leading-relaxed text-muted-foreground">
          <Info className="mt-0.5 h-3 w-3 shrink-0" />
          <span>
            <span className="font-semibold text-foreground/70">How we got that: </span>
            {p.basis}
          </span>
        </p>
      </CardContent>
    </Card>
  );
}
