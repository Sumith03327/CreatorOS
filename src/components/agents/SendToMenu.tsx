'use client';

/**
 * "Send to" / "Distribute" — pushes any deliverable in the product into the
 * creator's real apps (Gmail draft, Google Doc, Notion page, Trello card,
 * LinkedIn post, …).
 *
 * Rather than hardcoding Composio tool slugs (which drift, and which we'd be
 * guessing at), this runs a tiny DELIVERY AGENT: it gets the connector's tools
 * and picks the right one itself. That reuses the whole agent loop, and it
 * degrades honestly — if an app isn't connected, the loop says so instead of
 * failing.
 *
 * Only apps the user has actually connected are offered. Targets, verbs, and
 * the publishes-to-other-people flag all come from `delivery-targets.ts`.
 */

import { useEffect, useState } from 'react';
import { Send, Loader2, Check, ChevronDown, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { toast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { getConnectorCatalog, getConnections } from '@/app/agents/connection-actions';
import { getTarget, type DeliveryKind, type DeliveryTarget } from '@/services/delivery-targets';

export function SendToMenu({
  title,
  body,
  variant = 'dark',
  align = 'end',
  label = 'Send to',
  kinds,
  only,
}: {
  title: string;
  body: string;
  /** 'dark' for the Command Center workspaces, 'light' for the dashboard pages. */
  variant?: 'dark' | 'light';
  align?: 'start' | 'end';
  /** Trigger label — "Send to" for archiving, "Distribute" for publishing. */
  label?: string;
  /** Only offer targets that suit these deliverable kinds. */
  kinds?: DeliveryKind[];
  /** Only offer these exact app slugs (wins over `kinds`). */
  only?: string[];
}) {
  const [apps, setApps] = useState<DeliveryTarget[]>([]);
  const [sending, setSending] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<Set<string>>(new Set());
  /** A publishing target awaiting explicit confirmation. */
  const [confirming, setConfirming] = useState<DeliveryTarget | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const [{ enabled, connectors }, conns] = await Promise.all([getConnectorCatalog(), getConnections()]);
        if (!enabled) return;
        const active = new Set(conns.filter((c) => c.status === 'ACTIVE').map((c) => c.slug));
        const targets = connectors
          .map((c) => getTarget(c.slug))
          .filter((t): t is DeliveryTarget => Boolean(t) && active.has(t!.slug));

        const filtered = only
          ? targets.filter((t) => only.includes(t.slug))
          : kinds?.length
            ? targets.filter((t) => t.kinds.some((k) => kinds.includes(k)))
            : targets;
        setApps(filtered);
      } catch {
        setApps([]);
      }
    })();
    // `only`/`kinds` are static per call site; re-running on identity churn is wasteful.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [only?.join(','), kinds?.join(',')]);

  async function deliver(app: DeliveryTarget) {
    setSending(app.slug);
    try {
      const res = await fetch('/api/agents/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          instructions:
            `You are a delivery agent with tools for ${app.name}. ${app.verb} ` +
            `Use as few tool calls as needed. Then reply with ONE short sentence describing what you created, including any link or id the tool returned. ` +
            // The confirmation prose is unreliable to parse; the agent marks the
            // real outcome (from the tool result it saw) with an explicit token.
            `End your reply with [[OK]] if the action truly succeeded, or [[FAIL]] if it did not (a tool error, or the app is not connected).`,
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

      // Outcome is driven by the token the agent emits from the tool result it
      // actually saw — not by guessing at prose (which reports failures as
      // successes). Fail closed: no explicit [[OK]] means we treat it as failed.
      const raw = confirmation.trim();
      const succeeded = /\[\[OK\]\]/.test(raw) && !/\[\[FAIL\]\]/.test(raw);
      const msg = raw.replace(/\[\[(?:OK|FAIL)\]\]/g, '').trim();
      if (!succeeded) {
        toast({ variant: 'destructive', title: `Couldn’t save to ${app.name}`, description: msg || 'No confirmation returned.' });
        return;
      }
      setSentTo((s) => new Set(s).add(app.slug));
      toast({ title: `${app.publishes ? 'Posted to' : 'Saved to'} ${app.name}`, description: msg });
    } catch (e: any) {
      toast({ variant: 'destructive', title: `Couldn’t save to ${app.name}`, description: e?.message || 'Try again.' });
    } finally {
      setSending(null);
    }
  }

  /** Anything other people will see gets an explicit confirmation first. */
  function pick(app: DeliveryTarget) {
    if (app.publishes) setConfirming(app);
    else deliver(app);
  }

  // Nothing connected that we know how to deliver to — stay out of the way.
  if (apps.length === 0) return null;

  const dark = variant === 'dark';

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            disabled={!!sending}
            className={cn('gap-1.5', dark && 'border-white/10 bg-white/5 text-slate-200 hover:bg-white/10 hover:text-white')}
          >
            {sending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
            {sending ? 'Saving…' : label}
            <ChevronDown className="h-3 w-3 opacity-60" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align={align} className="min-w-52">
          {apps.map((app) => (
            <DropdownMenuItem
              key={app.slug}
              disabled={!!sending}
              onClick={() => pick(app)}
              className="gap-2.5 cursor-pointer"
            >
              <span className="h-5 w-5 rounded bg-white flex items-center justify-center overflow-hidden shrink-0">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={app.logo} alt="" className="h-3.5 w-3.5 object-contain" />
              </span>
              <span className="flex-1">{app.name}</span>
              {app.publishes && !sentTo.has(app.slug) && (
                <span className="text-micro font-semibold uppercase text-amber-600">public</span>
              )}
              {sentTo.has(app.slug) && <Check className="h-3.5 w-3.5 text-emerald-500" />}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Outward-facing delivery is effectively irreversible — never one-click. */}
      <AlertDialog open={Boolean(confirming)} onOpenChange={(o) => !o && setConfirming(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-500" />
              Post to {confirming?.name}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This creates content other people can see, and it can’t be undone from here.
              You’ll be posting “{title}”.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                const app = confirming!;
                setConfirming(null);
                deliver(app);
              }}
            >
              Post to {confirming?.name}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
