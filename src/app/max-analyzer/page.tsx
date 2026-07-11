'use client';

import { useEffect, useState } from 'react';
import { Loader2, Sparkles } from 'lucide-react';
import { SidebarNav } from '@/components/dashboard/SidebarNav';
import { MaxSidebar } from '@/components/max/MaxSidebar';
import { MaxChat } from '@/components/max/MaxChat';
import { ResearchPanel } from '@/components/max/ResearchPanel';
import { ProjectModal } from '@/components/max/ProjectModal';
import { cn } from '@/lib/utils';
import { toast } from '@/hooks/use-toast';
import * as maxStore from '@/services/max-store';
import type { MaxChatMessage, MaxProject, MaxSourceKind, MaxThread } from '@/services/max-store';

type Tab = 'write' | 'research';

export default function MaxAnalyzerPage() {
  const [mounted, setMounted] = useState(false);
  const [threads, setThreads] = useState<MaxThread[]>([]);
  const [projects, setProjects] = useState<MaxProject[]>([]);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>('write');

  const [projectModalOpen, setProjectModalOpen] = useState(false);
  const [editingProject, setEditingProject] = useState<MaxProject | null>(null);

  useEffect(() => {
    (async () => {
      const [t, p] = await Promise.all([maxStore.listThreads(), maxStore.listProjects()]);
      setThreads(t);
      setProjects(p);
      if (t.length > 0) {
        setActiveThreadId(t[0].id);
      } else {
        const created = await maxStore.createThread({});
        setThreads([created]);
        setActiveThreadId(created.id);
      }
      setMounted(true);
    })();
  }, []);

  const activeThread = threads.find((t) => t.id === activeThreadId) ?? null;

  function applyThreadUpdate(updated: MaxThread | null) {
    if (updated) setThreads((prev) => prev.map((t) => (t.id === updated.id ? updated : t)));
  }

  async function handleNewThread() {
    const created = await maxStore.createThread({});
    setThreads((prev) => [created, ...prev]);
    setActiveThreadId(created.id);
    setActiveTab('write');
  }

  async function handleDeleteThread(id: string) {
    await maxStore.deleteThread(id);
    const remaining = threads.filter((t) => t.id !== id);
    setThreads(remaining);
    if (activeThreadId === id) {
      if (remaining.length > 0) {
        setActiveThreadId(remaining[0].id);
      } else {
        const created = await maxStore.createThread({});
        setThreads([created]);
        setActiveThreadId(created.id);
      }
    }
  }

  async function handleModelChange(model: string | undefined) {
    if (!activeThread) return;
    applyThreadUpdate(await maxStore.updateThread(activeThread.id, { model }));
  }

  async function handleProjectIdsChange(projectIds: string[]) {
    if (!activeThread) return;
    applyThreadUpdate(await maxStore.updateThread(activeThread.id, { projectIds }));
  }

  async function handleExchange(messages: MaxChatMessage[]) {
    if (!activeThread) return;
    const updated = await maxStore.appendMessages(activeThread.id, messages);
    if (updated) setThreads((prev) => [updated, ...prev.filter((t) => t.id !== updated.id)]);
  }

  async function handleAddSource(source: { kind: MaxSourceKind; label: string; value: string }) {
    if (!activeThread) return;
    applyThreadUpdate(await maxStore.addSource(activeThread.id, source));
  }

  async function handleRemoveSource(sourceId: string) {
    if (!activeThread) return;
    applyThreadUpdate(await maxStore.removeSource(activeThread.id, sourceId));
  }

  async function handleResearchExchange(messages: MaxChatMessage[]) {
    if (!activeThread) return;
    applyThreadUpdate(await maxStore.appendResearchMessages(activeThread.id, messages));
  }

  async function handleProjectCreatedFromResearch(project: MaxProject) {
    setProjects((prev) => [project, ...prev]);
    if (!activeThread) return;
    // Auto-attach so Write can draft against it immediately — the
    // "collect -> save -> chat with that project" loop.
    applyThreadUpdate(await maxStore.updateThread(activeThread.id, { projectIds: [...activeThread.projectIds, project.id] }));
  }

  function handleNewProject() {
    setEditingProject(null);
    setProjectModalOpen(true);
  }

  function handleEditProject(project: MaxProject) {
    setEditingProject(project);
    setProjectModalOpen(true);
  }

  async function handleDeleteProject(id: string) {
    await maxStore.deleteProject(id);
    setProjects((prev) => prev.filter((p) => p.id !== id));
    setThreads((prev) => prev.map((t) => ({ ...t, projectIds: t.projectIds.filter((pid) => pid !== id) })));
    toast({ title: 'Project deleted' });
  }

  function handleProjectSaved(saved: MaxProject) {
    setProjects((prev) => {
      const exists = prev.some((p) => p.id === saved.id);
      return exists ? prev.map((p) => (p.id === saved.id ? saved : p)) : [saved, ...prev];
    });
  }

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <SidebarNav />
      <main className="command-center relative flex-1 overflow-hidden flex flex-col">
        <div className="absolute inset-0 pointer-events-none" />
        <div className="relative flex items-center justify-between gap-3 px-5 py-2.5 border-b border-white/10 shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="h-7 w-7 rounded-lg bg-primary/15 flex items-center justify-center cc-glow">
              <Sparkles className="h-3.5 w-3.5 text-primary" />
            </div>
            <h1 className="text-sm font-bold text-white leading-tight font-headline">Script &amp; Analyses</h1>
          </div>

          <div className="flex items-center gap-1 rounded-full border border-white/10 bg-white/5 p-0.5">
            {(['write', 'research'] as Tab[]).map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={cn(
                  'rounded-full px-3.5 py-1 text-xs font-semibold capitalize transition-colors',
                  activeTab === tab ? 'bg-primary text-white cc-glow' : 'text-slate-400 hover:text-white'
                )}
              >
                {tab}
              </button>
            ))}
          </div>
        </div>

        {!mounted || !activeThread ? (
          <div className="relative flex-1 flex items-center justify-center text-slate-400">
            <Loader2 className="h-6 w-6 animate-spin" />
          </div>
        ) : (
          <div className="relative flex-1 flex overflow-hidden">
            <MaxSidebar
              threads={threads}
              activeThreadId={activeThreadId}
              onSelectThread={(id) => {
                setActiveThreadId(id);
                setActiveTab('write');
              }}
              onNewThread={handleNewThread}
              onDeleteThread={handleDeleteThread}
              projects={projects}
              onNewProject={handleNewProject}
              onEditProject={handleEditProject}
              onDeleteProject={handleDeleteProject}
            />
            {activeTab === 'write' ? (
              <MaxChat
                key={activeThread.id}
                thread={activeThread}
                projects={projects}
                onModelChange={handleModelChange}
                onProjectIdsChange={handleProjectIdsChange}
                onExchange={handleExchange}
              />
            ) : (
              <ResearchPanel
                key={activeThread.id}
                thread={activeThread}
                projects={projects}
                onModelChange={handleModelChange}
                onProjectIdsChange={handleProjectIdsChange}
                onAddSource={handleAddSource}
                onRemoveSource={handleRemoveSource}
                onResearchExchange={handleResearchExchange}
                onProjectCreated={handleProjectCreatedFromResearch}
              />
            )}
          </div>
        )}
      </main>

      <ProjectModal
        open={projectModalOpen}
        onOpenChange={setProjectModalOpen}
        project={editingProject}
        onSaved={handleProjectSaved}
      />
    </div>
  );
}
