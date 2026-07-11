'use client';

import { useEffect, useState } from 'react';
import { FolderPlus, Loader2, Check, Layers } from 'lucide-react';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import * as store from '@/services/agent-store';
import type { ThumbnailProject, ThumbnailStyle } from '@/services/agent-store';

/**
 * Saves a style into a thumbnail project — either an existing one or a new one
 * created inline. Used from the Thumbnail DNA panel in Content Insights, which
 * is where a style is discovered; the Studio is where it gets spent.
 */
export function SaveToProjectDialog({
  open,
  onOpenChange,
  style,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The style to save. Built by the caller via store.makeStyle(). */
  style: ThumbnailStyle | null;
  onSaved?: (project: ThumbnailProject) => void;
}) {
  const [projects, setProjects] = useState<ThumbnailProject[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [newName, setNewName] = useState('');
  const [label, setLabel] = useState('');
  const [saving, setSaving] = useState(false);

  // Reload on each open: a project may have been created in another tab.
  useEffect(() => {
    if (!open) return;
    store.listProjects().then((p) => {
      setProjects(p);
      setSelectedId(p[0]?.id ?? null); // default to most recent, else "new"
    });
    setLabel(style?.label ?? '');
    setNewName('');
  }, [open, style?.label]);

  const creatingNew = selectedId === null;
  const canSave = Boolean(style) && (creatingNew ? newName.trim().length > 0 : true);

  async function save() {
    if (!style || !canSave) return;
    setSaving(true);
    try {
      const entry: ThumbnailStyle = { ...style, label: label.trim() || style.label };
      const project = creatingNew
        ? await store.createProject({ name: newName.trim(), styles: [entry] })
        : await store.addStyle(selectedId!, entry);
      if (project) onSaved?.(project);
      onOpenChange(false);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Layers className="h-4 w-4 text-primary" /> Save style to a project
          </DialogTitle>
          <DialogDescription>
            The Thumbnail Studio feeds every enabled style in a project to the image model.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-1">
          <div className="space-y-2">
            <Label htmlFor="style-label">Style name</Label>
            <Input
              id="style-label"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="e.g. Travel outliers — July"
            />
          </div>

          <div className="space-y-2">
            <Label>Project</Label>
            <div className="max-h-48 space-y-1.5 overflow-y-auto pr-1">
              {projects.map((p) => (
                <button
                  key={p.id}
                  onClick={() => setSelectedId(p.id)}
                  className={cn(
                    'flex w-full items-center justify-between gap-2 rounded-lg border px-3 py-2 text-left transition-colors',
                    selectedId === p.id ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/40'
                  )}
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">{p.name}</span>
                    <span className="block text-micro text-muted-foreground">
                      {p.styles.length} {p.styles.length === 1 ? 'style' : 'styles'}
                    </span>
                  </span>
                  {selectedId === p.id && <Check className="h-4 w-4 shrink-0 text-primary" />}
                </button>
              ))}

              <button
                onClick={() => setSelectedId(null)}
                className={cn(
                  'flex w-full items-center gap-2 rounded-lg border border-dashed px-3 py-2 text-left transition-colors',
                  creatingNew ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/40'
                )}
              >
                <FolderPlus className="h-4 w-4 shrink-0 text-primary" />
                <span className="text-sm font-medium">New project</span>
              </button>
            </div>
          </div>

          {creatingNew && (
            <div className="space-y-2 animate-in fade-in duration-200">
              <Label htmlFor="project-name">Project name</Label>
              <Input
                id="project-name"
                autoFocus
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && canSave) save(); }}
                placeholder="e.g. Travel channel — Q3"
              />
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={save} disabled={!canSave || saving} className="gap-2">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
            {creatingNew ? 'Create & save' : 'Save style'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
