'use client';

/**
 * Title projects inside the Doctor: pick a project, keep your ideas in it, and
 * see which ones actually scored well.
 *
 * The score lives ON the idea, written back when the Doctor grades it — so a
 * creator juggling ten candidate titles can come back a day later and see the
 * shortlist rather than re-running everything.
 */

import { useState } from 'react';
import {
  Layers, FolderPlus, Check, X, Pencil, Trash2, Target, Inbox, Plus, ArrowRight,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import * as store from '@/lib/title-projects';
import type { TitleProject, TitleIdea } from '@/lib/title-projects';

const DARK_INPUT = 'bg-white/5 border-white/10 text-white placeholder:text-slate-500 focus-visible:ring-primary/40';
const NONE = '__none__';

function scoreTone(score?: number) {
  if (score === undefined) return 'text-slate-500';
  if (score >= 8) return 'text-emerald-400';
  if (score >= 6) return 'text-amber-400';
  return 'text-red-400';
}

export function TitleProjectPanel({
  projects,
  active,
  inbox,
  onSelect,
  onChanged,
  onScore,
  onDismissInbox,
}: {
  projects: TitleProject[];
  active: TitleProject | null;
  /** Ideas handed over from the Action Plan, awaiting a home. */
  inbox: string[];
  onSelect: (id: string | null) => void;
  onChanged: (projects: TitleProject[], active: TitleProject | null) => void;
  /** Load an idea into the scorer and run it. */
  onScore: (idea: TitleIdea) => void;
  onDismissInbox: () => void;
}) {
  const [creating, setCreating] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState('');
  const [adding, setAdding] = useState(false);
  const [newIdea, setNewIdea] = useState('');

  function refresh(activeId: string | null) {
    const list = store.listTitleProjects();
    onChanged(list, list.find((p) => p.id === activeId) ?? null);
  }

  /** Save the handed-over ideas into a project — new or existing. */
  function saveInbox(projectId: string | null, projectName?: string) {
    const ideas = store.takeInbox().map((t) => store.makeIdea(t, 'plan'));
    const target = projectId
      ? store.addIdeas(projectId, ideas)
      : store.createTitleProject(projectName || 'Ideas from my plan', ideas);
    if (target) {
      onSelect(target.id);
      refresh(target.id);
    }
    onDismissInbox();
  }

  function createProject() {
    const n = name.trim();
    if (!n) return;
    const p = store.createTitleProject(n);
    setName('');
    setCreating(false);
    onSelect(p.id);
    refresh(p.id);
  }

  function rename() {
    if (!active || !name.trim()) return;
    store.renameTitleProject(active.id, name.trim());
    setRenaming(false);
    refresh(active.id);
  }

  function addIdea() {
    if (!active || !newIdea.trim()) return;
    store.addIdeas(active.id, [store.makeIdea(newIdea, 'manual')]);
    setNewIdea('');
    setAdding(false);
    refresh(active.id);
  }

  function remove(ideaId: string) {
    if (!active) return;
    store.removeIdea(active.id, ideaId);
    refresh(active.id);
  }

  function destroy() {
    if (!active) return;
    store.deleteTitleProject(active.id);
    onSelect(null);
    refresh(null);
  }

  const scored = active?.ideas.filter((i) => i.score !== undefined) ?? [];

  return (
    <div className="space-y-4">
      {/* Ideas arriving from the Action Plan. */}
      {inbox.length > 0 && (
        <div className="cc-card border-primary/30 p-5 space-y-3 animate-in fade-in">
          <div className="flex items-center gap-2">
            <Inbox className="h-4 w-4 text-primary" />
            <p className="text-sm font-semibold text-white">
              {inbox.length} ideas arrived from your Action Plan
            </p>
          </div>
          <ul className="max-h-32 space-y-1 overflow-y-auto pr-1">
            {inbox.slice(0, 12).map((t, i) => (
              <li key={i} className="truncate text-xs text-slate-400">• {t}</li>
            ))}
          </ul>
          <div className="flex flex-wrap items-center gap-2">
            <Input
              placeholder="Name a new project…"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && name.trim()) saveInbox(null, name); }}
              className={cn('h-9 flex-1 min-w-48', DARK_INPUT)}
            />
            <Button size="sm" className="h-9 gap-1.5" onClick={() => saveInbox(null, name)} disabled={!name.trim()}>
              <FolderPlus className="h-3.5 w-3.5" /> Save to new project
            </Button>
            {projects.length > 0 && (
              <Select onValueChange={(id) => saveInbox(id)}>
                <SelectTrigger className="h-9 w-52 bg-white/5 border-white/10 text-white">
                  <SelectValue placeholder="…or an existing project" />
                </SelectTrigger>
                <SelectContent>
                  {projects.map((p) => (
                    <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <Button size="sm" variant="ghost" onClick={onDismissInbox} className="h-9 text-slate-400 hover:text-white hover:bg-white/10">
              Dismiss
            </Button>
          </div>
        </div>
      )}

      {/* Project selector. */}
      <div className="space-y-2">
        <Label className="flex items-center gap-2 text-slate-300">
          <Layers className="h-3.5 w-3.5" /> Project
          <span className="font-normal text-slate-500">(your saved ideas)</span>
        </Label>

        {creating ? (
          <div className="flex items-center gap-2">
            <Input
              autoFocus
              placeholder="Project name, e.g. October titles"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') createProject();
                if (e.key === 'Escape') { setCreating(false); setName(''); }
              }}
              className={DARK_INPUT}
            />
            <Button size="icon" onClick={createProject} disabled={!name.trim()} className="shrink-0">
              <Check className="h-4 w-4" />
            </Button>
            <Button size="icon" variant="ghost" onClick={() => { setCreating(false); setName(''); }}
              className="shrink-0 text-slate-400 hover:bg-white/5 hover:text-white">
              <X className="h-4 w-4" />
            </Button>
          </div>
        ) : renaming && active ? (
          <div className="flex items-center gap-2">
            <Input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') rename();
                if (e.key === 'Escape') setRenaming(false);
              }}
              className={DARK_INPUT}
            />
            <Button size="icon" onClick={rename} disabled={!name.trim()} className="shrink-0">
              <Check className="h-4 w-4" />
            </Button>
            <Button size="icon" variant="ghost" onClick={() => setRenaming(false)}
              className="shrink-0 text-slate-400 hover:bg-white/5 hover:text-white">
              <X className="h-4 w-4" />
            </Button>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <Select value={active?.id ?? NONE} onValueChange={(v) => onSelect(v === NONE ? null : v)}>
              <SelectTrigger className="bg-white/5 border-white/10 text-white"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>No project — one-off score</SelectItem>
                {projects.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name} · {p.ideas.length} {p.ideas.length === 1 ? 'idea' : 'ideas'}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {active && (
              <Button variant="outline" size="icon" title="Rename"
                onClick={() => { setName(active.name); setRenaming(true); }}
                className="shrink-0 border-white/10 bg-white/5 text-slate-200 hover:bg-white/10 hover:text-white">
                <Pencil className="h-4 w-4" />
              </Button>
            )}
            <Button variant="outline" size="icon" title="New project" onClick={() => setCreating(true)}
              className="shrink-0 border-white/10 bg-white/5 text-slate-200 hover:bg-white/10 hover:text-white">
              <FolderPlus className="h-4 w-4" />
            </Button>
          </div>
        )}
      </div>

      {/* The project's ideas. */}
      {active && (
        <div className="cc-card space-y-3 p-4 animate-in fade-in duration-200">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-semibold text-slate-200">
              {active.ideas.length} {active.ideas.length === 1 ? 'idea' : 'ideas'}
              {scored.length > 0 && (
                <span className="ml-2 font-normal text-slate-500">{scored.length} scored</span>
              )}
            </p>
            <Button variant="ghost" size="sm" onClick={() => setAdding((v) => !v)}
              className="h-7 gap-1.5 text-xs text-slate-300 hover:bg-white/10 hover:text-white">
              <Plus className="h-3 w-3" /> Add idea
            </Button>
          </div>

          {adding && (
            <div className="flex items-center gap-2 animate-in fade-in duration-200">
              <Input
                autoFocus
                placeholder="A title you're considering…"
                value={newIdea}
                onChange={(e) => setNewIdea(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') addIdea(); if (e.key === 'Escape') setAdding(false); }}
                className={cn('h-8 text-xs', DARK_INPUT)}
              />
              <Button size="sm" onClick={addIdea} disabled={!newIdea.trim()} className="h-8 shrink-0">
                <Check className="h-3.5 w-3.5" />
              </Button>
            </div>
          )}

          {active.ideas.length === 0 && !adding && (
            <p className="text-xs leading-relaxed text-slate-500">
              Empty. Add a title by hand, or send a batch over from your Action Plan.
            </p>
          )}

          <ul className="space-y-1.5">
            {active.ideas.map((idea) => (
              <li key={idea.id}
                className="group flex items-center gap-2.5 rounded-lg border border-white/10 bg-white/5 p-2.5">
                <span className={cn('w-8 shrink-0 text-center text-sm font-bold tabular', scoreTone(idea.score))}>
                  {idea.score !== undefined ? idea.score : '–'}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs font-medium text-slate-100">{idea.title}</span>
                  {idea.verdict && (
                    <span className="mt-0.5 block truncate text-micro text-slate-500">{idea.verdict}</span>
                  )}
                </span>
                <button
                  onClick={() => onScore(idea)}
                  title={idea.score !== undefined ? 'Re-score' : 'Score this'}
                  className="flex h-7 shrink-0 items-center gap-1 rounded-md bg-white/5 px-2 text-micro font-semibold text-slate-300 opacity-0 transition-opacity hover:bg-primary/20 hover:text-primary group-hover:opacity-100"
                >
                  <Target className="h-3 w-3" /> Score <ArrowRight className="h-3 w-3" />
                </button>
                <button
                  onClick={() => remove(idea.id)}
                  title="Remove"
                  className="shrink-0 rounded p-1 text-slate-500 opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </li>
            ))}
          </ul>

          <button onClick={destroy}
            className="text-micro font-semibold text-slate-600 transition-colors hover:text-destructive">
            Delete project
          </button>
        </div>
      )}
    </div>
  );
}
