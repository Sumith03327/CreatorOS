'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Newspaper,
  RefreshCw,
  AlertTriangle,
  ExternalLink,
  ChevronDown,
  CircleCheck,
  Zap,
  DollarSign,
  Sliders,
  Sparkles,
  ScrollText,
  Bug,
  Radio,
  Inbox,
  Copy,
  Check,
  Share2,
} from 'lucide-react';
import { SidebarNav } from '@/components/dashboard/SidebarNav';
import { EpisodePlayer } from '@/components/times/EpisodePlayer';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { toast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { timeAgo } from '@/lib/video-utils';
import { readHistory } from '@/lib/history';
import { fetchCreatorFeeds, fetchLatestCreatorInsider } from '@/services/feeds';
import type { FeedItem } from '@/lib/feed-sources';
import { buildCreatorProfile } from '@/services/youtube';
import {
  decodeCreatorInsider,
  scoreNewsImpact,
  type ChangeCategory,
  type CreatorProfile,
  type ImpactLevel,
  type ScoredChange,
} from '@/ai/flows/creator-news-flow';

const CATEGORY_META: Record<ChangeCategory, { label: string; icon: React.ElementType; className: string }> = {
  monetization: { label: 'Money', icon: DollarSign, className: 'bg-emerald-500/10 text-emerald-600' },
  algorithm: { label: 'Algorithm', icon: Sliders, className: 'bg-violet-500/10 text-violet-600' },
  feature: { label: 'Feature', icon: Sparkles, className: 'bg-sky-500/10 text-sky-600' },
  policy: { label: 'Policy', icon: ScrollText, className: 'bg-amber-500/10 text-amber-600' },
  bug: { label: 'Bug', icon: Bug, className: 'bg-rose-500/10 text-rose-600' },
  other: { label: 'Other', icon: Radio, className: 'bg-muted text-muted-foreground' },
};

const IMPACT_META: Record<ImpactLevel, { title: string; hint: string; dot: string }> = {
  act: { title: 'Act on this', hint: 'Touches your format or your money', dot: 'bg-rose-500' },
  know: { title: 'Worth knowing', hint: 'Relevant, but nothing to do today', dot: 'bg-amber-500' },
  background: { title: 'Background', hint: "Doesn't touch your channel", dot: 'bg-slate-300' },
};

export default function CreatorTimesPage() {
  const [mounted, setMounted] = useState(false);
  const [loading, setLoading] = useState(true);
  const [decoding, setDecoding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [feed, setFeed] = useState<FeedItem[]>([]);
  const [failedSources, setFailedSources] = useState<string[]>([]);
  const [episode, setEpisode] = useState<FeedItem | null>(null);
  const [changes, setChanges] = useState<ScoredChange[] | null>(null);
  const [noTranscript, setNoTranscript] = useState(false);
  const [profile, setProfile] = useState<CreatorProfile>({});

  /** Seconds the embedded player is parked at, or null when it's closed. */
  const [seekTo, setSeekTo] = useState<number | null>(null);
  const [categoryFilter, setCategoryFilter] = useState<ChangeCategory | 'all'>('all');

  useEffect(() => setMounted(true), []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setSeekTo(null);
    setCategoryFilter('all');

    try {
      const [{ items, failedSources: failed }, latest] = await Promise.all([
        fetchCreatorFeeds(45),
        fetchLatestCreatorInsider(),
      ]);
      setFeed(items);
      setFailedSources(failed);
      setEpisode(latest);
      setLoading(false);

      if (!latest?.videoId) return;

      // The profile decides what "affects you" means. Without a connected channel
      // we still decode the news — we just can't personalise it, and we say so.
      setDecoding(true);
      const recent = readHistory()[0];
      let resolved: CreatorProfile = {};
      if (recent) {
        const built = await buildCreatorProfile(recent.id).catch(() => null);
        resolved = built ? { ...built, niche: recent.niche } : { channelTitle: recent.title, niche: recent.niche };
        setProfile(resolved);
      }

      const digest = await decodeCreatorInsider({ videoId: latest.videoId, title: latest.title });
      setNoTranscript(!digest.transcriptAvailable);

      if (digest.changes.length === 0) {
        setChanges([]);
        return;
      }

      // Impact is a claim about *you*. With no connected channel we can't make it,
      // so we don't: show the changes flat rather than guessing. Scoring an unknown
      // creator buried every change under "doesn't affect you" — a first-time user
      // saw an empty page. It also saves an LLM call we'd learn nothing from.
      if (!resolved.channelTitle) {
        setChanges(digest.changes.map(change => ({ ...change, impact: 'know' as ImpactLevel, soWhat: '' })));
        return;
      }

      setChanges(await scoreNewsImpact({ changes: digest.changes, profile: resolved }));
    } catch (e: any) {
      setError(e?.message || 'Could not load the news feed.');
    } finally {
      setLoading(false);
      setDecoding(false);
    }
  }, []);

  useEffect(() => {
    if (mounted) load();
  }, [mounted, load]);

  /** Which categories actually appear, so we never show a chip that filters to nothing. */
  const presentCategories = useMemo(() => {
    const seen = new Set<ChangeCategory>();
    for (const change of changes ?? []) seen.add(change.category);
    return Array.from(seen);
  }, [changes]);

  const visible = useMemo(
    () => (changes ?? []).filter(c => categoryFilter === 'all' || c.category === categoryFilter),
    [changes, categoryFilter]
  );

  const grouped = useMemo(
    () => ({
      act: visible.filter(c => c.impact === 'act'),
      know: visible.filter(c => c.impact === 'know'),
      background: visible.filter(c => c.impact === 'background'),
    }),
    [visible]
  );

  const otherNews = useMemo(() => feed.filter(item => item.id !== episode?.id).slice(0, 12), [feed, episode]);

  /** Impact grouping is only meaningful once we know whose channel we're judging against. */
  const personalized = Boolean(profile.channelTitle);

  /** The whole digest as pasteable text — for a team channel, a doc, or a tweet. */
  const copyBrief = () => {
    if (!changes?.length || !episode) return;
    const lines = [
      `Creator Times — what YouTube changed`,
      `Source: ${episode.title} (${episode.url})`,
      '',
      ...(['act', 'know', 'background'] as const).flatMap(level => {
        const group = changes.filter(c => c.impact === level);
        if (group.length === 0) return [];
        return [
          `## ${IMPACT_META[level].title}`,
          ...group.map(c => {
            const parts = [`- [${CATEGORY_META[c.category]?.label ?? 'Other'}] ${c.headline} (${c.timestamp})`];
            if (c.soWhat) parts.push(`  So what: ${c.soWhat}`);
            if (c.action) parts.push(`  Do: ${c.action}`);
            return parts.join('\n');
          }),
          '',
        ];
      }),
    ];
    navigator.clipboard.writeText(lines.join('\n'));
    toast({ title: 'Brief copied', description: 'Paste it into Slack, a doc, or your notes.' });
  };

  if (!mounted) return null;

  return (
    <TooltipProvider delayDuration={150}>
      <div className="flex h-screen overflow-hidden bg-background">
        <SidebarNav />
        <main className="flex-1 overflow-y-auto p-8">
          <header className="mb-8 flex flex-wrap items-center justify-between gap-4">
            <div>
              <div className="mb-1 flex items-center gap-2">
                <Newspaper className="h-6 w-6 text-primary" />
                <h1 className="font-headline text-3xl font-bold tracking-tight">Creator Times</h1>
              </div>
              <p className="text-muted-foreground">
                What YouTube changed, and what it means for{' '}
                {profile.channelTitle ? (
                  <span className="font-semibold text-foreground">{profile.channelTitle}</span>
                ) : (
                  'your channel'
                )}
                .
              </p>
            </div>

            <div className="flex items-center gap-2">
              {changes && changes.length > 0 && (
                <Button variant="outline" size="sm" onClick={copyBrief} className="gap-2 rounded-full">
                  <Share2 className="h-3.5 w-3.5" /> Copy the brief
                </Button>
              )}
              <Button
                variant="outline"
                size="sm"
                onClick={load}
                disabled={loading || decoding}
                className="gap-2 rounded-full"
              >
                <RefreshCw className={cn('h-3.5 w-3.5', (loading || decoding) && 'animate-spin')} /> Refresh
              </Button>
            </div>
          </header>

          {error && (
            <div className="mb-6 flex gap-3 rounded-xl border border-destructive/20 bg-destructive/5 p-4">
              <AlertTriangle className="h-5 w-5 shrink-0 text-destructive" />
              <p className="text-sm font-medium">{error}</p>
            </div>
          )}

          <div className="space-y-8">
            <Card className="border-none bg-card p-6 shadow-sm">
              <div className="mb-4">
                <div className="flex items-center gap-2">
                  <Zap className="h-4 w-4 text-primary" />
                  <h2 className="text-lg font-bold tracking-tight">What changed this week</h2>
                </div>
                <p className="mt-1 max-w-2xl text-xs text-muted-foreground">
                  Read straight out of YouTube's weekly Creator Insider briefing — the one where the product managers
                  say what shipped. Click any timestamp to watch that exact moment.
                </p>
              </div>

              {episode?.videoId && (
                <EpisodePlayer
                  episode={episode}
                  seekTo={seekTo}
                  onOpen={seconds => setSeekTo(seconds)}
                  onClose={() => setSeekTo(null)}
                />
              )}

              {(loading || decoding) && (
                <div className="mt-5 space-y-2">
                  <p className="mb-3 text-xs text-muted-foreground">
                    {loading ? 'Fetching the latest briefing…' : 'Reading the transcript and matching it to your channel…'}
                  </p>
                  {Array.from({ length: 3 }).map((_, i) => (
                    <Skeleton key={i} className="h-16 w-full rounded-xl" />
                  ))}
                </div>
              )}

              {!loading && !decoding && noTranscript && (
                <EmptyNote>This week's briefing has no captions yet, so there's nothing to decode.</EmptyNote>
              )}

              {/* An honest empty week. A feed that must fill itself every day invents filler. */}
              {!loading && !decoding && changes?.length === 0 && !noTranscript && (
                <EmptyNote>
                  <CircleCheck className="mx-auto mb-2 h-5 w-5 text-emerald-600" />
                  Nothing substantive shipped in this briefing. That's a real answer, not a loading state.
                </EmptyNote>
              )}

              {!loading && !decoding && changes && changes.length > 0 && (
                <div className="mt-6 space-y-6">
                  {!profile.channelTitle && (
                    <p className="rounded-xl border border-dashed border-border px-4 py-2.5 text-xs text-muted-foreground">
                      Analyse a channel and these get sorted by whether they actually affect{' '}
                      <span className="font-semibold text-foreground">you</span> — your format, your size, your
                      monetization.
                    </p>
                  )}

                  {presentCategories.length > 1 && (
                    <div className="flex flex-wrap items-center gap-1.5">
                      <FilterChip active={categoryFilter === 'all'} onClick={() => setCategoryFilter('all')}>
                        All {changes.length}
                      </FilterChip>
                      {presentCategories.map(category => {
                        const meta = CATEGORY_META[category];
                        const count = changes.filter(c => c.category === category).length;
                        return (
                          <FilterChip
                            key={category}
                            active={categoryFilter === category}
                            onClick={() => setCategoryFilter(category)}
                          >
                            <meta.icon className="h-3 w-3" />
                            {meta.label} {count}
                          </FilterChip>
                        );
                      })}
                    </div>
                  )}

                  {/* Unpersonalized: a flat list. Grouping by "affects you" would be a
                      claim we have no basis for, and it hid everything when we tried. */}
                  {!personalized ? (
                    <div className="space-y-2">
                      {visible.map(change => (
                        <ChangeRow key={change.id} change={change} onSeek={setSeekTo} />
                      ))}
                    </div>
                  ) : (
                    <>
                      {(['act', 'know'] as const).map(level =>
                        grouped[level].length > 0 ? (
                          <ImpactGroup key={level} level={level} changes={grouped[level]} onSeek={setSeekTo} />
                        ) : null
                      )}

                      {grouped.act.length === 0 && grouped.know.length === 0 && grouped.background.length > 0 && (
                        <EmptyNote>
                          <CircleCheck className="mx-auto mb-2 h-5 w-5 text-emerald-600" />
                          Nothing here touches your channel. The {grouped.background.length} below are still worth a
                          glance.
                        </EmptyNote>
                      )}

                      {grouped.background.length > 0 && (
                        <Collapsible>
                          <CollapsibleTrigger asChild>
                            <button className="group flex w-full items-center justify-between rounded-xl border border-border/60 px-4 py-2.5 text-left transition hover:border-border">
                              <span className="text-xs font-semibold text-muted-foreground">
                                {grouped.background.length} more that don't affect you
                              </span>
                              <ChevronDown className="h-4 w-4 text-muted-foreground transition group-data-[state=open]:rotate-180" />
                            </button>
                          </CollapsibleTrigger>
                          <CollapsibleContent className="space-y-2 pt-2">
                            {grouped.background.map(change => (
                              <ChangeRow key={change.id} change={change} onSeek={setSeekTo} dimmed />
                            ))}
                          </CollapsibleContent>
                        </Collapsible>
                      )}
                    </>
                  )}

                  {visible.length === 0 && (
                    <EmptyNote>No {CATEGORY_META[categoryFilter as ChangeCategory]?.label} changes this week.</EmptyNote>
                  )}
                </div>
              )}
            </Card>

            <NewsFeed items={otherNews} loading={loading} failedSources={failedSources} />
          </div>
        </main>
      </div>
    </TooltipProvider>
  );
}

// --- Pieces -----------------------------------------------------------------

function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold transition',
        active ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:bg-muted/70'
      )}
    >
      {children}
    </button>
  );
}

function ImpactGroup({
  level,
  changes,
  onSeek,
}: {
  level: ImpactLevel;
  changes: ScoredChange[];
  onSeek: (seconds: number) => void;
}) {
  const meta = IMPACT_META[level];
  return (
    <section className="space-y-2">
      <div className="flex items-center gap-2">
        <span className={cn('h-1.5 w-1.5 rounded-full', meta.dot)} />
        <h3 className="text-xs font-bold uppercase tracking-wider">{meta.title}</h3>
        <span className="text-[11px] text-muted-foreground/80">— {meta.hint}</span>
        <Badge className="ml-auto border-none bg-muted px-1.5 text-[10px] font-bold tabular-nums text-muted-foreground">
          {changes.length}
        </Badge>
      </div>
      <div className="space-y-2">
        {changes.map(change => (
          <ChangeRow key={change.id} change={change} onSeek={onSeek} highlight={level === 'act'} />
        ))}
      </div>
    </section>
  );
}

function ChangeRow({
  change,
  onSeek,
  highlight,
  dimmed,
}: {
  change: ScoredChange;
  onSeek: (seconds: number) => void;
  highlight?: boolean;
  dimmed?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const category = CATEGORY_META[change.category] ?? CATEGORY_META.other;
  const Icon = category.icon;

  const copy = () => {
    const parts = [change.headline, change.detail];
    if (change.soWhat) parts.push(`So what: ${change.soWhat}`);
    if (change.action) parts.push(`Do: ${change.action}`);
    navigator.clipboard.writeText(parts.join('\n'));
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div
      className={cn(
        'group rounded-xl border px-4 py-3 transition',
        highlight ? 'border-rose-500/30 bg-rose-500/[0.03]' : 'border-border/60',
        dimmed && 'opacity-70 hover:opacity-100'
      )}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={cn(
            'inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-bold uppercase leading-none',
            category.className
          )}
        >
          <Icon className="h-2.5 w-2.5" />
          {category.label}
        </span>

        <p className="text-sm font-semibold">{change.headline}</p>

        {!change.isLive && (
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="cursor-default rounded-md bg-muted px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground">
                rolling out
              </span>
            </TooltipTrigger>
            <TooltipContent>
              <p className="text-xs">Announced but not live for everyone yet.</p>
            </TooltipContent>
          </Tooltip>
        )}

        <div className="ml-auto flex shrink-0 items-center gap-1">
          <button
            onClick={copy}
            aria-label="Copy this change"
            className="rounded p-1 text-muted-foreground/50 opacity-0 transition hover:text-primary group-hover:opacity-100"
          >
            {copied ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
          </button>

          {/* Plays the exact second it was announced, in the player above. */}
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={() => onSeek(change.timestampSeconds)}
                className="rounded px-1.5 py-0.5 font-mono text-[11px] tabular-nums text-muted-foreground transition hover:bg-primary/10 hover:text-primary"
              >
                {change.timestamp}
              </button>
            </TooltipTrigger>
            <TooltipContent>
              <p className="text-xs">Watch this moment</p>
            </TooltipContent>
          </Tooltip>
        </div>
      </div>

      <p className="mt-1.5 text-xs text-muted-foreground">{change.detail}</p>

      {change.soWhat && (
        <p className={cn('mt-2 text-xs', highlight ? 'font-medium text-foreground' : 'text-foreground/80')}>
          <span className="font-bold text-primary">So what: </span>
          {change.soWhat}
        </p>
      )}

      {change.action && (
        <div className="mt-2 flex items-start gap-2 rounded-lg bg-muted/60 px-3 py-2">
          <CircleCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" />
          <p className="text-xs font-medium">{change.action}</p>
        </div>
      )}
    </div>
  );
}

function NewsFeed({
  items,
  loading,
  failedSources,
}: {
  items: FeedItem[];
  loading: boolean;
  failedSources: string[];
}) {
  return (
    <Card className="border-none bg-card p-6 shadow-sm">
      <div className="mb-4 flex items-center gap-2">
        <Inbox className="h-4 w-4 text-primary" />
        <h2 className="text-lg font-bold tracking-tight">The wire</h2>
        <span className="text-xs text-muted-foreground">— everything else from YouTube's official channels</span>
      </div>

      {failedSources.length > 0 && (
        <p className="mb-3 text-xs text-amber-600">Couldn't reach {failedSources.join(', ')} — showing what we have.</p>
      )}

      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-14 w-full rounded-xl" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <EmptyNote>No posts from YouTube's official channels in the last six weeks.</EmptyNote>
      ) : (
        <div className="space-y-1">
          {items.map(item => {
            const thumb = item.thumbnail || (item.videoId ? `https://i.ytimg.com/vi/${item.videoId}/default.jpg` : null);
            return (
              <a
                key={item.id}
                href={item.url}
                target="_blank"
                rel="noreferrer"
                className="group flex items-center gap-3 rounded-xl px-2 py-2 transition hover:bg-muted/60"
              >
                {thumb ? (
                  <img
                    src={thumb}
                    alt=""
                    loading="lazy"
                    className="h-10 w-16 shrink-0 rounded-md object-cover"
                  />
                ) : (
                  <div className="h-10 w-16 shrink-0 rounded-md bg-muted" />
                )}

                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium group-hover:text-primary">{item.title}</p>
                  <div className="mt-0.5 flex items-center gap-2">
                    <span
                      className={cn(
                        'rounded px-1 py-0.5 text-[9px] font-bold uppercase leading-none',
                        item.authority === 'primary' ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'
                      )}
                    >
                      {item.sourceLabel}
                    </span>
                    <span className="text-[11px] text-muted-foreground">{timeAgo(item.publishedAt)}</span>
                  </div>
                </div>

                <ExternalLink className="h-3.5 w-3.5 shrink-0 text-muted-foreground/40 transition group-hover:text-primary" />
              </a>
            );
          })}
        </div>
      )}
    </Card>
  );
}

function EmptyNote({ children }: { children: React.ReactNode }) {
  return (
    <div className="mt-5 rounded-xl border border-dashed border-border px-4 py-8 text-center">
      <p className="mx-auto max-w-md text-sm text-muted-foreground">{children}</p>
    </div>
  );
}
