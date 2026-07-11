'use client';

/**
 * Content Calendar — the agent that OWNS the schedule.
 *
 * Before this, `calendar-planner` was a dead-end chat that would have emitted a
 * calendar as prose, while the real calendar lived on the Action Plan. Two
 * calendars, one of them strictly worse. Now there is one: the Action Plan
 * diagnoses the channel and generates the schedule, then hands off here, and
 * this is where the creator reads it, EDITS it, saves it, and ships it.
 *
 * The calendar is stored on the channel's latest plan record (plan-store), which
 * keeps a single source of truth and keeps the "did you actually ship it?" check
 * working — it compares the saved calendar against real uploads.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  CalendarDays, LayoutGrid, List, Loader2, Save, Plus, Trash2, Pencil, X, Check,
  Clapperboard, Film, Target, AlertCircle, ArrowRight,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import type { BuiltinAgent } from '@/ai/agents/builtin-agents';
import type { PlannedUpload, UploadGoal } from '@/ai/flows/generate-content-calendar';
import { WorkspaceHeader, SectionLabel } from './shell';
import { SendToMenu } from '../SendToMenu';
import { CalendarMonth } from '@/components/plan/CalendarMonth';
import { calendarDeliverable, uploadCard, dayLabel } from '@/lib/calendar-deliverables';
import { getMyChannel, type MyChannel } from '@/lib/my-channel';
import { latestPlan, updatePlan, type SavedPlan } from '@/lib/plan-store';

const DARK_INPUT = 'bg-white/5 border-white/10 text-white placeholder:text-slate-500 focus-visible:ring-primary/40';
const GOALS: UploadGoal[] = ['growth', 'retention', 'monetization', 'experiment'];

const GOAL_CHIP: Record<UploadGoal, string> = {
  growth: 'bg-primary/15 text-primary',
  retention: 'bg-emerald-400/15 text-emerald-300',
  monetization: 'bg-amber-400/15 text-amber-300',
  experiment: 'bg-fuchsia-400/15 text-fuchsia-300',
};

export function CalendarWorkspace({ agent, onBack }: { agent: BuiltinAgent; onBack: () => void }) {
  const [channel, setChannel] = useState<MyChannel | null>(null);
  const [plan, setPlan] = useState<SavedPlan | null>(null);
  const [uploads, setUploads] = useState<PlannedUpload[]>([]);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [view, setView] = useState<'month' | 'list'>('month');
  const [editing, setEditing] = useState<PlannedUpload | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const c = getMyChannel();
    setChannel(c);
    if (c) {
      const p = latestPlan(c.id);
      setPlan(p);
      setUploads(p?.calendar ? [...p.calendar] : []);
    }
    setLoaded(true);
  }, []);

  /** Edits are local until saved — a calendar that autosaves half an edit is worse. */
  const mutate = useCallback((next: PlannedUpload[]) => {
    setUploads(next);
    setDirty(true);
  }, []);

  function save() {
    if (!plan) return;
    setSaving(true);
    try {
      // Keep the schedule chronological however the creator reordered dates.
      const ordered = [...uploads]
        .sort((a, b) => (a.date === b.date ? a.hour - b.hour : a.date.localeCompare(b.date)))
        .map((u, i) => ({ ...u, index: i }));
      const updated = updatePlan(plan.id, { calendar: ordered });
      if (updated) {
        setPlan(updated);
        setUploads(ordered);
        setDirty(false);
        toast({ title: 'Calendar saved', description: `${ordered.length} uploads.` });
      }
    } finally {
      setSaving(false);
    }
  }

  function applyEdit(next: PlannedUpload) {
    mutate(uploads.map((u) => (u.index === next.index ? next : u)));
    setEditing(null);
  }

  function removeUpload(index: number) {
    mutate(uploads.filter((u) => u.index !== index));
    if (editing?.index === index) setEditing(null);
  }

  function addUpload() {
    // Slot the new upload a week after the last one, at the same hour — a sane
    // default the creator can immediately edit.
    const last = uploads[uploads.length - 1];
    const base = last ? new Date(`${last.date}T00:00:00`) : new Date();
    base.setDate(base.getDate() + (last ? 7 : 1));
    const date = `${base.getFullYear()}-${String(base.getMonth() + 1).padStart(2, '0')}-${String(base.getDate()).padStart(2, '0')}`;
    const fresh: PlannedUpload = {
      index: Math.max(-1, ...uploads.map((u) => u.index)) + 1,
      date,
      weekday: base.getDay(),
      hour: last?.hour ?? 10,
      format: 'long',
      week: last ? last.week + 1 : 0,
      title: 'New upload',
      hook: '',
      goal: 'growth',
      why: '',
    };
    mutate([...uploads, fresh]);
    setEditing(fresh);
  }

  const shorts = useMemo(() => uploads.filter((u) => u.format === 'short').length, [uploads]);

  const header = (
    <WorkspaceHeader
      icon={agent.icon}
      gradient={agent.gradient}
      name={agent.name}
      category={agent.category}
      onBack={onBack}
      right={
        dirty ? (
          <Button onClick={save} disabled={saving} size="sm" className="gap-1.5 cc-glow">
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
            Save changes
          </Button>
        ) : uploads.length > 0 ? (
          <span className="flex items-center gap-1.5 text-micro font-semibold uppercase tracking-wider text-emerald-400">
            <Check className="h-3 w-3" /> Saved
          </span>
        ) : undefined
      }
    />
  );

  if (!loaded) {
    return (
      <div className="max-w-5xl mx-auto space-y-6 py-2">
        {header}
        <div className="cc-card p-10 text-center text-sm text-slate-400">
          <Loader2 className="mx-auto h-5 w-5 animate-spin" />
        </div>
      </div>
    );
  }

  // Nothing to show — say exactly what to do, and link straight to it.
  if (!channel || !plan?.calendar?.length && !uploads.length) {
    return (
      <div className="max-w-5xl mx-auto space-y-6 py-2 animate-in fade-in">
        {header}
        <div className="cc-card p-10 text-center space-y-4">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10">
            <CalendarDays className="h-6 w-6 text-primary" />
          </div>
          <div className="space-y-1.5">
            <p className="text-base font-semibold text-white">No calendar yet</p>
            <p className="mx-auto max-w-md text-sm leading-relaxed text-slate-400">
              {channel
                ? 'Your Action Plan reads your real uploads and works out when you should publish. Build the schedule there, and it lands here to edit and ship.'
                : 'Connect your channel on the Action Plan first — the schedule is built from your real cadence and your own best-performing publish slot.'}
            </p>
          </div>
          <Button asChild className="gap-2 cc-glow">
            <Link href="/plan">
              {channel ? 'Plan the next 30 days' : 'Connect your channel'} <ArrowRight className="h-4 w-4" />
            </Link>
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto space-y-6 py-2 animate-in fade-in">
      {header}

      {/* Summary + the two things you do with a calendar: change it, or ship it. */}
      <div className="cc-card p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-white">
              {uploads.length} uploads · {uploads.length - shorts} long-form, {shorts} Shorts
            </p>
            <p className="mt-0.5 text-xs text-slate-400">
              {channel.title}
              {plan?.createdAt && ` · planned ${new Date(plan.createdAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}`}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="flex rounded-full border border-white/10 p-0.5">
              {(['month', 'list'] as const).map((v) => (
                <button
                  key={v}
                  onClick={() => setView(v)}
                  className={cn(
                    'flex items-center gap-1.5 rounded-full px-2.5 py-1 text-micro font-semibold uppercase tracking-wider transition-colors',
                    view === v ? 'bg-primary text-white' : 'text-slate-400 hover:text-white'
                  )}
                >
                  {v === 'month' ? <LayoutGrid className="h-3 w-3" /> : <List className="h-3 w-3" />}
                  {v}
                </button>
              ))}
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={addUpload}
              className="gap-1.5 border-white/10 bg-white/5 text-slate-200 hover:bg-white/10 hover:text-white"
            >
              <Plus className="h-3.5 w-3.5" /> Add upload
            </Button>
            <SendToMenu
              variant="dark"
              label="Add to calendar"
              kinds={['calendar', 'doc', 'sheet']}
              {...calendarDeliverable(uploads, channel.title)}
            />
          </div>
        </div>

        {dirty && (
          <p className="mt-3 flex items-center gap-1.5 text-micro text-amber-400">
            <AlertCircle className="h-3 w-3" /> Unsaved changes — they won’t persist until you save.
          </p>
        )}
      </div>

      {view === 'month' ? (
        <CalendarMonth uploads={uploads} dark onSelect={setEditing} selectedIndex={editing?.index} />
      ) : (
        <div className="space-y-2.5">
          {uploads.map((u) => (
            <div key={u.index} className="cc-card cc-card-hover group p-4">
              <div className="flex flex-wrap items-start gap-4">
                <div className="w-24 shrink-0">
                  <p className="text-sm font-bold text-white tabular">{dayLabel(u.date)}</p>
                  <p className="text-micro text-slate-500 tabular">{String(u.hour).padStart(2, '0')}:00</p>
                </div>

                <div className="min-w-0 flex-1 space-y-1.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={cn(
                      'flex items-center gap-1 rounded-full px-2 py-0.5 text-micro font-semibold uppercase tracking-wider',
                      u.format === 'short' ? 'bg-rose-400/15 text-rose-300' : 'bg-white/10 text-slate-300'
                    )}>
                      {u.format === 'short' ? <Clapperboard className="h-2.5 w-2.5" /> : <Film className="h-2.5 w-2.5" />}
                      {u.format === 'short' ? 'Short' : 'Long'}
                    </span>
                    <span className={cn('flex items-center gap-1 rounded-full px-2 py-0.5 text-micro font-semibold uppercase tracking-wider', GOAL_CHIP[u.goal])}>
                      <Target className="h-2.5 w-2.5" /> {u.goal}
                    </span>
                  </div>
                  <p className="text-sm font-semibold text-white">{u.title}</p>
                  {u.hook && (
                    <p className="text-xs leading-relaxed text-slate-400">
                      <span className="font-semibold text-slate-300">Hook: </span>{u.hook}
                    </p>
                  )}
                </div>

                <div className="flex shrink-0 items-center gap-1 self-center">
                  <SendToMenu
                    variant="dark"
                    label="Pipeline"
                    kinds={['task']}
                    title={u.title}
                    body={uploadCard(u)}
                  />
                  <button
                    onClick={() => setEditing(u)}
                    title="Edit"
                    className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/5 text-slate-400 hover:bg-white/10 hover:text-white"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                  <button
                    onClick={() => removeUpload(u.index)}
                    title="Remove"
                    className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/5 text-slate-400 hover:bg-white/10 hover:text-destructive"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {editing && (
        <EditPanel
          upload={editing}
          onCancel={() => setEditing(null)}
          onSave={applyEdit}
          onDelete={() => removeUpload(editing.index)}
        />
      )}
    </div>
  );
}

/** Inline editor — everything about one upload, changeable. */
function EditPanel({
  upload, onCancel, onSave, onDelete,
}: {
  upload: PlannedUpload;
  onCancel: () => void;
  onSave: (u: PlannedUpload) => void;
  onDelete: () => void;
}) {
  const [draft, setDraft] = useState<PlannedUpload>(upload);

  // Reopening on a different upload must reset the form, not keep the old one.
  useEffect(() => setDraft(upload), [upload.index]); // eslint-disable-line react-hooks/exhaustive-deps

  function commit() {
    const d = new Date(`${draft.date}T00:00:00`);
    onSave({
      ...draft,
      title: draft.title.trim() || 'Untitled upload',
      // The weekday must always agree with the date the creator picked.
      weekday: Number.isFinite(d.getTime()) ? d.getDay() : draft.weekday,
    });
  }

  return (
    <div className="cc-card space-y-4 p-5 border-primary/30 animate-in fade-in slide-in-from-bottom-2">
      <div className="flex items-center justify-between">
        <SectionLabel accent="bg-primary">Edit upload</SectionLabel>
        <button onClick={onCancel} className="text-slate-500 hover:text-white">
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="space-y-2">
        <Label className="text-slate-300">Title</Label>
        <Input
          autoFocus
          value={draft.title}
          onChange={(e) => setDraft({ ...draft, title: e.target.value })}
          onKeyDown={(e) => { if (e.key === 'Enter') commit(); }}
          className={DARK_INPUT}
        />
      </div>

      <div className="space-y-2">
        <Label className="text-slate-300">Hook <span className="font-normal text-slate-500">(the first 10 seconds)</span></Label>
        <Textarea
          value={draft.hook}
          onChange={(e) => setDraft({ ...draft, hook: e.target.value })}
          className={cn('min-h-[60px]', DARK_INPUT)}
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-4">
        <div className="space-y-2">
          <Label className="text-slate-300">Date</Label>
          <Input
            type="date"
            value={draft.date}
            onChange={(e) => setDraft({ ...draft, date: e.target.value })}
            className={DARK_INPUT}
          />
        </div>
        <div className="space-y-2">
          <Label className="text-slate-300">Hour</Label>
          <Select value={String(draft.hour)} onValueChange={(v) => setDraft({ ...draft, hour: parseInt(v, 10) })}>
            <SelectTrigger className="bg-white/5 border-white/10 text-white"><SelectValue /></SelectTrigger>
            <SelectContent className="max-h-64">
              {Array.from({ length: 24 }, (_, h) => (
                <SelectItem key={h} value={String(h)}>{String(h).padStart(2, '0')}:00</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label className="text-slate-300">Format</Label>
          <Select value={draft.format} onValueChange={(v) => setDraft({ ...draft, format: v as PlannedUpload['format'] })}>
            <SelectTrigger className="bg-white/5 border-white/10 text-white"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="long">Long-form</SelectItem>
              <SelectItem value="short">Short</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label className="text-slate-300">Goal</Label>
          <Select value={draft.goal} onValueChange={(v) => setDraft({ ...draft, goal: v as UploadGoal })}>
            <SelectTrigger className="bg-white/5 border-white/10 text-white"><SelectValue /></SelectTrigger>
            <SelectContent>
              {GOALS.map((g) => (
                <SelectItem key={g} value={g} className="capitalize">{g}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <Button onClick={commit} className="gap-1.5 cc-glow">
          <Check className="h-4 w-4" /> Apply
        </Button>
        <Button variant="outline" onClick={onCancel}
          className="border-white/10 bg-white/5 text-slate-200 hover:bg-white/10 hover:text-white">
          Cancel
        </Button>
        <button onClick={onDelete}
          className="ml-auto flex items-center gap-1.5 text-micro font-semibold text-slate-500 transition-colors hover:text-destructive">
          <Trash2 className="h-3.5 w-3.5" /> Remove this upload
        </button>
      </div>
    </div>
  );
}
