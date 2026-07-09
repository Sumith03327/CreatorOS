'use client';

import { useState, useEffect, useRef } from 'react';
import {
  Sparkles,
  Plus,
  Bot,
  FileText,
  Lightbulb,
  Wrench,
  Send,
  Loader2,
  Trash2,
  ChevronLeft,
  Youtube,
  Wand2,
  ArrowRight,
  Brain,
  Plug,
  RefreshCw,
  Check,
  Search,
} from 'lucide-react';
import { SidebarNav } from '@/components/dashboard/SidebarNav';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { ScrollArea } from '@/components/ui/scroll-area';
import { toast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { ThumbnailStudio } from '@/components/agents/ThumbnailStudio';
import { draftAgent } from '@/ai/flows/draft-agent';
import { updateAgentMemory } from '@/ai/flows/update-agent-memory';
import * as store from '@/services/agent-store';
import type { CustomAgent, ChatMessage } from '@/services/agent-store';
import { BUILTIN_AGENTS, type BuiltinAgent } from '@/ai/agents/builtin-agents';
import { getConnectorCatalog, getConnections, connectApp, searchApps } from './connection-actions';
import type { ToolkitInfo } from '@/services/composio';

// --- Types ---

type View = 'LIST' | 'CREATE' | 'CHAT' | 'STUDIO';

// --- Templates ---

const TEMPLATES = [
  {
    icon: FileText,
    category: 'Invoice Manager',
    name: 'Invoice Manager',
    description: 'Drafts and organizes invoices for brand deals and sponsorships.',
    instructions:
      "You are an Invoice Manager assistant for a YouTube creator's business. Help draft professional, itemized invoices for brand deals, sponsorships, and freelance work. When given a client name, work description, rate, and quantity/hours, produce a clean invoice with line items, subtotal, tax (ask if applicable), and total. Ask clarifying questions if key billing details are missing. Keep the tone professional and concise.",
    useYouTubeContext: false,
  },
  {
    icon: Lightbulb,
    category: 'Content Ideas',
    name: 'Content Idea Bot',
    description: 'Brainstorms new video ideas based on a channel or video.',
    instructions:
      "You are a Content Strategy assistant for YouTube creators. Given a channel's niche, a recent video, or YouTube context, brainstorm 5 new video ideas that build on what's working. For each idea, briefly explain why it fits the audience and suggest a hook angle for the opening 10 seconds.",
    useYouTubeContext: true,
  },
  {
    icon: Wrench,
    category: 'Custom',
    name: '',
    description: '',
    instructions: '',
    useYouTubeContext: false,
  },
];

// --- Lightweight markdown renderer (bold, headings, bullet/numbered lists) ---
// Avoids a dependency; handles the subset the models actually emit.

function renderInline(text: string, keyBase: string) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((p, i) =>
    /^\*\*[^*]+\*\*$/.test(p) ? (
      <strong key={`${keyBase}-${i}`}>{p.slice(2, -2)}</strong>
    ) : (
      <span key={`${keyBase}-${i}`}>{p}</span>
    )
  );
}

function RichText({ content }: { content: string }) {
  const lines = content.split('\n');
  return (
    <div className="space-y-1.5 leading-relaxed">
      {lines.map((line, i) => {
        const t = line.trim();
        if (!t) return <div key={i} className="h-1.5" />;
        if (/^---+$/.test(t)) return <hr key={i} className="my-2 border-white/10" />;
        const h = t.match(/^(#{1,4})\s+(.*)$/);
        if (h) {
          return (
            <div key={i} className={cn('font-bold text-white', h[1].length <= 2 ? 'text-base' : 'text-sm')}>
              {renderInline(h[2], `h${i}`)}
            </div>
          );
        }
        const bullet = t.match(/^[-*]\s+(.*)$/);
        if (bullet) {
          return (
            <div key={i} className="flex gap-2">
              <span className="text-primary/70 mt-0.5">•</span>
              <span>{renderInline(bullet[1], `b${i}`)}</span>
            </div>
          );
        }
        const num = t.match(/^(\d+)\.\s+(.*)$/);
        if (num) {
          return (
            <div key={i} className="flex gap-2">
              <span className="text-primary font-semibold">{num[1]}.</span>
              <span>{renderInline(num[2], `n${i}`)}</span>
            </div>
          );
        }
        return <div key={i}>{renderInline(t, `p${i}`)}</div>;
      })}
    </div>
  );
}

// Shared dark-input styling for the Command Center.
const CC_INPUT =
  'bg-white/5 border-white/10 text-white placeholder:text-slate-500 focus-visible:ring-primary/40';

export default function AgentsPage() {
  const [mounted, setMounted] = useState(false);
  const [view, setView] = useState<View>('LIST');
  const [agents, setAgents] = useState<CustomAgent[]>([]);
  const [activeAgent, setActiveAgent] = useState<CustomAgent | null>(null);

  // Create form state
  const [formName, setFormName] = useState('');
  const [formCategory, setFormCategory] = useState('Custom');
  const [formDescription, setFormDescription] = useState('');
  const [formInstructions, setFormInstructions] = useState('');
  const [formUseYouTube, setFormUseYouTube] = useState(false);

  // Hero "describe an agent" state
  const [heroInput, setHeroInput] = useState('');
  const [drafting, setDrafting] = useState(false);

  // Connections (Composio) state
  const [connectorsEnabled, setConnectorsEnabled] = useState(false);
  const [catalog, setCatalog] = useState<{ slug: string; name: string; logo: string }[]>([]);
  const [connStatus, setConnStatus] = useState<Record<string, string>>({});
  const [connecting, setConnecting] = useState<string | null>(null);
  // Browse the full Composio catalog (1,000+ apps)
  const [browseOpen, setBrowseOpen] = useState(false);
  const [appQuery, setAppQuery] = useState('');
  const [appResults, setAppResults] = useState<ToolkitInfo[]>([]);
  const [searchingApps, setSearchingApps] = useState(false);

  // Chat state
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [youtubeUrl, setYoutubeUrl] = useState('');
  const [sending, setSending] = useState(false);
  const [statusText, setStatusText] = useState('');
  const [showMemory, setShowMemory] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setMounted(true);
    store.listAgents().then(setAgents);
    // Load connector catalog + current connection statuses.
    getConnectorCatalog()
      .then(({ enabled, connectors }) => {
        setConnectorsEnabled(enabled);
        setCatalog(connectors);
        if (enabled) refreshConnections();
      })
      .catch(() => setConnectorsEnabled(false));
  }, []);

  async function refreshConnections() {
    try {
      const conns = await getConnections();
      const map: Record<string, string> = {};
      for (const c of conns) map[c.slug] = c.status;
      setConnStatus(map);
    } catch (e) {
      console.error('Failed to load connections:', e);
    }
  }

  async function handleConnect(slug: string) {
    setConnecting(slug);
    try {
      const { redirectUrl } = await connectApp(slug);
      // Open Composio's OAuth page; the user authorizes there.
      window.open(redirectUrl, '_blank', 'noopener,noreferrer');
      toast({ title: 'Authorize in the new tab', description: 'After you approve access, click Refresh here.' });
    } catch (err: any) {
      console.error(err);
      toast({ variant: 'destructive', title: 'Could not start connection', description: err?.message || 'Try again.' });
    } finally {
      setConnecting(null);
    }
  }

  // Debounced search over Composio's full catalog when the Browse panel is open.
  useEffect(() => {
    if (!browseOpen) return;
    let cancelled = false;
    setSearchingApps(true);
    const t = setTimeout(async () => {
      try {
        const results = await searchApps(appQuery);
        if (!cancelled) setAppResults(results);
      } catch {
        if (!cancelled) setAppResults([]);
      } finally {
        if (!cancelled) setSearchingApps(false);
      }
    }, 300);
    return () => { cancelled = true; clearTimeout(t); };
  }, [appQuery, browseOpen]);

  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  function resetForm() {
    setFormName('');
    setFormCategory('Custom');
    setFormDescription('');
    setFormInstructions('');
    setFormUseYouTube(false);
  }

  function applyTemplate(t: (typeof TEMPLATES)[number]) {
    setFormName(t.name);
    setFormCategory(t.category);
    setFormDescription(t.description);
    setFormInstructions(t.instructions);
    setFormUseYouTube(t.useYouTubeContext);
    setView('CREATE');
  }

  async function handleHeroDraft() {
    const idea = heroInput.trim();
    if (!idea || drafting) return;
    setDrafting(true);
    try {
      const draft = await draftAgent(idea);
      setFormName(draft.name);
      setFormCategory(draft.category || 'Custom');
      setFormDescription(draft.description);
      setFormInstructions(draft.instructions);
      setFormUseYouTube(draft.useYouTubeContext);
      setHeroInput('');
      setView('CREATE');
      toast({ title: 'Draft ready', description: 'Review and tweak your agent, then create it.' });
    } catch (err) {
      console.error(err);
      toast({ variant: 'destructive', title: 'Could not draft agent', description: 'Try rephrasing your idea.' });
    } finally {
      setDrafting(false);
    }
  }

  async function openBuiltin(b: BuiltinAgent) {
    if (b.action === 'STUDIO') {
      setView('STUDIO');
      return;
    }
    // CHAT built-in: run it through the normal chat loop with its own toolset/model.
    // Memory persists in-session; the thread persists by the built-in's stable id.
    const ephemeral: CustomAgent = {
      id: b.id,
      name: b.name,
      category: b.category,
      description: b.description,
      instructions: b.instructions ?? '',
      useYouTubeContext: false,
      tools: b.tools,
      connectors: b.connectors,
      skills: b.skills,
      model: b.model,
      memory: await store.getAgentMemory(b.id),
      createdAt: new Date().toISOString(),
    };
    openAgent(ephemeral);
  }

  async function handleCreateAgent() {
    if (!formName.trim() || !formInstructions.trim()) {
      toast({ variant: 'destructive', title: 'Missing info', description: 'Give your agent a name and instructions.' });
      return;
    }
    const newAgent = await store.createAgent({
      name: formName.trim(),
      category: formCategory,
      description: formDescription.trim(),
      instructions: formInstructions.trim(),
      useYouTubeContext: formUseYouTube,
    });
    setAgents(await store.listAgents());
    resetForm();
    toast({ title: 'Agent created', description: `${newAgent.name} is ready to use.` });
    openAgent(newAgent);
  }

  async function handleDeleteAgent(id: string) {
    await store.deleteAgent(id);
    setAgents(await store.listAgents());
    toast({ title: 'Agent deleted' });
  }

  async function openAgent(agent: CustomAgent) {
    // Load durable memory from its dedicated store (agent objects may not carry it).
    const memory = agent.memory ?? (await store.getAgentMemory(agent.id));
    setActiveAgent({ ...agent, memory });
    setMessages(await store.getThread(agent.id));
    setShowMemory(false);
    setYoutubeUrl('');
    setView('CHAT');
  }

  /** Distill durable memory from a conversation and persist it on the agent.
   *  Throttled to keep cost low: runs on the first exchange, then every 3rd
   *  user turn. Fully background — never blocks or breaks the chat. */
  async function refreshMemory(agent: CustomAgent, msgs: ChatMessage[]) {
    const userTurns = msgs.filter((m) => m.role === 'user').length;
    if (userTurns !== 1 && userTurns % 3 !== 0) return;
    try {
      const updated = await updateAgentMemory({ existingMemory: agent.memory ?? '', messages: msgs });
      if (updated === (agent.memory ?? '')) return;
      await store.setAgentMemory(agent.id, updated);
      setAgents((prev) => prev.map((a) => (a.id === agent.id ? { ...a, memory: updated } : a)));
      setActiveAgent((prev) => (prev && prev.id === agent.id ? { ...prev, memory: updated } : prev));
    } catch (e) {
      console.error('memory refresh failed (non-fatal):', e);
    }
  }

  async function handleClearMemory() {
    if (!activeAgent) return;
    await store.setAgentMemory(activeAgent.id, '');
    setAgents((prev) => prev.map((a) => (a.id === activeAgent.id ? { ...a, memory: '' } : a)));
    setActiveAgent((prev) => (prev ? { ...prev, memory: '' } : prev));
    toast({ title: 'Memory cleared', description: `${activeAgent.name} forgot what it knew about you.` });
  }

  async function sendMessage() {
    if (!activeAgent || !chatInput.trim() || sending) return;

    const agent = activeAgent;
    const userMsg: ChatMessage = { role: 'user', content: chatInput.trim() };
    const priorHistory = messages;
    const nextMessages = [...messages, userMsg];
    setMessages(nextMessages);
    setChatInput('');
    setSending(true);
    setStatusText('Thinking…');

    let assistant = '';
    let gotText = false;

    const applyAssistant = () =>
      setMessages([...nextMessages, { role: 'assistant', content: assistant }]);

    try {
      const res = await fetch('/api/agents/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          instructions: agent.instructions,
          history: priorHistory,
          userMessage: userMsg.content,
          memory: agent.memory,
          model: agent.model,
          tools: agent.tools,
          connectors: agent.connectors,
          skills: agent.skills,
          youtubeUrl: agent.useYouTubeContext ? youtubeUrl : undefined,
        }),
      });
      if (!res.ok || !res.body) throw new Error(`Request failed: ${res.status}`);

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      const handleEvent = (line: string) => {
        const trimmed = line.trim();
        if (!trimmed) return;
        let ev: { type: string; content: string };
        try {
          ev = JSON.parse(trimmed);
        } catch {
          return;
        }
        if (ev.type === 'status') {
          setStatusText(ev.content);
        } else if (ev.type === 'text') {
          if (!gotText) {
            gotText = true;
            setStatusText('');
          }
          assistant += ev.content;
          applyAssistant();
        } else if (ev.type === 'error') {
          throw new Error(ev.content);
        }
      };

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const line of lines) handleEvent(line);
      }
      if (buffer.trim()) handleEvent(buffer);

      const finalMessages: ChatMessage[] = [...nextMessages, { role: 'assistant', content: assistant }];
      setMessages(finalMessages);
      await store.saveThread(agent.id, finalMessages);
      // Distill durable memory in the background so the agent remembers the user
      // next time. Never blocks the UI; failures are non-fatal.
      refreshMemory(agent, finalMessages);
    } catch (err) {
      console.error(err);
      toast({ variant: 'destructive', title: 'Agent failed to respond', description: 'Check your Mesh API key and try again.' });
      // Drop the partial/empty assistant turn, keep the user's message.
      setMessages(nextMessages);
    } finally {
      setSending(false);
      setStatusText('');
    }
  }

  if (!mounted) return null;

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <SidebarNav />
      <main className="command-center relative flex-1 overflow-y-auto p-6 md:p-8">
        {view === 'LIST' && (
          <div className="relative z-10 max-w-6xl mx-auto space-y-12 animate-in fade-in">
            {/* Hero — describe an agent to build */}
            <section className="cc-card relative overflow-hidden p-8 md:p-10">
              <div className="cc-orb pointer-events-none absolute -top-24 -right-16 h-72 w-72 rounded-full" />
              <div className="relative space-y-5 max-w-2xl">
                <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[11px] font-medium tracking-wide text-slate-300 backdrop-blur">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 cc-dot" /> AGENT COMMAND CENTER
                </div>
                <h1 className="text-3xl md:text-[2.6rem] leading-[1.1] font-bold tracking-tight text-white">
                  Build any agent,{' '}
                  <span className="bg-gradient-to-r from-violet-300 via-fuchsia-300 to-indigo-300 bg-clip-text text-transparent">
                    just by describing it.
                  </span>
                </h1>
                <p className="text-slate-400 text-sm md:text-base max-w-xl">
                  Describe what you need — we draft the agent, its instructions, and its skills. Give it tools and real-app connections, and it goes to work.
                </p>
                <div className="flex flex-col sm:flex-row gap-2 rounded-2xl border border-white/10 bg-white/5 p-2 backdrop-blur focus-within:border-primary/50 transition-colors">
                  <Input
                    placeholder="e.g., an agent that reviews my titles for clickability"
                    value={heroInput}
                    onChange={(e) => setHeroInput(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') handleHeroDraft(); }}
                    className="border-none bg-transparent shadow-none focus-visible:ring-0 text-white placeholder:text-slate-500 flex-1 h-11"
                  />
                  <Button onClick={handleHeroDraft} disabled={drafting || !heroInput.trim()} className="h-11 gap-2 rounded-xl cc-glow">
                    {drafting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4" />}
                    {drafting ? 'Drafting…' : 'Build with AI'}
                  </Button>
                </div>
              </div>
            </section>

            {/* Built-in agents */}
            <section className="space-y-5">
              <div className="flex items-baseline justify-between">
                <h3 className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-widest text-slate-400">
                  <span className="h-3 w-0.5 rounded bg-primary" /> Built-in Agents
                </h3>
                <span className="text-[11px] text-slate-500 font-mono">{BUILTIN_AGENTS.length} agents · powered by your channel data</span>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
                {BUILTIN_AGENTS.map((b) => (
                  <div
                    key={b.id}
                    onClick={() => openBuiltin(b)}
                    className="cc-card cc-card-hover p-6 cursor-pointer group"
                  >
                    <div className="flex items-start justify-between">
                      <div className={cn('h-12 w-12 rounded-2xl flex items-center justify-center bg-gradient-to-br text-white cc-glow', b.gradient)}>
                        <b.icon className="h-6 w-6" />
                      </div>
                      {b.connectors?.length ? (
                        <span className="inline-flex items-center gap-1 rounded-full border border-cyan-400/30 bg-cyan-400/10 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-cyan-300">
                          <Plug className="h-3 w-3" /> Acts
                        </span>
                      ) : null}
                    </div>
                    <div className="mt-4 flex items-center gap-2">
                      <h4 className="font-semibold text-white">{b.name}</h4>
                    </div>
                    <span className="mt-1 inline-block text-[10px] font-mono uppercase tracking-wider text-slate-500">{b.category}</span>
                    <p className="mt-2 text-xs text-slate-400 leading-relaxed min-h-[2.5rem]">{b.description}</p>
                    <div className="mt-4 flex items-center gap-1 text-sm font-medium text-primary group-hover:gap-2 transition-all">
                      Open <ArrowRight className="h-4 w-4" />
                    </div>
                  </div>
                ))}
              </div>
            </section>

            {/* Connections (Composio) — the "act on real work" layer */}
            {connectorsEnabled && catalog.length > 0 && (
              <section className="space-y-5">
                <div className="flex items-center justify-between">
                  <h3 className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-widest text-slate-400">
                    <span className="h-3 w-0.5 rounded bg-cyan-400" /> Connections
                    <span className="ml-1 font-normal normal-case tracking-normal text-slate-500">let agents act on your real apps</span>
                  </h3>
                  <div className="flex items-center gap-1">
                    <Button variant="ghost" size="sm" onClick={() => setBrowseOpen((v) => !v)} className="gap-1.5 text-primary hover:text-violet-300 hover:bg-white/5">
                      <Search className="h-3.5 w-3.5" /> Browse 1,000+ apps
                    </Button>
                    <Button variant="ghost" size="sm" onClick={refreshConnections} className="gap-1.5 text-slate-400 hover:text-white hover:bg-white/5">
                      <RefreshCw className="h-3.5 w-3.5" /> Refresh
                    </Button>
                  </div>
                </div>

                {browseOpen && (
                  <div className="cc-card p-4 space-y-4 animate-in fade-in slide-in-from-top-1">
                    <div className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3">
                      <Search className="h-4 w-4 text-slate-400 shrink-0" />
                      <Input
                        autoFocus
                        placeholder="Search 1,000+ apps — Notion, Linear, Airtable, HubSpot, Discord…"
                        value={appQuery}
                        onChange={(e) => setAppQuery(e.target.value)}
                        className="border-none bg-transparent shadow-none focus-visible:ring-0 text-white placeholder:text-slate-500 h-10"
                      />
                      {searchingApps && <Loader2 className="h-4 w-4 animate-spin text-slate-400" />}
                    </div>
                    {appResults.length > 0 ? (
                      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2 max-h-80 overflow-y-auto pr-1">
                        {appResults.map((app) => {
                          const connected = connStatus[app.slug] === 'ACTIVE';
                          return (
                            <div key={app.slug} className="flex items-center gap-2.5 rounded-xl border border-white/10 bg-white/[0.03] p-2.5">
                              <div className="h-8 w-8 rounded-lg bg-white flex items-center justify-center overflow-hidden shrink-0">
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img src={app.logo} alt={app.name} className="h-5 w-5 object-contain" />
                              </div>
                              <div className="min-w-0 flex-1">
                                <p className="text-xs font-semibold text-slate-200 truncate">{app.name}</p>
                                {connected ? (
                                  <span className="inline-flex items-center gap-1 text-[10px] text-emerald-400">
                                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 cc-dot" /> Connected
                                  </span>
                                ) : app.managedAuth ? (
                                  <button
                                    onClick={() => handleConnect(app.slug)}
                                    disabled={connecting === app.slug}
                                    className="text-[11px] font-medium text-primary hover:text-violet-300 disabled:opacity-50"
                                  >
                                    {connecting === app.slug ? 'Opening…' : 'Connect'}
                                  </button>
                                ) : (
                                  <span className="text-[10px] text-slate-500">needs custom auth</span>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      !searchingApps && (
                        <p className="text-xs text-slate-500 text-center py-4">
                          {appQuery ? `No apps found for “${appQuery}”.` : 'Type to search Composio’s full catalog.'}
                        </p>
                      )
                    )}
                  </div>
                )}
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-3">
                  {catalog.map((c) => {
                    const status = connStatus[c.slug];
                    const connected = status === 'ACTIVE';
                    return (
                      <div key={c.slug} className={cn('cc-card p-4 flex flex-col items-center text-center gap-2', connected && 'border-emerald-400/30')}>
                        <div className="relative h-10 w-10 rounded-xl bg-white flex items-center justify-center overflow-hidden">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={c.logo} alt={c.name} className="h-6 w-6 object-contain" />
                          {connected && (
                            <span className="absolute -bottom-0.5 -right-0.5 h-4 w-4 rounded-full bg-emerald-500 border-2 border-[#12121e] flex items-center justify-center">
                              <Check className="h-2.5 w-2.5 text-white" />
                            </span>
                          )}
                        </div>
                        <p className="text-xs font-semibold text-slate-200">{c.name}</p>
                        {connected ? (
                          <span className="inline-flex items-center gap-1 text-[10px] font-medium text-emerald-400">
                            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 cc-dot" /> Connected
                          </span>
                        ) : (
                          <button
                            onClick={() => handleConnect(c.slug)}
                            disabled={connecting === c.slug}
                            className="text-[11px] font-medium text-primary hover:text-violet-300 disabled:opacity-50"
                          >
                            {connecting === c.slug ? 'Opening…' : 'Connect'}
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              </section>
            )}

            {/* Your agents */}
            <section className="space-y-5">
              <div className="flex items-center justify-between">
                <h3 className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-widest text-slate-400">
                  <span className="h-3 w-0.5 rounded bg-fuchsia-400" /> Your Agents
                </h3>
                <Button variant="ghost" size="sm" onClick={() => { resetForm(); setView('CREATE'); }} className="gap-1.5 text-primary hover:text-violet-300 hover:bg-white/5">
                  <Plus className="h-4 w-4" /> New agent
                </Button>
              </div>
              {agents.length > 0 ? (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
                  {agents.map((agent) => (
                    <div key={agent.id} className="cc-card cc-card-hover p-6 group relative">
                      <button
                        onClick={(e) => { e.stopPropagation(); handleDeleteAgent(agent.id); }}
                        className="absolute top-3 right-3 h-8 w-8 rounded-full bg-white/5 text-slate-500 hover:text-destructive hover:bg-destructive/15 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                      <div className="h-12 w-12 rounded-2xl bg-primary/15 border border-primary/20 flex items-center justify-center">
                        <Bot className="h-6 w-6 text-primary" />
                      </div>
                      <h4 className="mt-4 font-semibold text-white">{agent.name}</h4>
                      <span className="mt-1 inline-block text-[10px] font-mono uppercase tracking-wider text-slate-500">{agent.category}</span>
                      <p className="mt-2 text-xs text-slate-400 line-clamp-2 min-h-[2.5rem]">{agent.description || 'No description provided.'}</p>
                      <Button variant="outline" className="w-full mt-2 border-white/10 bg-white/5 text-slate-200 hover:bg-white/10 hover:text-white" onClick={() => openAgent(agent)}>Chat</Button>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="cc-card border-dashed p-10 text-center text-sm text-slate-500">
                  No agents yet — describe one above, or start from a template.
                </div>
              )}
            </section>

            {/* Templates */}
            <section className="space-y-5">
              <h3 className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-widest text-slate-400">
                <span className="h-3 w-0.5 rounded bg-slate-500" /> Quick Start Templates
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-4 gap-5">
                {TEMPLATES.map((t, i) => (
                  <div key={i} className="cc-card cc-card-hover border-dashed p-6 cursor-pointer" onClick={() => applyTemplate(t)}>
                    <div className="h-10 w-10 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center"><t.icon className="h-5 w-5 text-primary" /></div>
                    <h4 className="mt-3 font-semibold text-white">{t.name || 'Custom Agent'}</h4>
                    <p className="mt-1 text-xs text-slate-400">{t.description || 'Start from a blank agent.'}</p>
                  </div>
                ))}
              </div>
            </section>
          </div>
        )}

        {view === 'STUDIO' && <div className="relative z-10"><ThumbnailStudio onBack={() => setView('LIST')} /></div>}

        {view === 'CREATE' && (
          <div className="relative z-10 max-w-2xl mx-auto space-y-8 py-4 animate-in fade-in">
            <Button variant="ghost" className="gap-2 -ml-2 text-slate-300 hover:text-white hover:bg-white/5" onClick={() => setView('LIST')}><ChevronLeft className="h-4 w-4" /> Back</Button>
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-white">Build Your Agent</h1>
              <p className="text-slate-400 mt-1">Define what this agent does. It's powered by the Mesh API.</p>
            </div>

            <div className="cc-card p-6 space-y-5">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="agent-name" className="text-slate-300">Agent Name</Label>
                    <Input id="agent-name" placeholder="e.g., Invoice Manager" value={formName} onChange={(e) => setFormName(e.target.value)} className={CC_INPUT} />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="agent-category" className="text-slate-300">Category</Label>
                    <Input id="agent-category" placeholder="e.g., Finance, Design, Custom" value={formCategory} onChange={(e) => setFormCategory(e.target.value)} className={CC_INPUT} />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="agent-description" className="text-slate-300">Short Description</Label>
                  <Input id="agent-description" placeholder="What does this agent help with?" value={formDescription} onChange={(e) => setFormDescription(e.target.value)} className={CC_INPUT} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="agent-instructions" className="text-slate-300">Instructions (System Prompt)</Label>
                  <Textarea
                    id="agent-instructions"
                    placeholder="You are a... Help the user with... Always..."
                    className={cn('min-h-[160px]', CC_INPUT)}
                    value={formInstructions}
                    onChange={(e) => setFormInstructions(e.target.value)}
                  />
                </div>
                <div className="flex items-center justify-between p-4 bg-white/5 border border-white/10 rounded-xl">
                  <div className="flex items-center gap-3">
                    <Youtube className="h-5 w-5 text-red-500" />
                    <div>
                      <p className="text-sm font-semibold text-slate-200">Enable YouTube Context</p>
                      <p className="text-xs text-slate-400">Lets this agent pull a video or channel's data into the conversation.</p>
                    </div>
                  </div>
                  <Switch checked={formUseYouTube} onCheckedChange={setFormUseYouTube} />
                </div>
                <Button className="w-full gap-2 cc-glow" onClick={handleCreateAgent}>
                  <Sparkles className="h-4 w-4" /> Create Agent
                </Button>
            </div>
          </div>
        )}

        {view === 'CHAT' && activeAgent && (
          <div className="relative z-10 max-w-3xl mx-auto h-full flex flex-col py-2 animate-in fade-in">
            <div className="flex items-center gap-4 mb-4">
              <Button variant="ghost" size="icon" onClick={() => setView('LIST')} className="text-slate-300 hover:text-white hover:bg-white/5"><ChevronLeft className="h-5 w-5" /></Button>
              <div className="h-10 w-10 rounded-xl bg-primary/15 border border-primary/20 flex items-center justify-center shrink-0"><Bot className="h-5 w-5 text-primary" /></div>
              <div>
                <h2 className="font-semibold text-white leading-tight">{activeAgent.name}</h2>
                <span className="text-[10px] font-mono uppercase tracking-wider text-slate-500">{activeAgent.category}</span>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowMemory((v) => !v)}
                className={cn('ml-auto gap-1.5 text-xs border', activeAgent.memory ? 'border-primary/40 bg-primary/10 text-primary' : 'border-white/10 text-slate-400 hover:text-white hover:bg-white/5')}
                title="What this agent remembers about you"
              >
                <Brain className="h-4 w-4" />
                Memory
              </Button>
            </div>

            {showMemory && (
              <div className="cc-card mb-4 p-4 space-y-2 animate-in fade-in slide-in-from-top-1">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-semibold text-slate-200 flex items-center gap-1.5">
                    <Brain className="h-3.5 w-3.5 text-primary" /> What {activeAgent.name} remembers about you
                  </p>
                  {activeAgent.memory && (
                    <button onClick={handleClearMemory} className="text-[11px] text-slate-400 hover:text-destructive font-medium">
                      Clear
                    </button>
                  )}
                </div>
                {activeAgent.memory ? (
                  <p className="text-xs text-slate-300 whitespace-pre-wrap leading-relaxed">{activeAgent.memory}</p>
                ) : (
                  <p className="text-xs text-slate-500">
                    Nothing yet. As you chat, this agent automatically remembers durable facts about you and your channel — and uses them in future conversations.
                  </p>
                )}
              </div>
            )}

            {activeAgent.useYouTubeContext && (
              <div className="mb-4">
                <div className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-4 py-2">
                  <Youtube className="h-4 w-4 text-red-500 shrink-0" />
                  <Input
                    placeholder="Paste a YouTube video or channel URL (optional context)"
                    value={youtubeUrl}
                    onChange={(e) => setYoutubeUrl(e.target.value)}
                    className="border-none bg-transparent shadow-none focus-visible:ring-0 h-8 px-0 text-white placeholder:text-slate-500"
                  />
                </div>
              </div>
            )}

            <div className="cc-card flex-1 overflow-hidden flex flex-col">
              <ScrollArea className="flex-1 p-6">
                <div className="space-y-4">
                  {messages.length === 0 && (
                    <div className="text-center py-12 text-sm text-slate-500">
                      Send a message to start working with {activeAgent.name}.
                    </div>
                  )}
                  {messages.map((m, i) => (
                    <div key={i} className={cn('flex', m.role === 'user' ? 'justify-end' : 'justify-start')}>
                      <div
                        className={cn(
                          'max-w-[80%] rounded-2xl px-4 py-3 text-sm',
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
              <div className="p-4 border-t border-white/10 flex items-center gap-2">
                <Textarea
                  placeholder="Message your agent..."
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      sendMessage();
                    }
                  }}
                  className={cn('min-h-[44px] max-h-32 resize-none', CC_INPUT)}
                />
                <Button size="icon" onClick={sendMessage} disabled={sending || !chatInput.trim()} className="shrink-0 cc-glow">
                  <Send className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
