'use client';

import { useState, useCallback, useEffect } from 'react';
import { getMyChannel } from '@/lib/my-channel';
import { SidebarNav } from '@/components/dashboard/SidebarNav';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import {
  GitCompareArrows, Search, Loader2, X, Plus, Crown, AlertCircle, Fingerprint, DollarSign, Target
} from 'lucide-react';
import { fetchYouTubeChannelData, type YouTubeChannelData } from '@/services/youtube';
import { analyzeChannelDemographics, type AnalyzeChannelOutput } from '@/ai/flows/analyze-channel-demographics-flow';
import { analyzeChannelOverview, type AnalyzeChannelOverviewOutput } from '@/ai/flows/analyze-channel-overview-flow';

const MAX_SLOTS = 3;
let nextId = 1;

interface Slot {
  id: number;
  input: string;
  loading: boolean;
  error: string | null;
  data: YouTubeChannelData | null;
  demographics: AnalyzeChannelOutput | null;
  overview: AnalyzeChannelOverviewOutput | null;
}

const emptySlot = (): Slot => ({ id: nextId++, input: '', loading: false, error: null, data: null, demographics: null, overview: null });

const formatNumber = (num?: string | number) => {
  if (!num) return '0';
  const n = typeof num === 'string' ? parseInt(num) : num;
  if (isNaN(n)) return '0';
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
  if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
  return n.toString();
};

export default function ComparePage() {
  const [slots, setSlots] = useState<Slot[]>([emptySlot(), emptySlot()]);

  const patch = useCallback((id: number, changes: Partial<Slot>) => {
    setSlots(prev => prev.map(s => (s.id === id ? { ...s, ...changes } : s)));
  }, []);

  // You are always one side of a comparison — prefill the left slot with the
  // connected channel so the creator only has to name the rival.
  useEffect(() => {
    const mine = getMyChannel();
    if (!mine) return;
    setSlots(prev => {
      if (prev[0].input) return prev;
      const next = [...prev];
      next[0] = { ...next[0], input: mine.handle || mine.id };
      return next;
    });
  }, []);

  const loadSlot = useCallback(async (id: number, rawInput: string) => {
    const input = rawInput.trim();
    if (!input) return;
    patch(id, { loading: true, error: null, data: null, demographics: null, overview: null });
    try {
      const data = await fetchYouTubeChannelData(input);
      if (!data) {
        patch(id, { loading: false, error: 'Channel not found.' });
        return;
      }
      patch(id, { data, loading: false });
      const [demo, over] = await Promise.allSettled([
        analyzeChannelDemographics({
          title: data.title, description: data.description,
          viewCount: data.statistics.viewCount, subscriberCount: data.statistics.subscriberCount,
          videoCount: data.statistics.videoCount, publishedAt: data.publishedAt,
        }),
        analyzeChannelOverview({
          channelTitle: data.title, channelDescription: data.description,
          recentVideoTitles: [], recentVideoDescriptions: [],
        }),
      ]);
      patch(id, {
        demographics: demo.status === 'fulfilled' ? demo.value : null,
        overview: over.status === 'fulfilled' ? over.value : null,
      });
    } catch (err: any) {
      patch(id, { loading: false, error: err?.message || 'Failed to load channel.' });
    }
  }, [patch]);

  const addSlot = () => setSlots(prev => (prev.length < MAX_SLOTS ? [...prev, emptySlot()] : prev));
  const removeSlot = (id: number) => setSlots(prev => (prev.length > 2 ? prev.filter(s => s.id !== id) : prev));

  const loaded = slots.filter(s => s.data);
  const maxSubs = Math.max(...loaded.map(s => parseInt(s.data!.statistics.subscriberCount) || 0), 0);
  const maxViews = Math.max(...loaded.map(s => parseInt(s.data!.statistics.viewCount) || 0), 0);
  const maxScore = Math.max(...loaded.map(s => s.demographics?.performanceScore || 0), 0);

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <SidebarNav />
      <main className="flex-1 overflow-y-auto p-8">
        <header className="mb-8">
          <div className="flex items-center gap-2 mb-1">
            <GitCompareArrows className="h-6 w-6 text-primary" />
            <h1 className="text-3xl font-bold tracking-tight text-slate-900">Compare Channels</h1>
          </div>
          <p className="text-muted-foreground">Put competitors side by side — stats, identity, audience, and monetization at a glance.</p>
        </header>

        <div className={cn('grid gap-6', slots.length === 2 ? 'md:grid-cols-2' : 'md:grid-cols-3')}>
          {slots.map((slot, idx) => (
            <div key={slot.id} className="space-y-4">
              <div className="flex items-center gap-2">
                <span className="text-[11px] font-bold uppercase tracking-widest text-slate-400">Channel {String.fromCharCode(65 + idx)}</span>
                {slots.length > 2 && <button onClick={() => removeSlot(slot.id)} className="ml-auto text-slate-300 hover:text-rose-500"><X className="h-4 w-4" /></button>}
              </div>
              <div className="flex items-center gap-2">
                <Input
                  placeholder="URL, @handle, or ID…"
                  value={slot.input}
                  onChange={(e) => patch(slot.id, { input: e.target.value })}
                  onKeyDown={(e) => { if (e.key === 'Enter') loadSlot(slot.id, slot.input); }}
                  className="rounded-full h-9"
                />
                <Button size="sm" onClick={() => loadSlot(slot.id, slot.input)} disabled={slot.loading} className="rounded-full shrink-0">
                  {slot.loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                </Button>
              </div>

              {slot.error && <div className="flex items-center gap-2 text-xs text-rose-600"><AlertCircle className="h-3.5 w-3.5" /> {slot.error}</div>}
              {slot.loading && !slot.data && <Skeleton className="h-72 w-full rounded-2xl" />}

              {slot.data && (
                <Card className="border-none shadow-sm animate-in fade-in">
                  <CardContent className="p-5 space-y-4">
                    <div className="flex items-center gap-3">
                      <div className="h-12 w-12 rounded-full overflow-hidden border-2 shrink-0"><img src={slot.data.thumbnails.default.url} alt="" className="h-full w-full object-cover" /></div>
                      <div className="min-w-0">
                        <h3 className="font-bold truncate">{slot.data.title}</h3>
                        <p className="text-xs text-slate-500 truncate">{slot.demographics?.estimatedNiche || slot.overview?.identity.nicheTag || '—'}</p>
                      </div>
                    </div>

                    <div className="grid grid-cols-3 gap-2 text-center bg-slate-50 rounded-xl p-3">
                      <Stat label="Subs" value={formatNumber(slot.data.statistics.subscriberCount)} leader={maxSubs > 0 && parseInt(slot.data.statistics.subscriberCount) === maxSubs} />
                      <Stat label="Views" value={formatNumber(slot.data.statistics.viewCount)} leader={maxViews > 0 && parseInt(slot.data.statistics.viewCount) === maxViews} />
                      <Stat label="Videos" value={formatNumber(slot.data.statistics.videoCount)} />
                    </div>

                    <Row icon={<Target className="h-3.5 w-3.5 text-primary" />} label="Performance">
                      {slot.demographics ? (
                        <div className="flex items-center gap-2">
                          <span className={cn('font-bold', maxScore > 0 && slot.demographics.performanceScore === maxScore && 'text-primary')}>{slot.demographics.performanceScore}/100</span>
                          {maxScore > 0 && slot.demographics.performanceScore === maxScore && <Crown className="h-3.5 w-3.5 text-amber-500" />}
                          <Badge className="bg-slate-100 text-slate-600 border-none text-[9px] uppercase ml-auto">{slot.demographics.growthStage}</Badge>
                        </div>
                      ) : <MiniSkeleton />}
                    </Row>

                    <Row icon={<Fingerprint className="h-3.5 w-3.5 text-primary" />} label="Identity">
                      {slot.overview ? (
                        <div className="space-y-1">
                          <Badge variant="outline" className="text-[9px] uppercase">{slot.overview.identity.contentTone}</Badge>
                          <p className="text-xs text-slate-600">{slot.overview.identity.targetAudience}</p>
                        </div>
                      ) : <MiniSkeleton />}
                    </Row>

                    <Row icon={<Target className="h-3.5 w-3.5 text-emerald-500" />} label="Audience">
                      {slot.demographics ? <p className="text-xs text-slate-600">{slot.demographics.audiencePersona}</p> : <MiniSkeleton />}
                    </Row>

                    <Row icon={<DollarSign className="h-3.5 w-3.5 text-blue-500" />} label="Monetization">
                      {slot.overview ? (
                        <div className="flex flex-wrap gap-1.5">
                          <Badge className="bg-blue-50 text-blue-700 border-none text-[9px] uppercase">{slot.overview.monetization.revenueStage}</Badge>
                          {slot.overview.monetization.hasAdSense && <Badge variant="outline" className="text-[9px]">ADSENSE</Badge>}
                          {slot.overview.monetization.hasSponsorships && <Badge variant="outline" className="text-[9px]">SPONSORS</Badge>}
                          {slot.overview.monetization.hasMerch && <Badge variant="outline" className="text-[9px]">MERCH</Badge>}
                          {slot.overview.monetization.hasMemberships && <Badge variant="outline" className="text-[9px]">MEMBERS</Badge>}
                        </div>
                      ) : <MiniSkeleton />}
                    </Row>
                  </CardContent>
                </Card>
              )}
            </div>
          ))}
        </div>

        {slots.length < MAX_SLOTS && (
          <Button variant="outline" onClick={addSlot} className="mt-6 rounded-full gap-2">
            <Plus className="h-4 w-4" /> Add another channel
          </Button>
        )}
      </main>
    </div>
  );
}

function Stat({ label, value, leader }: { label: string; value: string; leader?: boolean }) {
  return (
    <div>
      <p className={cn('text-sm font-bold flex items-center justify-center gap-1', leader && 'text-primary')}>
        {value}{leader && <Crown className="h-3 w-3 text-amber-500" />}
      </p>
      <p className="text-[9px] font-bold text-slate-400 uppercase">{label}</p>
    </div>
  );
}

function Row({ icon, label, children }: { icon: React.ReactNode; label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5 border-t border-slate-50 pt-3">
      <div className="flex items-center gap-1.5 text-[10px] font-bold text-slate-400 uppercase tracking-wider">{icon}{label}</div>
      {children}
    </div>
  );
}

function MiniSkeleton() {
  return <Skeleton className="h-4 w-3/4" />;
}
