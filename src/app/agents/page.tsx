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
import { runCustomAgent } from '@/ai/flows/run-custom-agent-flow';
import { cn } from '@/lib/utils';

// --- Types ---

interface CustomAgent {
  id: string;
  name: string;
  category: string;
  description: string;
  instructions: string;
  useYouTubeContext: boolean;
  createdAt: string;
}

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

type View = 'LIST' | 'CREATE' | 'CHAT';

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
    icon: ImageIcon,
    category: 'Thumbnail Maker',
    name: 'Thumbnail Maker',
    description: 'Generates high-CTR thumbnail concepts and text overlays.',
    instructions:
      'You are a Thumbnail Maker assistant for YouTube creators. Given a video title, topic, or YouTube context, generate 3-5 high-CTR thumbnail concepts (describe the visual composition, facial expression, and contrast) plus punchy 2-4 word text overlay options for each. Focus on curiosity, contrast, and emotion. You do not generate actual images — only concepts and text ideas the creator can hand to a designer or an AI image tool.',
    useYouTubeContext: true,
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

// --- Helpers ---

const AGENTS_KEY = 'creator-hub-agents';
const chatKey = (id: string) => `creator-hub-agent-chat-${id}`;

function loadAgents(): CustomAgent[] {
  const saved = localStorage.getItem(AGENTS_KEY);
  return saved ? JSON.parse(saved) : [];
}

function saveAgents(agents: CustomAgent[]) {
  localStorage.setItem(AGENTS_KEY, JSON.stringify(agents));
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

  // Chat state
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [youtubeUrl, setYoutubeUrl] = useState('');
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setMounted(true);
    setAgents(loadAgents());
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

    const userMsg: ChatMessage = { role: 'user', content: chatInput.trim() };
    const nextMessages = [...messages, userMsg];
    setMessages(nextMessages);
    setChatInput('');
    setSending(true);

    try {
      const reply = await runCustomAgent({
        instructions: activeAgent.instructions,
        history: messages,
        userMessage: userMsg.content,
        youtubeUrl: activeAgent.useYouTubeContext ? youtubeUrl : undefined,
      });
      const finalMessages: ChatMessage[] = [...nextMessages, { role: 'assistant', content: reply }];
      setMessages(finalMessages);
      localStorage.setItem(chatKey(activeAgent.id), JSON.stringify(finalMessages));
    } catch (err) {
      console.error(err);
      toast({ variant: 'destructive', title: 'Agent failed to respond', description: 'Check your Mesh API key and try again.' });
      setMessages(nextMessages);
    } finally {
      setSending(false);
    }
  }

  if (!mounted) return null;

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <SidebarNav />
      <main className="flex-1 overflow-y-auto p-8">
        {view === 'LIST' && (
          <div className="space-y-10 animate-in fade-in">
            <header className="flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div>
                <h1 className="text-3xl font-bold tracking-tight text-slate-900">My Agents</h1>
                <p className="text-muted-foreground mt-1">Build your own AI agents for invoices, thumbnails, and anything else.</p>
              </div>
              <Button onClick={() => { resetForm(); setView('CREATE'); }} className="rounded-full gap-2">
                <Plus className="h-4 w-4" /> Build Your Agent
              </Button>
            </header>

            {agents.length > 0 && (
              <section className="space-y-4">
                <h3 className="text-[11px] font-bold uppercase tracking-widest text-slate-500">Your Agents</h3>
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
              </section>
            )}

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
                          'max-w-[80%] rounded-2xl px-4 py-3 text-sm whitespace-pre-wrap',
                          m.role === 'user' ? 'bg-primary text-white' : 'bg-slate-100 text-slate-800'
                        )}
                      >
                        {m.content}
                      </div>
                    </div>
                  ))}
                  {sending && (
                    <div className="flex justify-start">
                      <div className="bg-slate-100 rounded-2xl px-4 py-3"><Loader2 className="h-4 w-4 animate-spin text-slate-400" /></div>
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
