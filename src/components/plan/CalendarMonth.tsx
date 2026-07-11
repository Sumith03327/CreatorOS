'use client';

/**
 * The month grid — the calendar a creator actually pictures in their head.
 *
 * The list view is better for reading detail top-to-bottom; the grid is better
 * for seeing *shape*: the clumps, the dead weeks, whether Shorts and long-form
 * are alternating or piling up. Both are kept, and the toggle sits next to them.
 *
 * The grid spans whatever months the plan touches (a 30-day plan almost always
 * crosses a month boundary), so nothing is ever hidden behind a "next month"
 * click the user has to discover.
 */

import { useMemo, useState } from 'react';
import { Clapperboard, Film, Target } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { PlannedUpload, UploadGoal } from '@/ai/flows/generate-content-calendar';

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

const GOAL_DOT: Record<UploadGoal, string> = {
  growth: 'bg-primary',
  retention: 'bg-emerald-500',
  monetization: 'bg-amber-500',
  experiment: 'bg-fuchsia-500',
};

/** Monday-first index for a JS day (0=Sun). */
const mondayIndex = (jsDay: number) => (jsDay + 6) % 7;

interface Cell {
  date: Date | null;
  key: string;
  uploads: PlannedUpload[];
}

function buildMonths(uploads: PlannedUpload[]): { label: string; cells: Cell[] }[] {
  if (!uploads.length) return [];

  const byDate = new Map<string, PlannedUpload[]>();
  for (const u of uploads) {
    const list = byDate.get(u.date) ?? [];
    list.push(u);
    byDate.set(u.date, list);
  }

  const dates = uploads.map((u) => new Date(`${u.date}T00:00:00`));
  const first = new Date(Math.min(...dates.map((d) => d.getTime())));
  const last = new Date(Math.max(...dates.map((d) => d.getTime())));

  const months: { label: string; cells: Cell[] }[] = [];
  const cursor = new Date(first.getFullYear(), first.getMonth(), 1);

  while (cursor <= last) {
    const year = cursor.getFullYear();
    const month = cursor.getMonth();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const lead = mondayIndex(new Date(year, month, 1).getDay());

    const cells: Cell[] = [];
    // Blank leading cells so the 1st lands under the right weekday.
    for (let i = 0; i < lead; i++) cells.push({ date: null, key: `${year}-${month}-lead-${i}`, uploads: [] });
    for (let d = 1; d <= daysInMonth; d++) {
      const date = new Date(year, month, d);
      const iso = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      cells.push({ date, key: iso, uploads: byDate.get(iso) ?? [] });
    }
    // Trailing blanks to complete the final week row.
    while (cells.length % 7 !== 0) cells.push({ date: null, key: `${year}-${month}-tail-${cells.length}`, uploads: [] });

    months.push({
      label: cursor.toLocaleDateString(undefined, { month: 'long', year: 'numeric' }),
      cells,
    });
    cursor.setMonth(cursor.getMonth() + 1);
  }

  return months;
}

export function CalendarMonth({
  uploads,
  onSelect,
  dark,
  selectedIndex,
}: {
  uploads: PlannedUpload[];
  onSelect?: (upload: PlannedUpload) => void;
  /** The agent workspaces are the dark Command Center; the dashboard is light. */
  dark?: boolean;
  /** Highlight the upload currently open in the editor. */
  selectedIndex?: number;
}) {
  const months = useMemo(() => buildMonths(uploads), [uploads]);
  const [openKey, setOpenKey] = useState<string | null>(null);

  const todayIso = useMemo(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }, []);

  if (!months.length) return null;

  return (
    <div className="space-y-6">
      {months.map((m) => (
        <div key={m.label} className="space-y-2">
          <p className={cn('text-sm font-bold tracking-tight', dark && 'text-white')}>{m.label}</p>

          <div className={cn('overflow-hidden rounded-xl border', dark ? 'border-white/10 bg-white/[0.02]' : 'bg-card')}>
            <div className={cn('grid grid-cols-7 border-b', dark ? 'border-white/10 bg-white/[0.03]' : 'bg-muted/40')}>
              {WEEKDAYS.map((d) => (
                <div key={d} className="px-2 py-1.5 text-center">
                  <span className={cn('label-caps', dark && 'text-slate-500')}>{d}</span>
                </div>
              ))}
            </div>

            <div className="grid grid-cols-7">
              {m.cells.map((cell) => {
                const isToday = cell.key === todayIso;
                const has = cell.uploads.length > 0;
                return (
                  <div
                    key={cell.key}
                    className={cn(
                      'min-h-[92px] border-b border-r p-1.5 last:border-r-0',
                      dark && 'border-white/10',
                      !cell.date && (dark ? 'bg-black/20' : 'bg-muted/20'),
                      has && 'bg-primary/[0.06]'
                    )}
                  >
                    {cell.date && (
                      <>
                        <div className="mb-1 flex justify-end">
                          <span
                            className={cn(
                              'flex h-5 w-5 items-center justify-center rounded-full text-micro font-semibold tabular',
                              isToday
                                ? 'bg-primary text-primary-foreground'
                                : dark ? 'text-slate-500' : 'text-muted-foreground'
                            )}
                          >
                            {cell.date.getDate()}
                          </span>
                        </div>

                        <div className="space-y-1">
                          {cell.uploads.map((u) => {
                            const open = openKey === `${cell.key}:${u.index}` || selectedIndex === u.index;
                            return (
                              <button
                                key={u.index}
                                onClick={() => {
                                  setOpenKey(open ? null : `${cell.key}:${u.index}`);
                                  onSelect?.(u);
                                }}
                                className={cn(
                                  'w-full rounded-md border px-1.5 py-1 text-left transition-colors',
                                  dark
                                    ? u.format === 'short'
                                      ? 'border-rose-400/30 bg-rose-400/10 hover:bg-rose-400/20'
                                      : 'border-white/10 bg-white/5 hover:bg-white/10'
                                    : u.format === 'short'
                                      ? 'border-rose-200 bg-rose-50 hover:bg-rose-100'
                                      : 'border-border bg-card hover:bg-muted',
                                  open && 'ring-1 ring-primary'
                                )}
                                title={u.title}
                              >
                                <span className="flex items-center gap-1">
                                  {u.format === 'short' ? (
                                    <Clapperboard className={cn('h-2.5 w-2.5 shrink-0', dark ? 'text-rose-300' : 'text-rose-600')} />
                                  ) : (
                                    <Film className={cn('h-2.5 w-2.5 shrink-0', dark ? 'text-slate-400' : 'text-muted-foreground')} />
                                  )}
                                  <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', GOAL_DOT[u.goal])} />
                                  <span className={cn('truncate text-micro font-semibold leading-tight', dark && 'text-slate-300')}>
                                    {String(u.hour).padStart(2, '0')}:00
                                  </span>
                                </span>
                                <span className={cn('mt-0.5 line-clamp-2 block text-micro leading-tight', dark ? 'text-slate-200' : 'text-foreground/80')}>
                                  {u.title}
                                </span>
                              </button>
                            );
                          })}
                        </div>
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      ))}

      {/* Legend — the dots and colours have to mean something stated. */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-micro text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <Film className="h-3 w-3" /> Long-form
        </span>
        <span className="flex items-center gap-1.5">
          <Clapperboard className="h-3 w-3 text-rose-600" /> Short
        </span>
        <span className="ml-2 flex items-center gap-1.5">
          <Target className="h-3 w-3" /> Goal:
        </span>
        {(Object.keys(GOAL_DOT) as UploadGoal[]).map((g) => (
          <span key={g} className="flex items-center gap-1.5 capitalize">
            <span className={cn('h-2 w-2 rounded-full', GOAL_DOT[g])} /> {g}
          </span>
        ))}
      </div>
    </div>
  );
}
