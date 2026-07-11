'use client';

/**
 * Model picker for Script with Max — a searchable dropdown over the live
 * Mesh chat-model catalog (`useChatModels`). Recommended models (Perplexity,
 * Claude, GPT, …) surface first; typing searches the full catalog. Mirrors
 * the tiering the Thumbnail Studio's image-model picker uses, hand-rolled
 * with Popover/Input/ScrollArea since this repo has no `command.tsx`.
 */

import { useMemo, useState } from 'react';
import { Check, ChevronDown, Search, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import { useChatModels, formatChatModelPrice, type ChatModel } from '@/hooks/use-chat-models';

export function ModelPicker({
  value,
  onChange,
}: {
  /** Mesh model id, or undefined to use the service's cheap default. */
  value?: string;
  onChange: (id: string | undefined) => void;
}) {
  const { models, loading, error } = useChatModels();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');

  const active = models.find((m) => m.id === value) ?? null;

  const { recommended, rest } = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = q
      ? models.filter((m) => m.name.toLowerCase().includes(q) || m.id.toLowerCase().includes(q) || m.brand.toLowerCase().includes(q))
      : models;
    return {
      recommended: filtered.filter((m) => m.recommended),
      rest: filtered.filter((m) => !m.recommended),
    };
  }, [models, query]);

  function pick(id: string | undefined) {
    onChange(id);
    setOpen(false);
    setQuery('');
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="gap-1.5 border-white/10 bg-white/5 text-slate-200 hover:bg-white/10 hover:text-white"
        >
          <Sparkles className="h-3.5 w-3.5 text-primary" />
          {active ? active.name : 'Default model'}
          <ChevronDown className="h-3 w-3 opacity-60" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 p-0 bg-[#15132a] border-white/10 text-slate-200">
        <div className="p-2 border-b border-white/10">
          <div className="flex items-center gap-2 rounded-lg bg-white/5 px-2.5 py-1.5">
            <Search className="h-3.5 w-3.5 text-slate-500 shrink-0" />
            <Input
              autoFocus
              placeholder="Search models…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="h-6 border-none bg-transparent p-0 shadow-none focus-visible:ring-0 text-sm placeholder:text-slate-500"
            />
          </div>
        </div>
        <ScrollArea className="max-h-80">
          <div className="p-1.5">
            {loading && <div className="px-2.5 py-3 text-xs text-slate-500">Loading models…</div>}
            {error && <div className="px-2.5 py-3 text-xs text-red-400">{error}</div>}
            {!loading && !error && (
              <>
                <button
                  onClick={() => pick(undefined)}
                  className={cn(
                    'w-full text-left rounded-lg px-2.5 py-2 text-sm flex items-center justify-between hover:bg-white/5',
                    !value && 'bg-primary/15'
                  )}
                >
                  <span>Default (fast &amp; cheap)</span>
                  {!value && <Check className="h-3.5 w-3.5 text-primary" />}
                </button>
                {recommended.length > 0 && (
                  <ModelGroup label="Recommended" models={recommended} value={value} onPick={pick} />
                )}
                {rest.length > 0 && <ModelGroup label="All models" models={rest} value={value} onPick={pick} />}
                {!recommended.length && !rest.length && (
                  <div className="px-2.5 py-3 text-xs text-slate-500">No models match "{query}".</div>
                )}
              </>
            )}
          </div>
        </ScrollArea>
      </PopoverContent>
    </Popover>
  );
}

function ModelGroup({
  label,
  models,
  value,
  onPick,
}: {
  label: string;
  models: ChatModel[];
  value?: string;
  onPick: (id: string) => void;
}) {
  return (
    <div className="mt-1">
      <div className="px-2.5 py-1 text-micro font-semibold uppercase tracking-wider text-slate-500">{label}</div>
      {models.map((m) => (
        <button
          key={m.id}
          onClick={() => onPick(m.id)}
          className={cn(
            'w-full text-left rounded-lg px-2.5 py-2 text-sm flex items-center justify-between hover:bg-white/5',
            value === m.id && 'bg-primary/15'
          )}
        >
          <span className="min-w-0">
            <span className="block truncate">{m.name}</span>
            <span className="block text-micro text-slate-500">{m.brand || m.id} · {formatChatModelPrice(m)}</span>
          </span>
          {value === m.id && <Check className="h-3.5 w-3.5 text-primary shrink-0 ml-2" />}
        </button>
      ))}
    </div>
  );
}
