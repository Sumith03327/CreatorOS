'use client';

/**
 * The Research tab — a notebook for collecting resources (links, videos,
 * notes) and running web-grounded Q&A over them (Perplexity by default).
 * The attached project (auto-created on first activity if none is picked —
 * see page.tsx's ensureResearchProject) is the live autosave target: every
 * source here, manual or auto-discovered from Max's own citations, and the
 * running research conversation are mirrored into it automatically. There
 * is no manual "save" step.
 */

import { useEffect, useRef, useState } from 'react';
import { Link2, Loader2, Notebook, Plus, Send, StickyNote, Trash2, Youtube } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import { toast } from '@/hooks/use-toast';
import { RichText } from '@/components/max/RichText';
import { ComposerToolbar } from '@/components/max/ComposerToolbar';
import { askMax, isPerplexityModel, streamMaxReply } from '@/services/max-chat-client';
import {
  DEFAULT_RESEARCH_MODEL,
  RESEARCH_TOOLS,
  buildResearchInstructions,
  parseResearchSources,
  stripSourcesSection,
} from '@/ai/agents/max-prompt';
import type { MaxChatMessage, MaxProject, MaxSourceItem, MaxSourceKind, MaxThread } from '@/services/max-store';

const KIND_ICON: Record<MaxSourceKind, typeof Link2> = { url: Link2, video: Youtube, note: StickyNote };

function guessKind(value: string): MaxSourceKind {
  const v = value.trim();
  if (/youtu\.?be/i.test(v)) return 'video';
  if (/^https?:\/\//i.test(v)) return 'url';
  return 'note';
}

export function ResearchPanel({
  thread,
  projects,
  onModelChange,
  onProjectIdsChange,
  onAddSource,
  onRemoveSource,
  onResearchExchange,
}: {
  thread: MaxThread;
  projects: MaxProject[];
  onModelChange: (model: string | undefined) => void;
  onProjectIdsChange: (ids: string[]) => void;
  /** Adds one manually-pasted source — page.tsx ensures/syncs the project. */
  onAddSource: (source: { kind: MaxSourceKind; label: string; value: string }) => void;
  onRemoveSource: (sourceId: string) => void;
  /**
   * page.tsx ensures/syncs the project and persists the exchange, plus any
   * sources Max cited in this answer — passed together so they're written
   * sequentially, not as two racing concurrent calls. Awaited (not
   * fire-and-forget) so `sending` only clears once the project/sources sync
   * has actually landed — see the same fix in MaxChat.tsx.
   */
  onResearchExchange: (
    messages: MaxChatMessage[],
    citedSources: { kind: MaxSourceKind; label: string; value: string }[]
  ) => Promise<void>;
}) {
  const [sourceInput, setSourceInput] = useState('');
  const [messages, setMessages] = useState<MaxChatMessage[]>(thread.researchMessages);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [statusText, setStatusText] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setMessages(thread.researchMessages);
  }, [thread.id]);

  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, statusText]);

  const attachedProjects = projects.filter((p) => thread.projectIds.includes(p.id));
  const syncTarget = attachedProjects[0] ?? null;

  function addSource() {
    const value = sourceInput.trim();
    if (!value) return;
    const kind = guessKind(value);
    const label = kind === 'note' ? value.slice(0, 60) : value.replace(/^https?:\/\//, '').slice(0, 60);
    onAddSource({ kind, label, value });
    setSourceInput('');
  }

  async function sendMessage() {
    if (!input.trim() || sending) return;

    const userMsg: MaxChatMessage = { role: 'user', content: input.trim(), createdAt: new Date().toISOString() };
    const priorHistory = messages;
    const nextMessages = [...messages, userMsg];
    setMessages(nextMessages);
    setInput('');
    setSending(true);
    setStatusText('Researching…');

    const effectiveModel = thread.model ?? DEFAULT_RESEARCH_MODEL;
    const history = priorHistory.map((m) => ({ role: m.role, content: m.content }));
    const instructions = buildResearchInstructions(thread.sources, attachedProjects);
    const existingUrls = new Set(thread.sources.map((s) => s.value));
    const dedupe = (candidates: { label: string; url: string }[]) => {
      const out: { kind: MaxSourceKind; label: string; value: string }[] = [];
      for (const c of candidates) {
        if (existingUrls.has(c.url)) continue;
        existingUrls.add(c.url);
        out.push({ kind: 'url', label: c.label, value: c.url });
      }
      return out;
    };

    try {
      let clean: string;
      let citedSources: { kind: MaxSourceKind; label: string; value: string }[];

      if (isPerplexityModel(effectiveModel)) {
        // Non-streaming: trades live typing for real, complete citations read
        // off Mesh's structured response, instead of hoping the model
        // remembers to format a source list into its own answer text.
        const { content, citations } = await askMax({ instructions, history, userMessage: userMsg.content, model: effectiveModel });
        clean = content;
        citedSources = dedupe(citations.map((c) => ({ label: c.title, url: c.url })));
      } else {
        let streamed = '';
        let gotText = false;
        const raw = await streamMaxReply({
          instructions,
          history,
          userMessage: userMsg.content,
          model: effectiveModel,
          tools: RESEARCH_TOOLS,
          onStatus: setStatusText,
          onDelta: (delta) => {
            if (!gotText) {
              gotText = true;
              setStatusText('');
            }
            streamed += delta;
            const preview = stripSourcesSection(streamed);
            setMessages([...nextMessages, { role: 'assistant', content: preview, createdAt: new Date().toISOString() }]);
          },
        });
        clean = stripSourcesSection(raw);
        citedSources = dedupe(parseResearchSources(raw));
      }

      const assistantMsg: MaxChatMessage = { role: 'assistant', content: clean, createdAt: new Date().toISOString() };
      setMessages([...nextMessages, assistantMsg]);

      // Both go through this one call so page.tsx can persist them
      // sequentially (add sources, then append the exchange) rather than as
      // two independent concurrent writes racing on the same thread record.
      await onResearchExchange([userMsg, assistantMsg], citedSources);
    } catch (err) {
      console.error(err);
      toast({ variant: 'destructive', title: 'Research failed', description: 'Check your Mesh API key and try again.' });
      setMessages(nextMessages);
    } finally {
      setSending(false);
      setStatusText('');
    }
  }

  return (
    <div className="flex-1 flex h-full min-w-0">
      {/* Sources rail */}
      <div className="w-80 shrink-0 border-r border-white/10 flex flex-col h-full">
        <div className="p-3 border-b border-white/10 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-micro font-semibold uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
              <Notebook className="h-3.5 w-3.5" />
              Sources ({thread.sources.length})
            </span>
          </div>
          <p className="text-micro text-slate-500">
            {syncTarget ? (
              <>
                Autosaving to <span className="text-primary font-medium">{syncTarget.name}</span>
              </>
            ) : (
              'A project will be created automatically on your first question.'
            )}
          </p>
          <div className="flex items-center gap-1.5">
            <Input
              placeholder="Paste a link, video URL, or note…"
              value={sourceInput}
              onChange={(e) => setSourceInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  addSource();
                }
              }}
              className="h-8 bg-white/5 border-white/10 text-white placeholder:text-slate-500 text-sm"
            />
            <Button size="icon" variant="outline" onClick={addSource} disabled={!sourceInput.trim()} className="h-8 w-8 shrink-0 border-white/10 bg-white/5 hover:bg-white/10">
              <Plus className="h-4 w-4" />
            </Button>
          </div>
        </div>
        <ScrollArea className="flex-1">
          <div className="p-3 space-y-1.5">
            {thread.sources.length === 0 && (
              <div className="px-2 py-6 text-center text-xs text-slate-500">
                Collect links, videos, or notes here — Max will research across all of them, and add his own sources too.
              </div>
            )}
            {thread.sources.map((s) => {
              const Icon = KIND_ICON[s.kind];
              return (
                <div key={s.id} className="group flex items-start gap-2 rounded-lg border border-white/10 bg-white/5 px-2.5 py-2 text-sm">
                  <Icon className="h-3.5 w-3.5 text-primary shrink-0 mt-0.5" />
                  <span className="flex-1 min-w-0 truncate text-slate-200">{s.label}</span>
                  <button
                    onClick={() => onRemoveSource(s.id)}
                    className="opacity-0 group-hover:opacity-100 text-slate-500 hover:text-red-400 shrink-0"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              );
            })}
          </div>
        </ScrollArea>
      </div>

      {/* Research Q&A */}
      <div className="flex-1 flex flex-col h-full min-w-0">
        <ScrollArea className="flex-1 p-6">
          <div className="max-w-3xl mx-auto space-y-4">
            {messages.length === 0 && (
              <div className="text-center py-16">
                <p className="text-slate-400 text-sm">
                  Ask about a topic, or add a few sources on the left first — Max will find patterns, summarize, or compare them.
                </p>
              </div>
            )}
            {messages.map((m, i) => (
              <div key={i} className={cn('flex', m.role === 'user' ? 'justify-end' : 'justify-start')}>
                <div
                  className={cn(
                    'max-w-[85%] rounded-2xl px-4 py-3 text-sm',
                    m.role === 'user'
                      ? 'bg-primary text-white whitespace-pre-wrap cc-glow'
                      : 'bg-white/5 border border-white/10 text-slate-200'
                  )}
                >
                  {m.role === 'user' ? m.content : <RichText content={m.content} />}
                </div>
              </div>
            ))}
            {sending && statusText && (
              <div className="flex justify-start">
                <div className="rounded-2xl border border-primary/20 bg-primary/10 px-4 py-3 flex items-center gap-2 text-sm text-primary">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  {statusText}
                </div>
              </div>
            )}
            <div ref={scrollRef} />
          </div>
        </ScrollArea>

        <div className="p-4 border-t border-white/10">
          <div className="max-w-3xl mx-auto rounded-2xl border border-white/10 bg-white/5 overflow-hidden focus-within:border-primary/40 transition-colors">
            <div className="px-3 pt-2.5">
              <ComposerToolbar
                model={thread.model}
                onModelChange={onModelChange}
                projects={projects}
                attachedProjectIds={thread.projectIds}
                onProjectIdsChange={onProjectIdsChange}
              />
            </div>
            <div className="flex items-end gap-2 p-3 pt-2">
              <Textarea
                placeholder="Ask about your sources — find patterns, summarize, compare…"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    sendMessage();
                  }
                }}
                className="min-h-[40px] max-h-32 resize-none bg-transparent border-none text-white placeholder:text-slate-500 focus-visible:ring-0 shadow-none"
              />
              <Button size="icon" onClick={sendMessage} disabled={sending || !input.trim()} className="shrink-0 cc-glow">
                <Send className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
