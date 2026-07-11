'use client';

/**
 * Create/edit a Max Project — a reusable style/tone/hook/reference pack a
 * chat thread can attach for grounded output. Four named slots match the
 * files creators already keep (hookguide.md, style.md, reference.md,
 * tone.md); "+ Add another file" covers anything else. Files are read as
 * text client-side (FileReader) and stored inline — there's no object
 * storage in this app, and every slot the feature targets is a text doc.
 */

import { useEffect, useState } from 'react';
import { FileText, Loader2, Plus, Trash2, Upload } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { toast } from '@/hooks/use-toast';
import * as maxStore from '@/services/max-store';
import type { MaxFileKind, MaxProject, MaxProjectFile } from '@/services/max-store';

const NAMED_SLOTS: { kind: MaxFileKind; label: string; hint: string }[] = [
  { kind: 'hookguide', label: 'Hook Guide', hint: 'hookguide.md — how you open videos' },
  { kind: 'style', label: 'Style Guide', hint: 'style.md — writing style rules' },
  { kind: 'tone', label: 'Tone Guide', hint: 'tone.md — voice & tone rules' },
  { kind: 'reference', label: 'Reference Material', hint: 'reference.md — facts, examples, past scripts' },
];

function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });
}

export function ProjectModal({
  open,
  onOpenChange,
  project,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Edit an existing project, or omit to create a new one. */
  project?: MaxProject | null;
  onSaved: (project: MaxProject) => void;
}) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [files, setFiles] = useState<MaxProjectFile[]>([]);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setName(project?.name ?? '');
      setDescription(project?.description ?? '');
      setFiles(project?.files ?? []);
    }
  }, [open, project]);

  async function handleUpload(kind: MaxFileKind, fileList: FileList | null) {
    const file = fileList?.[0];
    if (!file) return;
    setUploading(kind);
    try {
      const content = await readFileAsText(file);
      const entry: MaxProjectFile = {
        id: Math.random().toString(36).slice(2),
        name: file.name,
        kind,
        content,
        addedAt: new Date().toISOString(),
      };
      setFiles((prev) => [...prev.filter((f) => !(f.kind === kind && kind !== 'other')), entry]);
    } catch {
      toast({ variant: 'destructive', title: 'Could not read file', description: 'Try a plain text or markdown file.' });
    } finally {
      setUploading(null);
    }
  }

  function removeFile(id: string) {
    setFiles((prev) => prev.filter((f) => f.id !== id));
  }

  async function handleSave() {
    if (!name.trim()) {
      toast({ variant: 'destructive', title: 'Name your project' });
      return;
    }
    setSaving(true);
    try {
      let saved: MaxProject;
      if (project) {
        saved = (await maxStore.updateProject(project.id, { name, description, files })) ?? project;
      } else {
        const created = await maxStore.createProject({ name, description });
        for (const f of files) {
          await maxStore.addProjectFile(created.id, { name: f.name, kind: f.kind, content: f.content });
        }
        saved = (await maxStore.getProject(created.id)) ?? created;
      }
      onSaved(saved);
      onOpenChange(false);
      toast({ title: project ? 'Project updated' : 'Project created', description: saved.name });
    } catch (e: any) {
      toast({ variant: 'destructive', title: 'Could not save project', description: e?.message });
    } finally {
      setSaving(false);
    }
  }

  const extras = files.filter((f) => f.kind === 'other');

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl bg-[#15132a] border-white/10 text-slate-200 max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-white">{project ? 'Edit project' : 'New project'}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-slate-400">Name</label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Main Channel — Weekly Uploads"
              className="bg-white/5 border-white/10 text-white placeholder:text-slate-500"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-slate-400">Description (optional)</label>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What this project is for"
              className="min-h-[60px] bg-white/5 border-white/10 text-white placeholder:text-slate-500 resize-none"
            />
          </div>

          <div className="space-y-2">
            <label className="text-xs font-medium text-slate-400">Reference files</label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {NAMED_SLOTS.map((slot) => {
                const existing = files.find((f) => f.kind === slot.kind);
                return (
                  <SlotUpload
                    key={slot.kind}
                    label={slot.label}
                    hint={slot.hint}
                    file={existing}
                    busy={uploading === slot.kind}
                    onUpload={(fl) => handleUpload(slot.kind, fl)}
                    onRemove={existing ? () => removeFile(existing.id) : undefined}
                  />
                );
              })}
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-xs font-medium text-slate-400">Additional files</label>
              <label className="inline-flex items-center gap-1 text-xs text-primary hover:text-primary/80 cursor-pointer">
                {uploading === 'other' ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
                Add another file
                <input
                  type="file"
                  accept=".md,.txt,text/plain,text/markdown"
                  className="hidden"
                  onChange={(e) => {
                    handleUpload('other', e.target.files);
                    e.target.value = '';
                  }}
                />
              </label>
            </div>
            {extras.length > 0 && (
              <div className="space-y-1.5">
                {extras.map((f) => (
                  <div key={f.id} className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm">
                    <FileText className="h-3.5 w-3.5 text-slate-500 shrink-0" />
                    <span className="flex-1 truncate">{f.name}</span>
                    <button onClick={() => removeFile(f.id)} className="text-slate-500 hover:text-red-400">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} className="text-slate-400 hover:text-white">
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving} className="cc-glow">
            {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
            {project ? 'Save changes' : 'Create project'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SlotUpload({
  label,
  hint,
  file,
  busy,
  onUpload,
  onRemove,
}: {
  label: string;
  hint: string;
  file?: MaxProjectFile;
  busy: boolean;
  onUpload: (files: FileList | null) => void;
  onRemove?: () => void;
}) {
  return (
    <label
      className="group relative flex flex-col gap-1 rounded-xl border border-dashed border-white/15 bg-white/5 px-3 py-2.5 cursor-pointer hover:border-primary/50 hover:bg-white/10 transition-colors"
    >
      <div className="flex items-center gap-2">
        {busy ? (
          <Loader2 className="h-3.5 w-3.5 text-primary animate-spin shrink-0" />
        ) : file ? (
          <FileText className="h-3.5 w-3.5 text-primary shrink-0" />
        ) : (
          <Upload className="h-3.5 w-3.5 text-slate-500 shrink-0" />
        )}
        <span className="text-sm font-medium text-white">{label}</span>
      </div>
      <span className="text-micro text-slate-500 truncate">{file ? file.name : hint}</span>
      {file && onRemove && (
        <button
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onRemove();
          }}
          className="absolute right-2 top-2 text-slate-500 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      )}
      <input
        type="file"
        accept=".md,.txt,text/plain,text/markdown"
        className="hidden"
        onChange={(e) => onUpload(e.target.files)}
      />
    </label>
  );
}
