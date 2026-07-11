'use client';

/**
 * In-page sidebar for Script with Max: chat thread history + saved Projects.
 * Sits inside the .command-center chat surface, alongside (not replacing)
 * the app's persistent SidebarNav.
 */

import { FolderOpen, MessageSquare, Pencil, Plus, Sparkles, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import type { MaxProject, MaxThread } from '@/services/max-store';

export function MaxSidebar({
  threads,
  activeThreadId,
  onSelectThread,
  onNewThread,
  onDeleteThread,
  projects,
  onNewProject,
  onEditProject,
  onDeleteProject,
}: {
  threads: MaxThread[];
  activeThreadId: string | null;
  onSelectThread: (id: string) => void;
  onNewThread: () => void;
  onDeleteThread: (id: string) => void;
  projects: MaxProject[];
  onNewProject: () => void;
  onEditProject: (project: MaxProject) => void;
  onDeleteProject: (id: string) => void;
}) {
  return (
    <div className="w-72 shrink-0 border-r border-white/10 flex flex-col h-full">
      <div className="p-3 border-b border-white/10">
        <Button onClick={onNewThread} className="w-full justify-start gap-2 cc-glow">
          <Plus className="h-4 w-4" />
          New chat
        </Button>
      </div>

      <ScrollArea className="flex-1">
        <div className="p-3 space-y-4">
          <div>
            <div className="flex items-center justify-between px-1 mb-1.5">
              <span className="text-micro font-semibold uppercase tracking-wider text-slate-500">Chats</span>
            </div>
            <div className="space-y-0.5">
              {threads.length === 0 && (
                <div className="px-2 py-3 text-xs text-slate-500">No chats yet.</div>
              )}
              {threads.map((t) => (
                <div
                  key={t.id}
                  className={cn(
                    'group flex items-center gap-2 rounded-lg px-2.5 py-2 cursor-pointer text-sm',
                    t.id === activeThreadId ? 'bg-primary/15 text-white' : 'text-slate-300 hover:bg-white/5'
                  )}
                  onClick={() => onSelectThread(t.id)}
                >
                  <MessageSquare className="h-3.5 w-3.5 shrink-0 text-slate-500" />
                  <span className="flex-1 truncate">{t.title}</span>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onDeleteThread(t.id);
                    }}
                    className="opacity-0 group-hover:opacity-100 text-slate-500 hover:text-red-400 shrink-0"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between px-1 mb-1.5">
              <span className="text-micro font-semibold uppercase tracking-wider text-slate-500">Projects</span>
              <button onClick={onNewProject} aria-label="New project" className="text-slate-500 hover:text-primary">
                <Plus className="h-3.5 w-3.5" />
              </button>
            </div>
            <div className="space-y-0.5">
              {projects.length === 0 && (
                <button
                  onClick={onNewProject}
                  className="w-full text-left px-2.5 py-2 text-xs text-slate-500 hover:text-primary flex items-center gap-2"
                >
                  <Sparkles className="h-3.5 w-3.5" />
                  Save your style, tone &amp; hooks
                </button>
              )}
              {projects.map((p) => (
                <div
                  key={p.id}
                  className="group flex items-center gap-2 rounded-lg px-2.5 py-2 text-sm text-slate-300 hover:bg-white/5 cursor-pointer"
                  onClick={() => onEditProject(p)}
                >
                  <FolderOpen className="h-3.5 w-3.5 shrink-0 text-slate-500" />
                  <span className="flex-1 truncate">{p.name}</span>
                  <span className="text-micro text-slate-600 shrink-0">{p.files.length}</span>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onEditProject(p);
                    }}
                    className="opacity-0 group-hover:opacity-100 text-slate-500 hover:text-white shrink-0"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onDeleteProject(p.id);
                    }}
                    className="opacity-0 group-hover:opacity-100 text-slate-500 hover:text-red-400 shrink-0"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      </ScrollArea>
    </div>
  );
}
