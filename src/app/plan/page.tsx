'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { SidebarNav } from '@/components/dashboard/SidebarNav';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import {
  Loader2, Zap, Lightbulb, CheckCircle2, ArrowRight, Youtube, AlertCircle, EyeOff,
  ChevronDown, RefreshCw, Unplug, Stethoscope, CalendarDays,
} from 'lucide-react';
import { generateContentActionPlan, type GenerateContentActionPlanOutput } from '@/ai/flows/generate-content-action-plan';
import { generateContentCalendar, type PlannedUpload } from '@/ai/flows/generate-content-calendar';
import { analyzeChannelDemographics } from '@/ai/flows/analyze-channel-demographics-flow';
import { fetchYouTubeChannelData, fetchChannelVideosPage, type YouTubeVideoData } from '@/services/youtube';
import { getMyChannel, setMyChannel, patchMyChannel, clearMyChannel, subscribeToMyChannel, type MyChannel } from '@/lib/my-channel';
import { computeMetrics, diagnose, buildBrief, ownWinners, BLIND_SPOTS, type Finding, type Severity } from '@/lib/channel-diagnosis';
import { buildSlots, bestPublishSlot, shortsShareOf, slotTimeLabel } from '@/lib/content-calendar';
import { GoalCard } from '@/components/plan/GoalCard';
import { PlanHistory } from '@/components/plan/PlanHistory';
import {
  listPlans, latestPlan, savePlan, updatePlan, deletePlan,
  getGoal, setGoal as persistGoal, clearGoal, subscribeToPlans,
  type SavedPlan, type Goal,
} from '@/lib/plan-store';
import { listFormula } from '@/services/formula-store';
import { setInbox } from '@/lib/title-projects';
import { SendToMenu } from '@/components/agents/SendToMenu';
import { formatNumber } from '@/lib/format';
import { cn } from '@/lib/utils';

/** How many recent uploads the diagnosis reads. Cheap: one playlist page. */
const SAMPLE = 20;

const SEVERITY_STYLE: Record<Severity, { chip: string; bar: string; label: string }> = {
  high: { chip: 'bg-rose-100 text-rose-700', bar: 'bg-rose-500', label: 'Fix first' },
  medium: { chip: 'bg-amber-100 text-amber-700', bar: 'bg-amber-500', label: 'Worth fixing' },
  low: { chip: 'bg-slate-100 text-slate-600', bar: 'bg-slate-400', label: 'Minor' },
  good: { chip: 'bg-emerald-100 text-emerald-700', bar: 'bg-emerald-500', label: 'Healthy' },
};

/** Flatten the plan into a title + body the delivery agent can write anywhere. */
function planDeliverable(result: GenerateContentActionPlanOutput) {
  const body = [
    'STRATEGIC STEPS',
    ...result.strategicSteps.map((s, i) => `${i + 1}. ${s}`),
    '',
    'CONTENT IDEAS',
    ...result.contentIdeas.map((idea, i) => `${i + 1}. ${idea}`),
  ].join('\n');
  return { title: 'Content Action Plan', body };
}

export default function PlanPage() {
  const router = useRouter();
  const [mounted, setMounted] = useState(false);
  const [channel, setChannel] = useState<MyChannel | null>(null);
  const [videos, setVideos] = useState<YouTubeVideoData[]>([]);

  const [connectUrl, setConnectUrl] = useState('');
  const [connecting, setConnecting] = useState(false);
  const [loadingUploads, setLoadingUploads] = useState(false);
  const [planning, setPlanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<GenerateContentActionPlanOutput | null>(null);
  const [briefOpen, setBriefOpen] = useState(false);
  const [calendaring, setCalendaring] = useState(false);
  const [calendar, setCalendar] = useState<PlannedUpload[] | null>(null);

  // Persistence — the plan, the calendar and the goal all survive navigation.
  const [plans, setPlans] = useState<SavedPlan[]>([]);
  const [activePlanId, setActivePlanId] = useState<string | null>(null);
  /** Mirrors activePlanId synchronously — `persist` runs across separate events
   *  and cannot wait for a re-render to learn which record is open. */
  const activePlanRef = useRef<string | null>(null);
  const [goal, setGoalState] = useState<Goal | null>(null);
  /** Proven titles/hooks the creator curated — grounds the ideas (#8). */
  const [formula, setFormula] = useState<string[]>([]);

  useEffect(() => {
    setMounted(true);
    setChannel(getMyChannel());
    return subscribeToMyChannel(() => setChannel(getMyChannel()));
  }, []);

  /** Restore the last session for this channel, so leaving the page costs nothing. */
  useEffect(() => {
    if (!channel) {
      setPlans([]); activePlanRef.current = null; setActivePlanId(null); setGoalState(null);
      return;
    }
    const mine = listPlans(channel.id);
    setPlans(mine);
    setGoalState(getGoal(channel.id));

    const last = latestPlan(channel.id);
    if (last) {
      activePlanRef.current = last.id;
      setActivePlanId(last.id);
      if (last.actionPlan) setResult(last.actionPlan);
      if (last.calendar) setCalendar(last.calendar);
    }
    listFormula(['title', 'hook']).then((items) => setFormula(items.map((i) => i.text)));

    return subscribeToPlans(() => {
      setPlans(listPlans(channel.id));
      setGoalState(getGoal(channel.id));
    });
  }, [channel?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Read the channel's recent uploads — the raw material for the diagnosis. */
  const loadUploads = useCallback(async (c: MyChannel) => {
    setLoadingUploads(true);
    setError(null);
    try {
      const { videos } = await fetchChannelVideosPage(c.uploadsPlaylistId, SAMPLE);
      setVideos(videos);
    } catch (e: any) {
      setError(e?.message || 'Could not read your recent uploads.');
    } finally {
      setLoadingUploads(false);
    }
  }, []);

  useEffect(() => {
    if (channel) loadUploads(channel);
  }, [channel?.id, loadUploads]); // eslint-disable-line react-hooks/exhaustive-deps

  async function connect() {
    const url = connectUrl.trim();
    if (!url) return;
    setConnecting(true);
    setError(null);
    try {
      const data = await fetchYouTubeChannelData(url);
      if (!data) {
        setError('Could not find that channel. Check the handle or URL.');
        return;
      }
      const saved = setMyChannel({
        id: data.id,
        title: data.title,
        handle: data.customUrl || undefined,
        thumbnail: data.thumbnails.high.url,
        subscriberCount: data.statistics.subscriberCount,
        viewCount: data.statistics.viewCount,
        videoCount: data.statistics.videoCount,
        publishedAt: data.publishedAt,
        uploadsPlaylistId: data.uploadsPlaylistId,
        connectedAt: new Date().toISOString(),
      });
      setChannel(saved);
      setConnectUrl('');

      // Niche + score arrive later; they enrich the brief but must not block it.
      analyzeChannelDemographics({
        title: data.title,
        description: data.description,
        viewCount: data.statistics.viewCount,
        subscriberCount: data.statistics.subscriberCount,
        videoCount: data.statistics.videoCount,
        publishedAt: data.publishedAt,
      })
        .then((d) => {
          const patched = patchMyChannel({ niche: d.estimatedNiche, performanceScore: d.performanceScore });
          if (patched) setChannel(patched);
        })
        .catch((e) => console.warn('Channel classification failed (non-blocking):', e));
    } catch (e: any) {
      setError(e?.message || 'Something went wrong connecting that channel.');
    } finally {
      setConnecting(false);
    }
  }

  function disconnect() {
    // Plans and the goal stay on disk, keyed by channel — reconnecting the same
    // channel restores them rather than silently destroying past work.
    clearMyChannel();
    setChannel(null);
    setVideos([]);
    setResult(null);
    setCalendar(null);
    activePlanRef.current = null;
    setActivePlanId(null);
  }

  // The whole diagnosis is derived — never typed by the user, never guessed.
  const metrics = useMemo(() => (channel ? computeMetrics(channel, videos) : null), [channel, videos]);
  const findings: Finding[] = useMemo(() => (metrics ? diagnose(metrics) : []), [metrics]);
  /** #8 — the channel's own outliers, so ideas build on what already worked here. */
  const winners = useMemo(() => (metrics ? ownWinners(videos, metrics) : []), [videos, metrics]);
  const brief = useMemo(
    () => (channel && metrics ? buildBrief(channel, metrics, findings, { winners, formula }) : ''),
    [channel, metrics, findings, winners, formula]
  );

  /**
   * Every generation belongs to a saved plan. Reuse the open one so the action
   * plan and the calendar land on the SAME record rather than forking history.
   *
   * This reads the id from a ref and the existing plans straight from storage,
   * never from React state: "generate plan" and "plan the month" are two separate
   * events, and a stale `plans` snapshot between them silently forked the record
   * in half — the action plan on one, the calendar on another.
   */
  function persist(patch: Partial<Omit<SavedPlan, 'id' | 'createdAt'>>) {
    if (!channel || !metrics) return;
    const openId = activePlanRef.current;
    const onDisk = listPlans(channel.id);

    if (openId && onDisk.some((p) => p.id === openId)) {
      updatePlan(openId, patch);
    } else {
      const created = savePlan({ channelId: channel.id, metrics, findings, brief, ...patch });
      activePlanRef.current = created.id;
      setActivePlanId(created.id);
    }
    setPlans(listPlans(channel.id));
  }

  async function generatePlan() {
    if (!brief) return;
    setPlanning(true);
    setError(null);
    try {
      const plan = await generateContentActionPlan({ channelAnalysisSummary: brief });
      setResult(plan);
      persist({ actionPlan: plan });
    } catch (e: any) {
      setError(e?.message || 'Could not generate the plan. Try again.');
    } finally {
      setPlanning(false);
    }
  }

  /**
   * The 30-day calendar. The slot grid — every date, weekday and time — is
   * computed here in code from the creator's real cadence and their own
   * best-performing publish slot. The model only fills the slots it is handed.
   */
  const slotPreview = useMemo(() => {
    if (!metrics || !videos.length) return null;
    const best = bestPublishSlot(videos);
    const slots = buildSlots({
      uploadsPerMonth: metrics.uploadsPerMonth,
      shortsShare: shortsShareOf(videos),
      bestSlot: best,
    });
    return { slots, best };
  }, [metrics, videos]);

  async function generateCalendar(ideas?: string[]) {
    if (!brief || !slotPreview?.slots.length) return;
    setCalendaring(true);
    setError(null);
    try {
      const cal = await generateContentCalendar({
        brief,
        niche: channel?.niche,
        slots: slotPreview.slots,
        ideas,
      });
      setCalendar(cal);
      persist({ calendar: cal });
      // The Content Calendar agent OWNS the schedule — this page diagnoses and
      // generates, then hands off to where it's edited, saved and shipped.
      router.push('/agents?agent=calendar-planner');
    } catch (e: any) {
      setError(e?.message || 'Could not build the calendar. Try again.');
    } finally {
      setCalendaring(false);
    }
  }

  /**
   * Hand the whole batch of ideas to the Title & Hook Doctor. Ten titles through
   * a URL would be unreadable, so they go via the inbox and we just redirect.
   */
  function sendIdeasToDoctor() {
    if (!result?.contentIdeas.length) return;
    setInbox(result.contentIdeas);
    router.push('/agents?agent=title-doctor');
  }

  /** Schedule the creator's OWN ideas rather than letting the model invent titles. */
  function scheduleIdeas() {
    if (!result?.contentIdeas.length) return;
    generateCalendar(result.contentIdeas);
  }

  function openPlan(plan: SavedPlan) {
    activePlanRef.current = plan.id;
    setActivePlanId(plan.id);
    setResult(plan.actionPlan ?? null);
    setCalendar(plan.calendar ?? null);
  }

  function removePlan(id: string) {
    deletePlan(id);
    if (!channel) return;
    setPlans(listPlans(channel.id));
    if (activePlanId === id) {
      activePlanRef.current = null;
      setActivePlanId(null);
      setResult(null);
      setCalendar(null);
    }
  }

  if (!mounted) return null;

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <SidebarNav />
      <main className="flex-1 overflow-y-auto p-8">
        <header className="mb-8">
          <h1 className="text-3xl font-bold tracking-tight text-foreground">Action Plan</h1>
          <p className="text-muted-foreground mt-1">
            {channel
              ? 'Read from your real uploads — not from a summary you had to write yourself.'
              : 'Connect your channel once, and the plan writes its own brief.'}
          </p>
        </header>

        <div className="max-w-4xl mx-auto space-y-6">
          {error && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>Error</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {!channel ? (
            <ConnectCard
              value={connectUrl}
              onChange={setConnectUrl}
              onConnect={connect}
              connecting={connecting}
            />
          ) : (
            <>
              <ChannelCard channel={channel} onDisconnect={disconnect} onRefresh={() => loadUploads(channel)} refreshing={loadingUploads} />

              {loadingUploads && !metrics && <DiagnosisSkeleton />}

              {!loadingUploads && !metrics && (
                <Card className="border-none shadow-sm">
                  <CardContent className="p-6 text-sm text-muted-foreground">
                    We couldn’t read any uploads for this channel, so there’s nothing to diagnose yet.
                  </CardContent>
                </Card>
              )}

              {metrics && (
                <>
                  {/* #7 — the goal, projected from real numbers and told straight. */}
                  <GoalCard
                    channel={channel}
                    metrics={metrics}
                    goal={goal}
                    onSet={(g) => setGoalState(persistGoal(g))}
                    onClear={() => { clearGoal(); setGoalState(null); }}
                  />

                  <MetricStrip metrics={metrics} />

                  {/* #3 — the prioritized diagnosis, each finding routing to its fix. */}
                  <section className="space-y-3">
                    <div className="flex items-center justify-between">
                      <h2 className="flex items-center gap-2 text-lg font-bold tracking-tight">
                        <Stethoscope className="h-4 w-4 text-primary" /> Fix this first
                      </h2>
                      <span className="label-caps">
                        from your last {metrics.sampleSize} uploads
                      </span>
                    </div>
                    <div className="grid gap-3">
                      {findings.map((f) => <FindingCard key={f.id} finding={f} />)}
                    </div>
                    <BlindSpots />
                  </section>

                  {/* The brief the model actually receives — auditable, not hidden. */}
                  <Collapsible open={briefOpen} onOpenChange={setBriefOpen}>
                    <CollapsibleTrigger asChild>
                      <button className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground hover:text-foreground transition-colors">
                        <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', briefOpen && 'rotate-180')} />
                        {briefOpen ? 'Hide' : 'Show'} the brief we send to the planner
                      </button>
                    </CollapsibleTrigger>
                    <CollapsibleContent>
                      <pre className="mt-2 whitespace-pre-wrap rounded-xl border bg-muted/40 p-4 text-micro leading-relaxed text-muted-foreground">
                        {brief}
                      </pre>
                    </CollapsibleContent>
                  </Collapsible>

                  <div className="grid gap-3 sm:grid-cols-2">
                    <Button onClick={generatePlan} disabled={planning} className="gap-2" size="lg">
                      {planning ? <Loader2 className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4 fill-current" />}
                      {planning ? 'Building your plan…' : 'Generate action plan'}
                    </Button>
                    <Button
                      onClick={() => generateCalendar()}
                      disabled={calendaring || !slotPreview?.slots.length}
                      variant="outline"
                      size="lg"
                      className="gap-2"
                    >
                      {calendaring ? <Loader2 className="h-4 w-4 animate-spin" /> : <CalendarDays className="h-4 w-4" />}
                      {calendaring ? 'Planning the month…' : 'Plan the next 30 days'}
                    </Button>
                  </div>

                  {/* The schedule is decided in code, so we can show it before
                      spending a model call on what goes in it. */}
                  {slotPreview?.slots.length && !calendar ? (
                    <p className="text-center text-xs text-muted-foreground">
                      We’ll plan <span className="font-semibold text-foreground">{slotPreview.slots.length} uploads</span>,
                      publishing {slotPreview.best ? 'on' : 'around'}{' '}
                      <span className="font-semibold text-foreground">{slotTimeLabel(slotPreview.slots[0])}</span>
                      {slotPreview.best
                        ? ` — the slot your own best uploads landed in (${slotPreview.best.count} of them).`
                        : ' — a safe default, since your uploads don’t yet favour one slot.'}
                    </p>
                  ) : null}
                </>
              )}
            </>
          )}

          {/* The calendar itself lives in the Content Calendar agent — this page
              generates it and points there, rather than keeping a second copy. */}
          {calendar && calendar.length > 0 && channel && (
            <Card className="border-none shadow-sm animate-in fade-in slide-in-from-bottom-4 duration-500">
              <CardContent className="flex flex-wrap items-center justify-between gap-3 p-5">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10">
                    <CalendarDays className="h-5 w-5 text-primary" />
                  </div>
                  <div>
                    <p className="text-sm font-bold">{calendar.length} uploads scheduled</p>
                    <p className="text-xs text-muted-foreground">
                      Edit, save and ship it in the Content Calendar.
                    </p>
                  </div>
                </div>
                <Button asChild size="sm" className="gap-1.5">
                  <Link href="/agents?agent=calendar-planner">
                    Open Content Calendar <ArrowRight className="h-3.5 w-3.5" />
                  </Link>
                </Button>
              </CardContent>
            </Card>
          )}

          {/* #9 — past plans, and whether the creator actually shipped them. */}
          {channel && plans.length > 0 && (
            <PlanHistory
              plans={plans}
              videos={videos}
              activeId={activePlanId ?? undefined}
              onOpen={openPlan}
              onDelete={removePlan}
            />
          )}

          {result && (
            <div className="space-y-4 animate-in fade-in slide-in-from-bottom-4 duration-500">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-bold tracking-tight text-foreground">Your plan</h2>
                <SendToMenu variant="light" {...planDeliverable(result)} />
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <Card className="border-none shadow-sm h-full">
                  <CardContent className="p-6 space-y-4">
                    <h3 className="flex items-center gap-2 font-bold">
                      <CheckCircle2 className="h-5 w-5 text-primary" /> Strategic Steps
                    </h3>
                    <ul className="space-y-3">
                      {result.strategicSteps.map((step, i) => (
                        <li key={i} className="flex gap-3 rounded-lg border bg-muted/40 p-3">
                          <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-micro font-bold text-primary tabular">
                            {i + 1}
                          </span>
                          <p className="text-sm font-medium text-foreground/80">{step}</p>
                        </li>
                      ))}
                    </ul>
                  </CardContent>
                </Card>

                <Card className="border-none shadow-sm h-full">
                  <CardContent className="p-6 space-y-4">
                    <h3 className="flex items-center gap-2 font-bold">
                      <Lightbulb className="h-5 w-5 text-amber-500" /> Content Ideas
                    </h3>

                    {/* Bulk hand-off — ideas are only worth generating if they can
                        leave this page and become work. */}
                    <div className="flex flex-wrap gap-2">
                      <Button size="sm" variant="outline" className="gap-1.5 text-xs" onClick={sendIdeasToDoctor}>
                        <Stethoscope className="h-3.5 w-3.5" />
                        Send all {result.contentIdeas.length} to Title Doctor
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="gap-1.5 text-xs"
                        onClick={scheduleIdeas}
                        disabled={calendaring || !slotPreview?.slots.length}
                      >
                        {calendaring ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CalendarDays className="h-3.5 w-3.5" />}
                        Schedule these
                      </Button>
                    </div>
                    {/* The arrow has to earn itself: each idea is already phrased as a
                        title, so clicking one opens the Title & Hook Doctor with it
                        loaded, ready to score and rewrite. */}
                    <ul className="space-y-2.5">
                      {result.contentIdeas.map((idea, i) => (
                        <li key={i}>
                          <Link
                            href={`/agents?agent=title-doctor&title=${encodeURIComponent(idea)}`}
                            className="group flex items-center justify-between gap-2 rounded-lg border p-3 transition-all hover:border-primary/40 hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                          >
                            <p className="text-sm font-semibold text-foreground">{idea}</p>
                            <span className="flex shrink-0 items-center gap-1 text-micro font-semibold text-muted-foreground/50 transition-colors group-hover:text-primary">
                              <span className="hidden sm:inline opacity-0 transition-opacity group-hover:opacity-100">Score it</span>
                              <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                            </span>
                          </Link>
                        </li>
                      ))}
                    </ul>
                  </CardContent>
                </Card>
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

// --- Pieces -----------------------------------------------------------------

function ConnectCard({
  value, onChange, onConnect, connecting,
}: {
  value: string; onChange: (v: string) => void; onConnect: () => void; connecting: boolean;
}) {
  return (
    <Card className="border-none shadow-sm">
      <CardContent className="p-8 text-center space-y-5">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10">
          <Youtube className="h-6 w-6 text-primary" />
        </div>
        <div className="space-y-1.5">
          <h2 className="text-xl font-bold tracking-tight">Connect your channel</h2>
          <p className="mx-auto max-w-md text-sm text-muted-foreground">
            We’ll read your real uploads and diagnose what’s actually holding the channel back —
            no writing a summary of yourself first.
          </p>
        </div>
        <div className="mx-auto flex max-w-lg flex-col gap-2 sm:flex-row">
          <input
            type="text"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !connecting) onConnect(); }}
            placeholder="youtube.com/@yourchannel"
            aria-label="Your channel URL, handle, or ID"
            className="h-11 flex-1 rounded-full border border-input bg-card px-4 text-sm transition-shadow placeholder:text-muted-foreground/70 focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/40"
          />
          <Button onClick={onConnect} disabled={connecting || !value.trim()} className="h-11 rounded-full px-6">
            {connecting ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Connect'}
          </Button>
        </div>
        <p className="text-micro text-muted-foreground/70">
          Stored on this device only. Reused across the Studio, Compare, and your agents.
        </p>
      </CardContent>
    </Card>
  );
}

function ChannelCard({
  channel, onDisconnect, onRefresh, refreshing,
}: {
  channel: MyChannel; onDisconnect: () => void; onRefresh: () => void; refreshing: boolean;
}) {
  return (
    <Card className="border-none shadow-sm">
      <CardContent className="flex flex-wrap items-center gap-4 p-5">
        <img src={channel.thumbnail} alt="" className="h-12 w-12 shrink-0 rounded-full object-cover ring-1 ring-border" />
        <div className="min-w-0 flex-1">
          <p className="truncate font-bold">{channel.title}</p>
          <p className="text-xs text-muted-foreground">
            {formatNumber(channel.subscriberCount)} subs · {formatNumber(channel.viewCount)} views
            {channel.niche ? ` · ${channel.niche}` : ''}
          </p>
        </div>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="sm" onClick={onRefresh} disabled={refreshing} className="gap-1.5 text-xs">
            <RefreshCw className={cn('h-3.5 w-3.5', refreshing && 'animate-spin')} /> Refresh
          </Button>
          <Button variant="ghost" size="sm" onClick={onDisconnect} className="gap-1.5 text-xs text-muted-foreground hover:text-destructive">
            <Unplug className="h-3.5 w-3.5" /> Disconnect
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function MetricStrip({ metrics }: { metrics: ReturnType<typeof computeMetrics> }) {
  if (!metrics) return null;
  const items = [
    { label: 'Uploads / month', value: metrics.uploadsPerMonth.toFixed(1) },
    { label: 'Median views', value: formatNumber(metrics.medianViews) },
    { label: 'Best upload', value: formatNumber(metrics.topViews) },
    {
      label: 'Momentum',
      value: `${Math.round(metrics.momentum * 100)}%`,
      tone: metrics.momentum < 0.7 ? 'text-rose-600' : metrics.momentum > 1.3 ? 'text-emerald-600' : '',
    },
  ];
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
      {items.map((i) => (
        <Card key={i.label} className="border-none shadow-sm">
          <CardContent className="p-4">
            <p className={cn('text-xl font-bold tabular', i.tone)}>{i.value}</p>
            <p className="label-caps mt-1">{i.label}</p>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function FindingCard({ finding }: { finding: Finding }) {
  const s = SEVERITY_STYLE[finding.severity];
  return (
    <Card className="border-none shadow-sm overflow-hidden">
      <CardContent className="flex gap-4 p-5">
        <span className={cn('w-1 shrink-0 rounded-full', s.bar)} />
        <div className="min-w-0 flex-1 space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-bold">{finding.label}</span>
            <span className={cn('rounded-full px-2 py-0.5 text-micro font-semibold uppercase tracking-wider', s.chip)}>
              {s.label}
            </span>
          </div>
          <p className="text-sm font-semibold text-foreground">{finding.headline}</p>
          <p className="text-xs leading-relaxed text-muted-foreground">{finding.detail}</p>
          {finding.severity !== 'good' && (
            <p className="text-xs leading-relaxed text-foreground/80">
              <span className="font-semibold">Do this: </span>{finding.action}
            </p>
          )}
        </div>
        {finding.route && (
          <Button asChild variant="outline" size="sm" className="shrink-0 gap-1.5 self-center text-xs">
            <Link href={finding.route.href}>
              {finding.route.label} <ArrowRight className="h-3 w-3" />
            </Link>
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

/** Say what we cannot see. A tool that invents a CTR is worse than one that admits it has none. */
function BlindSpots() {
  return (
    <div className="flex items-start gap-2.5 rounded-xl border border-dashed p-3.5">
      <EyeOff className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground/60" />
      <p className="text-xs leading-relaxed text-muted-foreground">
        <span className="font-semibold text-foreground/80">What we can’t see: </span>
        {BLIND_SPOTS.join(', ')} — none of these are in YouTube’s public API, so nothing above is guessing at them.
        For a read on those, paste your Studio numbers into{' '}
        <Link href="/analyzer" className="font-semibold text-primary hover:underline">Video Performance</Link>.
      </p>
    </div>
  );
}

function DiagnosisSkeleton() {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <Card key={i} className="border-none shadow-sm">
            <CardContent className="space-y-2 p-4">
              <Skeleton className="h-6 w-16" />
              <Skeleton className="h-2.5 w-20" />
            </CardContent>
          </Card>
        ))}
      </div>
      {[0, 1, 2].map((i) => (
        <Card key={i} className="border-none shadow-sm">
          <CardContent className="space-y-2 p-5">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-4 w-56" />
            <Skeleton className="h-3 w-full" />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
