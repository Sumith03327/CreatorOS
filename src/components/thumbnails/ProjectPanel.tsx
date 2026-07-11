'use client';

import { useState } from 'react';
import {
  ChevronDown, ChevronUp, FolderPlus, Layers, Plus, Trash2, X, Check, Sparkles,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import * as store from '@/services/agent-store';
import type { ThumbnailProject, ThumbnailStyle } from '@/services/agent-store';

const DARK_INPUT = 'bg-white/5 border-white/10 text-white placeholder:text-slate-500 focus-visible:ring-primary/40';
const NONE = '__none__';

/**
 * Project selection and its style list, for the Thumbnail Studio.
 *
 * A project is a named bundle of style rules. Order is priority: the first
 * enabled style leads the prompt and wins conflicts (see compileStyleBrief in
 * /api/thumbnails). Disabled styles stay in the project but are not sent.
 */
export function ProjectPanel({
  projects,
  activeProject,
  onSelectProject,
  onProjectsChanged,
}: {
  projects: ThumbnailProject[];
  activeProject: ThumbnailProject | null;
  onSelectProject: (id: string | null) => void;
  /** Called with the refreshed list whenever a project or style mutates. */
  onProjectsChanged: (projects: ThumbnailProject[], active: ThumbnailProject | null) => void;
}) {
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [addingStyle, setAddingStyle] = useState(false);
  const [styleLabel, setStyleLabel] = useState('');
  const [styleRule, setStyleRule] = useState('');

  async function refresh(activeId: string | null) {
    const list = await store.listProjects();
    onProjectsChanged(list, list.find((p) => p.id === activeId) ?? null);
  }

  async function createProject() {
    const name = newName.trim();
    if (!name) return;
    const p = await store.createProject({ name });
    setNewName('');
    setCreating(false);
    onSelectProject(p.id);
    await refresh(p.id);
  }

  async function addManualStyle() {
    if (!activeProject || !styleRule.trim()) return;
    await store.addStyle(
      activeProject.id,
      store.makeStyle({
        label: styleLabel.trim() || 'Custom rule',
        origin: 'manual',
        rule: styleRule.trim(),
      })
    );
    setStyleLabel('');
    setStyleRule('');
    setAddingStyle(false);
    await refresh(activeProject.id);
  }

  async function toggleStyle(s: ThumbnailStyle) {
    if (!activeProject) return;
    await store.updateStyle(activeProject.id, s.id, { enabled: !s.enabled });
    await refresh(activeProject.id);
  }

  async function move(s: ThumbnailStyle, dir: -1 | 1) {
    if (!activeProject) return;
    await store.reorderStyle(activeProject.id, s.id, dir);
    await refresh(activeProject.id);
  }

  async function remove(s: ThumbnailStyle) {
    if (!activeProject) return;
    await store.removeStyle(activeProject.id, s.id);
    await refresh(activeProject.id);
  }

  async function deleteProject() {
    if (!activeProject) return;
    await store.deleteProject(activeProject.id);
    onSelectProject(null);
    await refresh(null);
  }

  const enabledCount = activeProject?.styles.filter((s) => s.enabled).length ?? 0;

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label className="flex items-center gap-2 text-slate-300">
          <Layers className="h-3.5 w-3.5" /> Project
          <span className="font-normal text-slate-500">(style rules fed to the model)</span>
        </Label>

        {creating ? (
          <div className="flex items-center gap-2">
            <Input
              autoFocus
              placeholder="Project name, e.g. Travel channel — Q3"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') createProject();
                if (e.key === 'Escape') { setCreating(false); setNewName(''); }
              }}
              className={DARK_INPUT}
            />
            <Button size="icon" onClick={createProject} disabled={!newName.trim()} className="shrink-0">
              <Check className="h-4 w-4" />
            </Button>
            <Button size="icon" variant="ghost" onClick={() => { setCreating(false); setNewName(''); }} className="shrink-0 text-slate-400 hover:text-white hover:bg-white/5">
              <X className="h-4 w-4" />
            </Button>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <Select
              value={activeProject?.id ?? NONE}
              onValueChange={(v) => onSelectProject(v === NONE ? null : v)}
            >
              <SelectTrigger className="bg-white/5 border-white/10 text-white"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>No project — one-off thumbnail</SelectItem>
                {projects.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name} · {p.styles.length} {p.styles.length === 1 ? 'style' : 'styles'}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button variant="outline" size="icon" onClick={() => setCreating(true)} title="New project"
              className="shrink-0 border-white/10 bg-white/5 text-slate-200 hover:bg-white/10 hover:text-white">
              <FolderPlus className="h-4 w-4" />
            </Button>
          </div>
        )}
      </div>

      {activeProject && (
        <div className="space-y-3 rounded-xl border border-white/10 bg-white/5 p-4 animate-in fade-in duration-200">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-semibold text-slate-200">
              Style rules
              <span className="ml-2 font-normal text-slate-500">
                {enabledCount} of {activeProject.styles.length} active
                {enabledCount > 1 && ' · rule 1 wins conflicts'}
              </span>
            </p>
            <Button variant="ghost" size="sm" onClick={() => setAddingStyle((v) => !v)}
              className="h-7 gap-1.5 text-xs text-slate-300 hover:bg-white/10 hover:text-white">
              <Plus className="h-3 w-3" /> Add rule
            </Button>
          </div>

          {activeProject.styles.length === 0 && !addingStyle && (
            <p className="text-xs leading-relaxed text-slate-500">
              No styles yet. Run <span className="font-semibold text-slate-300">Thumbnail DNA</span> in
              Research → Content and save the rule here, or add one by hand.
            </p>
          )}

          {addingStyle && (
            <div className="space-y-2 rounded-lg border border-white/10 bg-black/20 p-3 animate-in fade-in duration-200">
              <Input placeholder="Rule name" value={styleLabel} onChange={(e) => setStyleLabel(e.target.value)} className={cn('h-8 text-xs', DARK_INPUT)} />
              <Textarea
                placeholder="e.g. Always a shocked face on the left third, 3 words or fewer in yellow on a red ground."
                value={styleRule}
                onChange={(e) => setStyleRule(e.target.value)}
                className={cn('min-h-[60px] text-xs', DARK_INPUT)}
              />
              <div className="flex gap-2">
                <Button size="sm" onClick={addManualStyle} disabled={!styleRule.trim()} className="h-7 gap-1.5 text-xs">
                  <Check className="h-3 w-3" /> Add
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setAddingStyle(false)} className="h-7 text-xs text-slate-400 hover:bg-white/10 hover:text-white">
                  Cancel
                </Button>
              </div>
            </div>
          )}

          <ul className="space-y-2">
            {activeProject.styles.map((s, i) => (
              <li key={s.id} className={cn('rounded-lg border p-3 transition-colors',
                s.enabled ? 'border-primary/30 bg-primary/5' : 'border-white/10 bg-transparent opacity-60')}>
                <div className="flex items-start gap-2.5">
                  <span className={cn('mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded text-micro font-bold',
                    s.enabled ? 'bg-primary text-white' : 'bg-white/10 text-slate-500')}>
                    {s.enabled ? i + 1 : '–'}
                  </span>

                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <p className="truncate text-xs font-semibold text-slate-100">{s.label}</p>
                      {s.origin === 'dna' && (
                        <span className="flex shrink-0 items-center gap-0.5 rounded bg-fuchsia-500/15 px-1 py-0.5 text-micro font-semibold text-fuchsia-300">
                          <Sparkles className="h-2.5 w-2.5" /> DNA
                        </span>
                      )}
                    </div>
                    <p className="mt-0.5 text-micro leading-relaxed text-slate-400">{s.rule}</p>

                    {s.sourceThumbnails && s.sourceThumbnails.length > 0 && (
                      <div className="mt-2 flex gap-1">
                        {s.sourceThumbnails.slice(0, 6).map((src, j) => (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img key={j} src={src} alt="" className="h-6 w-10 shrink-0 rounded object-cover opacity-70" />
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="flex shrink-0 items-center gap-1">
                    <button onClick={() => move(s, -1)} disabled={i === 0} title="Move up"
                      className="rounded p-1 text-slate-500 hover:bg-white/10 hover:text-white disabled:opacity-30 disabled:hover:bg-transparent">
                      <ChevronUp className="h-3.5 w-3.5" />
                    </button>
                    <button onClick={() => move(s, 1)} disabled={i === activeProject.styles.length - 1} title="Move down"
                      className="rounded p-1 text-slate-500 hover:bg-white/10 hover:text-white disabled:opacity-30 disabled:hover:bg-transparent">
                      <ChevronDown className="h-3.5 w-3.5" />
                    </button>
                    <Switch checked={s.enabled} onCheckedChange={() => toggleStyle(s)} />
                    <button onClick={() => remove(s)} title="Remove rule"
                      className="rounded p-1 text-slate-500 hover:bg-white/10 hover:text-destructive">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>

          <button onClick={deleteProject}
            className="text-micro font-semibold text-slate-600 transition-colors hover:text-destructive">
            Delete project
          </button>
        </div>
      )}
    </div>
  );
}
