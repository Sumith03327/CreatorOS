'use client';

import { useState, useEffect, useRef } from 'react';
import {
  Sparkles,
  Plus,
  Bot,
  FileText,
  Image as ImageIcon,
  Lightbulb,
  Wrench,
  Send,
  Loader2,
  Trash2,
  ChevronLeft,
  Youtube,
  Wand2,
  ArrowRight,
} from 'lucide-react';
import { SidebarNav } from '@/components/dashboard/SidebarNav';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { ScrollArea } from '@/components/ui/scroll-area';
import { toast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { ThumbnailStudio } from '@/components/agents/ThumbnailStudio';
import { draftAgent } from '@/ai/flows/draft-agent';
import { updateAgentMemory } from '@/ai/flows/update-agent-memory';
import * as store from '@/services/agent-store';
import type { CustomAgent, ChatMessage } from '@/services/agent-store';

// --- Types ---

type View = 'LIST' | 'CREATE' | 'CHAT' | 'STUDIO';

// --- Built-in agents (first-party, pinned in the hub) ---

const BUILTIN_AGENTS = [
  {
    id: 'thumbnail-studio',
    name: 'Thumbnail Studio',
    category: 'Design',
    description: "Reads your channel's style, asks a few questions, and designs real thumbnails.",
    icon: ImageIcon,
    gradient: 'from-fuchsia-500 to-indigo-500',
    action: 'STUDIO' as const,
  },
];

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
        if (/^---+$/.test(t)) return <hr key={i} className="my-2 border-slate-200" />;
        const h = t.match(/^(#{1,4})\s+(.*)$/);
        if (h) {
          return (
            <div key={i} className={cn('font-bold text-slate-900', h[1].length <= 2 ? 'text-base' : 'text-sm')}>
              {renderInline(h[2], `h${i}`)}
            </div>
          );
        }
        const bullet = t.match(/^[-*]\s+(.*)$/);
        if (bullet) {
          return (
            <div key={i} className="flex gap-2">
              <span className="text-slate-400 mt-0.5">•</span>
              <span>{renderInline(bullet[1], `b${i}`)}</span>
            </div>
          );
        }
        const num = t.match(/^(\d+)\.\s+(.*)$/);
        if (num) {
          return (
            <div key={i} className="flex gap-2">
              <span className="text-slate-500 font-medium">{num[1]}.</span>
              <span>{renderInline(num[2], `n${i}`)}</span>
            </div>
          );
        }
        return <div key={i}>{renderInline(t, `p${i}`)}</div>;
      })}
    </div>
  );
}

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

  // Chat state
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [youtubeUrl, setYoutubeUrl] = useState('');
  const [sending, setSending] = useState(false);
  const [statusText, setStatusText] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setMounted(true);
    store.listAgents().then(setAgents);
  }, []);

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

  function openBuiltin(b: (typeof BUILTIN_AGENTS)[number]) {
    if (b.action === 'STUDIO') setView('STUDIO');
  }

  function handleCreateAgent() {
    if (!formName.trim() || !formInstructions.trim()) {
      toast({ variant: 'destructive', title: 'Missing info', description: 'Give your agent a name and instructions.' });
      return;
    }
    const newAgent: CustomAgent = {
      id: Math.random().toString(36).slice(2),
      name: formName.trim(),
      category: formCategory,
      description: formDescription.trim(),
      instructions: formInstructions.trim(),
      useYouTubeContext: formUseYouTube,
      createdAt: new Date().toISOString(),
    };
    const updated = [newAgent, ...agents];
    setAgents(updated);
    saveAgents(updated);
    resetForm();
    toast({ title: 'Agent created', description: `${newAgent.name} is ready to use.` });
    openAgent(newAgent);
  }

  function deleteAgent(id: string) {
    const updated = agents.filter((a) => a.id !== id);
    setAgents(updated);
    saveAgents(updated);
    localStorage.removeItem(chatKey(id));
    toast({ title: 'Agent deleted' });
  }

  function openAgent(agent: CustomAgent) {
    setActiveAgent(agent);
    const saved = localStorage.getItem(chatKey(agent.id));
    setMessages(saved ? JSON.parse(saved) : []);
    setYoutubeUrl('');
    setView('CHAT');
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
      localStorage.setItem(chatKey(agent.id), JSON.stringify(finalMessages));
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
      <main className="flex-1 overflow-y-auto p-8">
        {view === 'LIST' && (
          <div className="max-w-6xl mx-auto space-y-10 animate-in fade-in">
            {/* Hero — describe an agent to build */}
            <section className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-indigo-600 via-violet-600 to-fuchsia-600 p-8 md:p-10 text-white shadow-lg">
              <div className="absolute -top-16 -right-16 h-56 w-56 rounded-full bg-white/10 blur-2xl" />
              <div className="relative space-y-5 max-w-2xl">
                <div className="inline-flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-1 text-xs font-medium backdrop-blur">
                  <Sparkles className="h-3.5 w-3.5" /> Agent Command Center
                </div>
                <h1 className="text-3xl md:text-4xl font-bold tracking-tight">Build any agent, just by describing it.</h1>
                <p className="text-white/80 text-sm md:text-base">
                  Tell us what you need — we’ll draft the agent, its instructions, and its skills. Or start from a template below.
                </p>
                <div className="flex flex-col sm:flex-row gap-2 bg-white rounded-2xl p-2 shadow-sm">
                  <Input
                    placeholder="e.g., an agent that reviews my titles for clickability"
                    value={heroInput}
                    onChange={(e) => setHeroInput(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') handleHeroDraft(); }}
                    className="border-none shadow-none focus-visible:ring-0 text-slate-900 flex-1 h-11"
                  />
                  <Button onClick={handleHeroDraft} disabled={drafting || !heroInput.trim()} className="h-11 gap-2 rounded-xl">
                    {drafting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4" />}
                    {drafting ? 'Drafting…' : 'Build with AI'}
                  </Button>
                </div>
              </div>
            </section>

            {/* Built-in agents */}
            <section className="space-y-4">
              <h3 className="text-[11px] font-bold uppercase tracking-widest text-slate-500">Built-in Agents</h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                {BUILTIN_AGENTS.map((b) => (
                  <Card
                    key={b.id}
                    onClick={() => openBuiltin(b)}
                    className="border-none shadow-sm hover:shadow-xl hover:-translate-y-0.5 transition-all cursor-pointer group overflow-hidden"
                  >
                    <CardContent className="p-6 space-y-4">
                      <div className={cn('h-12 w-12 rounded-2xl flex items-center justify-center bg-gradient-to-br text-white', b.gradient)}>
                        <b.icon className="h-6 w-6" />
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <h4 className="font-bold text-slate-900">{b.name}</h4>
                          <Badge className="text-[9px] bg-primary/10 text-primary hover:bg-primary/10">BUILT-IN</Badge>
                        </div>
                        <Badge variant="outline" className="text-[10px] mt-1 uppercase">{b.category}</Badge>
                      </div>
                      <p className="text-xs text-slate-500 min-h-[2.5rem]">{b.description}</p>
                      <div className="flex items-center gap-1 text-sm font-medium text-primary group-hover:gap-2 transition-all">
                        Open <ArrowRight className="h-4 w-4" />
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </section>

            {/* Your agents */}
            <section className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-[11px] font-bold uppercase tracking-widest text-slate-500">Your Agents</h3>
                <Button variant="ghost" size="sm" onClick={() => { resetForm(); setView('CREATE'); }} className="gap-1.5 text-primary">
                  <Plus className="h-4 w-4" /> New agent
                </Button>
              </div>
              {agents.length > 0 ? (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  {agents.map((agent) => (
                    <Card key={agent.id} className="border-none shadow-sm hover:shadow-lg transition-all group relative">
                      <CardContent className="p-6 space-y-4">
                        <button
                          onClick={(e) => { e.stopPropagation(); deleteAgent(agent.id); }}
                          className="absolute top-3 right-3 h-8 w-8 rounded-full bg-slate-50 text-slate-400 hover:text-destructive hover:bg-destructive/10 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                        <div className="h-12 w-12 rounded-2xl bg-primary/10 flex items-center justify-center">
                          <Bot className="h-6 w-6 text-primary" />
                        </div>
                        <div>
                          <h4 className="font-bold text-slate-900">{agent.name}</h4>
                          <Badge variant="outline" className="text-[10px] mt-1 uppercase">{agent.category}</Badge>
                        </div>
                        <p className="text-xs text-slate-500 line-clamp-2 min-h-[2.5rem]">{agent.description || 'No description provided.'}</p>
                        <Button variant="outline" className="w-full" onClick={() => openAgent(agent)}>Chat</Button>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              ) : (
                <Card className="border-2 border-dashed shadow-none">
                  <CardContent className="p-10 text-center text-sm text-slate-400">
                    No agents yet — describe one above, or start from a template.
                  </CardContent>
                </Card>
              )}
            </section>

            {/* Templates */}
            <section className="space-y-4">
              <h3 className="text-[11px] font-bold uppercase tracking-widest text-slate-500">Quick Start Templates</h3>
              <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
                {TEMPLATES.map((t, i) => (
                  <Card key={i} className="border-dashed border-2 hover:border-primary/50 cursor-pointer transition-all" onClick={() => applyTemplate(t)}>
                    <CardContent className="p-6 space-y-3">
                      <div className="h-10 w-10 rounded-xl bg-primary/10 flex items-center justify-center"><t.icon className="h-5 w-5 text-primary" /></div>
                      <h4 className="font-bold">{t.name || 'Custom Agent'}</h4>
                      <p className="text-xs text-slate-500">{t.description || 'Start from a blank agent.'}</p>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </section>
          </div>
        )}

        {view === 'STUDIO' && <ThumbnailStudio onBack={() => setView('LIST')} />}

        {view === 'CREATE' && (
          <div className="max-w-2xl mx-auto space-y-8 py-4 animate-in fade-in">
            <Button variant="ghost" className="gap-2 -ml-2" onClick={() => setView('LIST')}><ChevronLeft className="h-4 w-4" /> Back</Button>
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-slate-900">Build Your Agent</h1>
              <p className="text-muted-foreground mt-1">Define what this agent does. It's powered by the Mesh API.</p>
            </div>

            <Card className="border-none shadow-sm">
              <CardContent className="p-6 space-y-5">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="agent-name">Agent Name</Label>
                    <Input id="agent-name" placeholder="e.g., Invoice Manager" value={formName} onChange={(e) => setFormName(e.target.value)} />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="agent-category">Category</Label>
                    <Input id="agent-category" placeholder="e.g., Finance, Design, Custom" value={formCategory} onChange={(e) => setFormCategory(e.target.value)} />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="agent-description">Short Description</Label>
                  <Input id="agent-description" placeholder="What does this agent help with?" value={formDescription} onChange={(e) => setFormDescription(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="agent-instructions">Instructions (System Prompt)</Label>
                  <Textarea
                    id="agent-instructions"
                    placeholder="You are a... Help the user with... Always..."
                    className="min-h-[160px]"
                    value={formInstructions}
                    onChange={(e) => setFormInstructions(e.target.value)}
                  />
                </div>
                <div className="flex items-center justify-between p-4 bg-slate-50 rounded-xl">
                  <div className="flex items-center gap-3">
                    <Youtube className="h-5 w-5 text-red-500" />
                    <div>
                      <p className="text-sm font-bold">Enable YouTube Context</p>
                      <p className="text-xs text-slate-500">Lets this agent pull a video or channel's data into the conversation.</p>
                    </div>
                  </div>
                  <Switch checked={formUseYouTube} onCheckedChange={setFormUseYouTube} />
                </div>
                <Button className="w-full gap-2" onClick={handleCreateAgent}>
                  <Sparkles className="h-4 w-4" /> Create Agent
                </Button>
              </CardContent>
            </Card>
          </div>
        )}

        {view === 'CHAT' && activeAgent && (
          <div className="max-w-3xl mx-auto h-full flex flex-col py-4 animate-in fade-in">
            <div className="flex items-center gap-4 mb-6">
              <Button variant="ghost" size="icon" onClick={() => setView('LIST')}><ChevronLeft className="h-5 w-5" /></Button>
              <div className="h-10 w-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0"><Bot className="h-5 w-5 text-primary" /></div>
              <div>
                <h2 className="font-bold text-slate-900">{activeAgent.name}</h2>
                <Badge variant="outline" className="text-[10px] uppercase">{activeAgent.category}</Badge>
              </div>
            </div>

            {activeAgent.useYouTubeContext && (
              <div className="mb-4">
                <div className="flex items-center gap-2 bg-slate-50 rounded-xl px-4 py-2">
                  <Youtube className="h-4 w-4 text-red-500 shrink-0" />
                  <Input
                    placeholder="Paste a YouTube video or channel URL (optional context)"
                    value={youtubeUrl}
                    onChange={(e) => setYoutubeUrl(e.target.value)}
                    className="border-none bg-transparent shadow-none focus-visible:ring-0 h-8 px-0"
                  />
                </div>
              </div>
            )}

            <Card className="flex-1 border-none shadow-sm overflow-hidden flex flex-col">
              <ScrollArea className="flex-1 p-6">
                <div className="space-y-4">
                  {messages.length === 0 && (
                    <div className="text-center py-12 text-sm text-slate-400">
                      Send a message to start working with {activeAgent.name}.
                    </div>
                  )}
                  {messages.map((m, i) => (
                    <div key={i} className={cn('flex', m.role === 'user' ? 'justify-end' : 'justify-start')}>
                      <div
                        className={cn(
                          'max-w-[80%] rounded-2xl px-4 py-3 text-sm',
                          m.role === 'user' ? 'bg-primary text-white whitespace-pre-wrap' : 'bg-slate-100 text-slate-800'
                        )}
                      >
                        {m.role === 'user' ? m.content : <RichText content={m.content} />}
                      </div>
                    </div>
                  ))}
                  {sending && statusText && (
                    <div className="flex justify-start">
                      <div className="bg-slate-100 rounded-2xl px-4 py-3 flex items-center gap-2 text-sm text-slate-500">
                        <Loader2 className="h-4 w-4 animate-spin text-slate-400" />
                        {statusText}
                      </div>
                    </div>
                  )}
                  <div ref={scrollRef} />
                </div>
              </ScrollArea>
              <div className="p-4 border-t flex items-center gap-2">
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
                  className="min-h-[44px] max-h-32 resize-none"
                />
                <Button size="icon" onClick={sendMessage} disabled={sending || !chatInput.trim()} className="shrink-0">
                  <Send className="h-4 w-4" />
                </Button>
              </div>
            </Card>
          </div>
        )}
      </main>
    </div>
  );
}
