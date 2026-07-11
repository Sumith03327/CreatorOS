'use client';

/**
 * The compact control row docked above the message box: model picker,
 * attach-project, and chips for whatever's attached. Shared by both chat
 * surfaces (Write and Research) so controls live where you type instead of
 * a detached header bar.
 */

import { useState } from 'react';
import { Check, ChevronDown, FolderPlus, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import { ModelPicker } from '@/components/max/ModelPicker';
import type { MaxProject } from '@/services/max-store';

export function ComposerToolbar({
  model,
  onModelChange,
  projects,
  attachedProjectIds,
  onProjectIdsChange,
}: {
  model?: string;
  onModelChange: (id: string | undefined) => void;
  projects: MaxProject[];
  attachedProjectIds: string[];
  onProjectIdsChange: (ids: string[]) => void;
}) {
  const [attachOpen, setAttachOpen] = useState(false);
  const attached = projects.filter((p) => attachedProjectIds.includes(p.id));

  function toggle(id: string) {
    onProjectIdsChange(
      attachedProjectIds.includes(id) ? attachedProjectIds.filter((pid) => pid !== id) : [...attachedProjectIds, id]
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <ModelPicker value={model} onChange={onModelChange} />

      <Popover open={attachOpen} onOpenChange={setAttachOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5 border-white/10 bg-white/5 text-slate-200 hover:bg-white/10 hover:text-white"
          >
            <FolderPlus className="h-3.5 w-3.5" />
            {attached.length > 0 ? `${attached.length} project${attached.length > 1 ? 's' : ''}` : 'Project'}
            <ChevronDown className="h-3 w-3 opacity-60" />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-64 p-1.5 bg-[#15132a] border-white/10 text-slate-200">
          {projects.length === 0 && <div className="px-2.5 py-3 text-xs text-slate-500">No projects saved yet.</div>}
          {projects.map((p) => {
            const on = attachedProjectIds.includes(p.id);
            return (
              <button
                key={p.id}
                onClick={() => toggle(p.id)}
                className={cn(
                  'w-full text-left rounded-lg px-2.5 py-2 text-sm flex items-center justify-between hover:bg-white/5',
                  on && 'bg-primary/15'
                )}
              >
                <span className="truncate">{p.name}</span>
                {on && <Check className="h-3.5 w-3.5 text-primary shrink-0 ml-2" />}
              </button>
            );
          })}
        </PopoverContent>
      </Popover>

      {attached.map((p) => (
        <span
          key={p.id}
          className="inline-flex items-center gap-1 rounded-full bg-primary/15 border border-primary/30 text-primary text-xs px-2 py-0.5"
        >
          {p.name}
          <button onClick={() => toggle(p.id)} className="hover:text-white">
            <X className="h-3 w-3" />
          </button>
        </span>
      ))}
    </div>
  );
}
