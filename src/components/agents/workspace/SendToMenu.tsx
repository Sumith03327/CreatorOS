'use client';

/**
 * "Send to" — pushes a workspace's deliverable into the creator's real apps.
 *
 * Rather than hardcoding Composio tool slugs (which drift, and which we'd be
 * guessing at), this runs a tiny DELIVERY AGENT: it gets the connector's tools
 * and picks the right one itself. That reuses the whole agent loop, and it
 * degrades honestly — if an app isn't connected, the loop says so instead of
 * failing.
 *
 * Only apps the user has actually connected are offered.
 */

import { useEffect, useState } from 'react';
import { Send, Loader2, Check, ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { toast } from '@/hooks/use-toast';
import { getConnectorCatalog, getConnections } from '@/app/agents/connection-actions';

interface App {
  slug: string;
  name: string;
  logo: string;
}

/** What "save this" means for each app. Keep it non-destructive: drafts, not sends. */
const DELIVERY_VERB: Record<string, string> = {
  gmail:
    'Create a DRAFT email addressed to the authenticated user (their own address). Do NOT send it. Put the title in the subject.',
  googledocs: 'Create a new Google Doc titled with the given title, containing the content.',
  googlesheets:
    'Create a new spreadsheet titled with the given title, and write the content into it as rows — one row per item, with a sensible header row.',
  notion: 'Create a new Notion page titled with the given title, containing the content.',
  slack: 'Post the content as a message to the user’s Slack, formatted readably.',
  googlecalendar: 'Create calendar events for any dated items in the content.',
};

export function SendToMenu({ title, body }: { title: string; body: string }) {
  const [apps, setApps] = useState<App[]>([]);
  const [sending, setSending] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<Set<string>>(new Set());

  useEffect(() => {
    (async () => {
      try {
        const [{ enabled, connectors }, conns] = await Promise.all([getConnectorCatalog(), getConnections()]);
        if (!enabled) return;
        const active = new Set(conns.filter((c) => c.status === 'ACTIVE').map((c) => c.slug));
        setApps(connectors.filter((c) => active.has(c.slug) && DELIVERY_VERB[c.slug]));
      } catch {
        setApps([]);
      }
    })();
  }, []);

  async function deliver(app: App) {
    setSending(app.slug);
    try {
      const res = await fetch('/api/agents/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          instructions:
            `You are a delivery agent with tools for ${app.name}. ${DELIVERY_VERB[app.slug]} ` +
            `Use exactly one tool call, then reply with ONE short sentence confirming what you created, including any link or id the tool returned. ` +
            `If the tool fails, say plainly what went wrong.`,
          userMessage: `Title: ${title}\n\nContent:\n${body}`,
          connectors: [app.slug],
          tools: [],
          history: [],
        }),
      });
      if (!res.ok || !res.body) throw new Error(`Request failed (${res.status})`);

      // Drain the NDJSON stream; we only care about the final confirmation text.
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let confirmation = '';
      const handle = (line: string) => {
        const t = line.trim();
        if (!t) return;
        let ev: { type: string; content?: string };
        try {
          ev = JSON.parse(t);
        } catch {
          return;
        }
        if (ev.type === 'text') confirmation += ev.content ?? '';
        else if (ev.type === 'error') throw new Error(ev.content ?? 'Delivery failed');
      };
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const l of lines) handle(l);
      }
      if (buffer.trim()) handle(buffer);

      const msg = confirmation.trim();
      // The agent reports its own failures rather than throwing; surface them honestly.
      const failed = /tool failed|could not|not connected|went wrong/i.test(msg);
      if (failed || !msg) {
        toast({ variant: 'destructive', title: `Couldn’t save to ${app.name}`, description: msg || 'No confirmation returned.' });
        return;
      }
      setSentTo((s) => new Set(s).add(app.slug));
      toast({ title: `Saved to ${app.name}`, description: msg });
    } catch (e: any) {
      toast({ variant: 'destructive', title: `Couldn’t save to ${app.name}`, description: e?.message || 'Try again.' });
    } finally {
      setSending(null);
    }
  }

  // Nothing connected that we know how to deliver to — stay out of the way.
  if (apps.length === 0) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          disabled={!!sending}
          className="gap-1.5 border-white/10 bg-white/5 text-slate-200 hover:bg-white/10 hover:text-white"
        >
          {sending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
          {sending ? 'Saving…' : 'Send to'}
          <ChevronDown className="h-3 w-3 opacity-60" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-48">
        {apps.map((app) => (
          <DropdownMenuItem
            key={app.slug}
            disabled={!!sending}
            onClick={() => deliver(app)}
            className="gap-2.5 cursor-pointer"
          >
            <span className="h-5 w-5 rounded bg-white flex items-center justify-center overflow-hidden shrink-0">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={app.logo} alt="" className="h-3.5 w-3.5 object-contain" />
            </span>
            <span className="flex-1">{app.name}</span>
            {sentTo.has(app.slug) && <Check className="h-3.5 w-3.5 text-emerald-500" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
