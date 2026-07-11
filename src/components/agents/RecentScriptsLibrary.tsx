'use client';

/**
 * Recent Scripts — a library of scripts saved from Script & Analyses'
 * Write tab (see the "Save script" button in MaxChat.tsx). Mirrors
 * ThumbnailStudio's gallery pattern one level simpler: no wizard, just
 * browse/search/act on what's already been saved.
 */

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Copy, ExternalLink, Library, Search, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { toast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { SendToMenu } from '@/components/agents/SendToMenu';
import { WorkspaceHeader } from '@/components/agents/workspace/shell';
import * as store from '@/services/agent-store';
import type { SavedScript } from '@/services/agent-store';

function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function relativeDate(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.round(diffMs / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

export function RecentScriptsLibrary({ onBack }: { onBack: () => void }) {
  const router = useRouter();
  const [scripts, setScripts] = useState<SavedScript[]>([]);
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    (async () => {
      const list = await store.listScripts();
      setScripts(list);
      setSelectedId(list[0]?.id ?? null);
      setLoaded(true);
    })();
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return scripts;
    return scripts.filter((s) => s.title.toLowerCase().includes(q) || s.script.toLowerCase().includes(q));
  }, [scripts, query]);

  const selected = scripts.find((s) => s.id === selectedId) ?? null;

  async function handleDelete(id: string) {
    const next = await store.removeScript(id);
    setScripts(next);
    if (selectedId === id) setSelectedId(next[0]?.id ?? null);
    toast({ title: 'Script deleted' });
  }

  function handleCopy(script: string) {
    navigator.clipboard.writeText(script);
    toast({ title: 'Copied' });
  }

  return (
    <div className="max-w-6xl mx-auto space-y-6 py-2 animate-in fade-in">
      <WorkspaceHeader icon={Library} gradient="from-violet-500 to-purple-600" name="Recent Scripts" category="Writing" onBack={onBack} />

      {!loaded ? (
        <div className="cc-card p-10 text-center text-sm text-slate-500">Loading…</div>
      ) : scripts.length === 0 ? (
        <div className="cc-card p-10 text-center space-y-2">
          <Library className="h-8 w-8 text-slate-600 mx-auto" />
          <p className="text-sm text-slate-400">No scripts yet — write one in Script &amp; Analyses and save it here.</p>
          <Button variant="outline" size="sm" className="border-white/10 bg-white/5 text-slate-200 hover:bg-white/10" onClick={() => router.push('/max-analyzer')}>
            Open Script &amp; Analyses
          </Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-[280px_1fr] gap-4">
          <div className="cc-card flex flex-col overflow-hidden" style={{ height: '65vh' }}>
            <div className="p-3 border-b border-white/10">
              <div className="flex items-center gap-2 rounded-lg bg-white/5 px-2.5 py-1.5">
                <Search className="h-3.5 w-3.5 text-slate-500 shrink-0" />
                <Input
                  placeholder="Search scripts…"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  className="h-6 border-none bg-transparent p-0 shadow-none focus-visible:ring-0 text-sm placeholder:text-slate-500"
                />
              </div>
            </div>
            <ScrollArea className="flex-1">
              <div className="p-2 space-y-1">
                {filtered.length === 0 && <div className="px-2 py-4 text-center text-xs text-slate-500">No matches.</div>}
                {filtered.map((s) => (
                  <button
                    key={s.id}
                    onClick={() => setSelectedId(s.id)}
                    className={cn(
                      'w-full text-left rounded-lg px-3 py-2.5 transition-colors',
                      s.id === selectedId ? 'bg-primary/15 border border-primary/30' : 'hover:bg-white/5 border border-transparent'
                    )}
                  >
                    <div className="text-sm font-medium text-white truncate">{s.title}</div>
                    <div className="text-micro text-slate-500 mt-0.5">
                      {relativeDate(s.createdAt)} · {wordCount(s.script)} words
                    </div>
                  </button>
                ))}
              </div>
            </ScrollArea>
          </div>

          <div className="cc-card flex flex-col overflow-hidden" style={{ height: '65vh' }}>
            {selected ? (
              <>
                <div className="flex items-center justify-between gap-3 p-4 border-b border-white/10">
                  <div className="min-w-0">
                    <h3 className="font-semibold text-white truncate">{selected.title}</h3>
                    <p className="text-micro text-slate-500 mt-0.5">
                      {relativeDate(selected.createdAt)} · {wordCount(selected.script)} words
                      {selected.model ? ` · ${selected.model}` : ''}
                    </p>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <Button
                      variant="outline"
                      size="sm"
                      className="gap-1.5 border-white/10 bg-white/5 text-slate-200 hover:bg-white/10 hover:text-white"
                      onClick={() => handleCopy(selected.script)}
                    >
                      <Copy className="h-3.5 w-3.5" /> Copy
                    </Button>
                    <SendToMenu variant="dark" label="Send to" kinds={['doc', 'email']} title={selected.title} body={selected.script} />
                    {selected.threadId && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="gap-1.5 border-white/10 bg-white/5 text-slate-200 hover:bg-white/10 hover:text-white"
                        onClick={() => router.push(`/max-analyzer?thread=${selected.threadId}`)}
                      >
                        <ExternalLink className="h-3.5 w-3.5" /> Open in Script &amp; Analyses
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="icon"
                      className="text-slate-500 hover:text-red-400 hover:bg-red-400/10"
                      onClick={() => handleDelete(selected.id)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
                <ScrollArea className="flex-1 p-5">
                  <div className="max-w-2xl whitespace-pre-wrap text-sm text-slate-200 leading-relaxed">{selected.script}</div>
                </ScrollArea>
              </>
            ) : (
              <div className="flex-1 flex items-center justify-center text-sm text-slate-500">Select a script to view it.</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
