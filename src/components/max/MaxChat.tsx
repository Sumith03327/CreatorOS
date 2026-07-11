'use client';

/**
 * The Write tab for Script & Analyses: message list + a single composer
 * card (toolbar docked above the textarea, not a detached header bar).
 * Streams against /api/agents/chat via the shared streamMaxReply client —
 * Max is just a system prompt + tool subset over the "My Agents" loop.
 */

import { useEffect, useRef, useState } from 'react';
import { Loader2, Send } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import { toast } from '@/hooks/use-toast';
import { SendToMenu } from '@/components/agents/SendToMenu';
import { RichText } from '@/components/max/RichText';
import { ComposerToolbar } from '@/components/max/ComposerToolbar';
import { streamMaxReply } from '@/services/max-chat-client';
import { MAX_TOOLS, buildMaxInstructions } from '@/ai/agents/max-prompt';
import type { MaxChatMessage, MaxProject, MaxThread } from '@/services/max-store';

const CC_INPUT = 'bg-transparent border-none text-white placeholder:text-slate-500 focus-visible:ring-0 shadow-none';

export function MaxChat({
  thread,
  projects,
  onModelChange,
  onProjectIdsChange,
  onExchange,
}: {
  thread: MaxThread;
  /** All saved projects, so attached ids can be resolved to names/content. */
  projects: MaxProject[];
  onModelChange: (model: string | undefined) => void;
  onProjectIdsChange: (ids: string[]) => void;
  /** Called with the completed [user, assistant] pair once a reply finishes streaming. */
  onExchange: (messages: MaxChatMessage[]) => void;
}) {
  const [messages, setMessages] = useState<MaxChatMessage[]>(thread.messages);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [statusText, setStatusText] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setMessages(thread.messages);
  }, [thread.id]);

  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, statusText]);

  const attachedProjects = projects.filter((p) => thread.projectIds.includes(p.id));

  async function sendMessage() {
    if (!input.trim() || sending) return;

    const userMsg: MaxChatMessage = { role: 'user', content: input.trim(), createdAt: new Date().toISOString() };
    const priorHistory = messages;
    const nextMessages = [...messages, userMsg];
    setMessages(nextMessages);
    setInput('');
    setSending(true);
    setStatusText('Thinking…');

    let streamed = '';
    let gotText = false;

    try {
      const assistant = await streamMaxReply({
        instructions: buildMaxInstructions(attachedProjects),
        history: priorHistory.map((m) => ({ role: m.role, content: m.content })),
        userMessage: userMsg.content,
        model: thread.model,
        tools: MAX_TOOLS,
        onStatus: setStatusText,
        onDelta: (delta) => {
          if (!gotText) {
            gotText = true;
            setStatusText('');
          }
          streamed += delta;
          setMessages([...nextMessages, { role: 'assistant', content: streamed, createdAt: new Date().toISOString() }]);
        },
      });
      const assistantMsg: MaxChatMessage = { role: 'assistant', content: assistant, createdAt: new Date().toISOString() };
      setMessages([...nextMessages, assistantMsg]);
      onExchange([userMsg, assistantMsg]);
    } catch (err) {
      console.error(err);
      toast({ variant: 'destructive', title: 'Max failed to respond', description: 'Check your Mesh API key and try again.' });
      setMessages(nextMessages);
    } finally {
      setSending(false);
      setStatusText('');
    }
  }

  return (
    <div className="flex-1 flex flex-col h-full min-w-0">
      <ScrollArea className="flex-1 p-6">
        <div className="max-w-3xl mx-auto space-y-4">
          {messages.length === 0 && (
            <div className="text-center py-16">
              <p className="text-slate-400 text-sm">
                Paste a video URL to analyze it, drop in a script for feedback, or describe a topic and let Max write it.
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
                    : 'bg-white/5 border border-white/10 text-slate-200 space-y-2'
                )}
              >
                {m.role === 'user' ? (
                  m.content
                ) : (
                  <>
                    <RichText content={m.content} />
                    {m.content.trim() && (
                      <div className="pt-1 flex justify-end">
                        <SendToMenu title={thread.title} body={m.content} kinds={['doc', 'email', 'file']} />
                      </div>
                    )}
                  </>
                )}
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
              placeholder="Message Max — analyze a video, paste a script, or describe what to write…"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  sendMessage();
                }
              }}
              className={cn('min-h-[40px] max-h-32 resize-none', CC_INPUT)}
            />
            <Button size="icon" onClick={sendMessage} disabled={sending || !input.trim()} className="shrink-0 cc-glow">
              <Send className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
