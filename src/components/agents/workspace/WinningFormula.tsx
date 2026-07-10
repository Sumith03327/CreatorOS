'use client';

/**
 * Winning Formula — the creator curates proven material; agents ground on it.
 *
 * One shared panel for every agent. An agent declares which evidence kinds it
 * consumes (`evidence` on BuiltinAgent) and the panel filters to those, so
 * Title Doctor sees titles and hooks while Trend Scout sees winning videos.
 *
 * Three ingest paths, matching how creators actually collect proof:
 *   Paste        — a list they already keep
 *   Channel      — pull a channel's real videos, sorted by views
 *   Find winners — outlier search: videos that beat their own channel's norm
 */

import { useCallback, useEffect, useState } from 'react';
import {
  TrendingUp, Plus, Loader2, Trash2, Youtube, Search, ClipboardList, Check, Sparkles,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import {
  listFormula, addFormulaItems, removeFormulaItem,
  type EvidenceItem, type EvidenceKind,
} from '@/services/formula-store';
import { importFromChannel, findWinners, type FormulaCandidate } from '@/app/agents/formula-actions';

const DARK_INPUT = 'bg-white/5 border-white/10 text-white placeholder:text-slate-500 focus-visible:ring-primary/40';

/** Load the creator's formula, filtered to the kinds this agent consumes. */
export function useWinningFormula(kinds?: EvidenceKind[]) {
  const [items, setItems] = useState<EvidenceItem[]>([]);
  const key = (kinds ?? []).join(',');

  const refresh = useCallback(async () => {
    setItems(await listFormula(kinds?.length ? kinds : undefined));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  useEffect(() => { refresh(); }, [refresh]);
  return { items, refresh };
}

function compact(n?: number) {
  if (n == null || !Number.isFinite(n)) return null;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}K`;
  return String(n);
}

/** A pickable row of candidates, shared by the channel and find-winners tabs. */
function CandidateList({
  candidates, picked, toggle,
}: {
  candidates: FormulaCandidate[];
  picked: Set<string>;
  toggle: (text: string) => void;
}) {
  return (
    <ScrollArea className="h-64 rounded-xl border border-white/10 bg-white/[0.02]">
      <div className="p-2 space-y-1">
        {candidates.map((c) => (
          <label
            key={c.text}
            className="flex items-start gap-2.5 rounded-lg p-2 hover:bg-white/5 cursor-pointer"
          >
            <Checkbox checked={picked.has(c.text)} onCheckedChange={() => toggle(c.text)} className="mt-0.5" />
            <div className="min-w-0 flex-1">
              <p className="text-xs leading-snug text-slate-200">{c.text}</p>
              <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[10px] text-slate-500">
                {c.channel && <span>{c.channel}</span>}
                {compact(c.views) && <span>{compact(c.views)} views</span>}
                {compact(c.subscribers) && <span>{compact(c.subscribers)} subs</span>}
                {c.outlierScore != null && (
                  <span className={cn('font-semibold', c.outlierScore >= 3 ? 'text-emerald-400' : 'text-slate-400')}>
                    {c.outlierScore.toFixed(1)}× outlier
                  </span>
                )}
              </p>
            </div>
          </label>
        ))}
      </div>
    </ScrollArea>
  );
}

function AddDataDialog({ kinds, onAdded }: { kinds: EvidenceKind[]; onAdded: () => void }) {
  const [open, setOpen] = useState(false);

  // paste
  const pasteKinds = kinds.filter((k) => k === 'title' || k === 'hook' || k === 'description');
  const [pasteKind, setPasteKind] = useState<EvidenceKind>(pasteKinds[0] ?? 'title');
  const [pasteText, setPasteText] = useState('');

  // channel + winners share the candidate picker
  const [channelUrl, setChannelUrl] = useState('');
  const [niche, setNiche] = useState('');
  const [loading, setLoading] = useState(false);
  const [candidates, setCandidates] = useState<FormulaCandidate[]>([]);
  const [source, setSource] = useState<'channel' | 'research'>('channel');
  const [picked, setPicked] = useState<Set<string>>(new Set());

  const toggle = (text: string) =>
    setPicked((p) => {
      const n = new Set(p);
      n.has(text) ? n.delete(text) : n.add(text);
      return n;
    });

  async function loadChannel() {
    if (!channelUrl.trim()) return;
    setLoading(true);
    setCandidates([]);
    setPicked(new Set());
    try {
      const { channelTitle, candidates } = await importFromChannel(channelUrl.trim());
      setSource('channel');
      setCandidates(candidates);
      setPicked(new Set(candidates.slice(0, 10).map((c) => c.text))); // pre-tick the top performers
      toast({ title: `Loaded ${channelTitle}`, description: `${candidates.length} videos, best first.` });
    } catch (e: any) {
      toast({ variant: 'destructive', title: 'Could not read that channel', description: e?.message ?? 'Check the URL.' });
    } finally {
      setLoading(false);
    }
  }

  async function loadWinners() {
    if (!niche.trim()) return;
    setLoading(true);
    setCandidates([]);
    setPicked(new Set());
    try {
      const found = await findWinners(niche.trim());
      setSource('research');
      setCandidates(found);
      setPicked(new Set(found.filter((c) => (c.outlierScore ?? 0) >= 3).map((c) => c.text)));
      toast({ title: `Found ${found.length} winners`, description: 'Genuine outliers — views far above their channel’s norm.' });
    } catch (e: any) {
      toast({ variant: 'destructive', title: 'Search failed', description: e?.message ?? 'Try a different niche.' });
    } finally {
      setLoading(false);
    }
  }

  async function savePaste() {
    const lines = pasteText.split('\n').map((l) => l.trim()).filter(Boolean);
    if (!lines.length) return;
    await addFormulaItems(lines.map((text) => ({ kind: pasteKind, text, source: 'manual' as const })));
    setPasteText('');
    onAdded();
    setOpen(false);
    toast({ title: `Added ${lines.length} ${pasteKind}${lines.length === 1 ? '' : 's'}` });
  }

  async function saveCandidates() {
    const chosen = candidates.filter((c) => picked.has(c.text));
    if (!chosen.length) return;
    await addFormulaItems(
      chosen.map((c) => ({
        kind: 'video' as const,
        text: c.text,
        source,
        meta: {
          videoId: c.videoId, url: c.url, channel: c.channel,
          views: c.views, subscribers: c.subscribers,
          outlierScore: c.outlierScore, publishedAt: c.publishedAt,
        },
      }))
    );
    setCandidates([]);
    setPicked(new Set());
    onAdded();
    setOpen(false);
    toast({ title: `Added ${chosen.length} proven videos` });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" className="gap-1.5 border-white/10 bg-white/5 text-slate-200 hover:bg-white/10 hover:text-white">
          <Plus className="h-3.5 w-3.5" /> Add data
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl border-white/10 bg-[#12121e] text-slate-200">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-white">
            <TrendingUp className="h-4 w-4 text-emerald-400" /> Feed proven data
          </DialogTitle>
        </DialogHeader>

        <Tabs defaultValue={pasteKinds.length ? 'paste' : 'channel'}>
          <TabsList className="bg-white/5">
            {pasteKinds.length > 0 && <TabsTrigger value="paste" className="gap-1.5"><ClipboardList className="h-3.5 w-3.5" /> Paste</TabsTrigger>}
            <TabsTrigger value="channel" className="gap-1.5"><Youtube className="h-3.5 w-3.5" /> Channel</TabsTrigger>
            <TabsTrigger value="winners" className="gap-1.5"><Search className="h-3.5 w-3.5" /> Find winners</TabsTrigger>
          </TabsList>

          {pasteKinds.length > 0 && (
            <TabsContent value="paste" className="space-y-3 pt-3">
              <div className="flex gap-2">
                {pasteKinds.map((k) => (
                  <button
                    key={k}
                    onClick={() => setPasteKind(k)}
                    className={cn(
                      'rounded-full border px-2.5 py-1 text-[11px] font-medium capitalize',
                      pasteKind === k ? 'border-primary/40 bg-primary/15 text-primary' : 'border-white/10 bg-white/5 text-slate-400'
                    )}
                  >
                    {k}s
                  </button>
                ))}
              </div>
              <Textarea
                placeholder={`One ${pasteKind} per line…`}
                value={pasteText}
                onChange={(e) => setPasteText(e.target.value)}
                className={cn('min-h-[180px]', DARK_INPUT)}
              />
              <Button onClick={savePaste} disabled={!pasteText.trim()} className="w-full gap-2 cc-glow">
                <Check className="h-4 w-4" /> Add to formula
              </Button>
            </TabsContent>
          )}

          <TabsContent value="channel" className="space-y-3 pt-3">
            <Label className="text-slate-300">Any channel — yours or a competitor’s</Label>
            <div className="flex gap-2">
              <Input placeholder="https://youtube.com/@channel" value={channelUrl} onChange={(e) => setChannelUrl(e.target.value)} className={DARK_INPUT} />
              <Button onClick={loadChannel} disabled={loading || !channelUrl.trim()} className="gap-2 shrink-0">
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Youtube className="h-4 w-4" />} Load
              </Button>
            </div>
            {candidates.length > 0 && <CandidateList candidates={candidates} picked={picked} toggle={toggle} />}
            {candidates.length > 0 && (
              <Button onClick={saveCandidates} disabled={!picked.size} className="w-full gap-2 cc-glow">
                <Check className="h-4 w-4" /> Add {picked.size} selected
              </Button>
            )}
          </TabsContent>

          <TabsContent value="winners" className="space-y-3 pt-3">
            <Label className="text-slate-300">
              Outlier search — videos that beat their own channel’s normal views
            </Label>
            <div className="flex gap-2">
              <Input placeholder="e.g., beginner python tutorials" value={niche} onChange={(e) => setNiche(e.target.value)} className={DARK_INPUT} />
              <Button onClick={loadWinners} disabled={loading || !niche.trim()} className="gap-2 shrink-0">
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />} Find
              </Button>
            </div>
            {candidates.length > 0 && <CandidateList candidates={candidates} picked={picked} toggle={toggle} />}
            {candidates.length > 0 && (
              <Button onClick={saveCandidates} disabled={!picked.size} className="w-full gap-2 cc-glow">
                <Check className="h-4 w-4" /> Add {picked.size} selected
              </Button>
            )}
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}

/**
 * The card that sits in an agent's brief. Shows what the agent will ground on,
 * and fills the otherwise-empty canvas before a run.
 */
export function WinningFormulaPanel({
  kinds,
  items,
  onChanged,
}: {
  kinds: EvidenceKind[];
  items: EvidenceItem[];
  onChanged: () => void;
}) {
  async function remove(id: string) {
    await removeFormulaItem(id);
    onChanged();
  }

  return (
    <div className="cc-card p-5 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <TrendingUp className="h-4 w-4 text-emerald-400" />
          <p className="text-sm font-semibold text-white">Winning Formula</p>
          <span className="rounded-full border border-emerald-400/25 bg-emerald-400/10 px-2 py-0.5 text-[10px] font-semibold text-emerald-300">
            {items.length} proven
          </span>
        </div>
        <AddDataDialog kinds={kinds} onAdded={onChanged} />
      </div>

      {items.length === 0 ? (
        <p className="text-xs leading-relaxed text-slate-500">
          Feed this agent proof of what already works — paste your best {kinds.includes('hook') ? 'titles and hooks' : 'titles'},
          pull a channel’s real videos, or search for outliers. The agent reads them before it answers, and grounds its
          work in patterns that actually won.
        </p>
      ) : (
        <ScrollArea className="max-h-40">
          <div className="flex flex-wrap gap-1.5 pr-2">
            {items.map((i) => (
              <span
                key={i.id}
                className="group inline-flex max-w-full items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-2.5 py-1"
              >
                {i.meta?.outlierScore != null && (
                  <span className="text-[9px] font-bold text-emerald-400">{i.meta.outlierScore.toFixed(1)}×</span>
                )}
                <span className="truncate text-[11px] text-slate-300 max-w-[22rem]">{i.text}</span>
                <button
                  onClick={() => remove(i.id)}
                  className="opacity-0 group-hover:opacity-100 text-slate-500 hover:text-destructive transition-opacity"
                  title="Remove"
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </span>
            ))}
          </div>
        </ScrollArea>
      )}
    </div>
  );
}
