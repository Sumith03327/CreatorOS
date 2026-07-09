'use client';

import { useState, useRef, useEffect } from 'react';
import {
  Sparkles, ImageIcon, Upload, X, Download, RefreshCw, Loader2, Wand2, Youtube, Check, ChevronLeft, Trash2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { toast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { analyzeChannelStyle } from '@/ai/flows/analyze-channel-style';
import { generateThumbnailQuestions, type ThumbnailQuestion } from '@/ai/flows/thumbnail-questions';
import * as store from '@/services/agent-store';
import type { SavedThumbnail } from '@/services/agent-store';

const SIZES = [
  { value: '1536x1024', label: 'Wide 16:9-ish (1536×1024)' },
  { value: '1024x1024', label: 'Square (1024×1024)' },
  { value: '1024x1536', label: 'Tall (1024×1536)' },
];

type Step = 'input' | 'refine' | 'results';

export function ThumbnailStudio({ onBack }: { onBack: () => void }) {
  const [step, setStep] = useState<Step>('input');

  // Inputs
  const [channelUrl, setChannelUrl] = useState('');
  const [title, setTitle] = useState('');
  const [size, setSize] = useState('1536x1024');
  const [count, setCount] = useState('2');
  const [notes, setNotes] = useState('');
  const [faceFile, setFaceFile] = useState<File | null>(null);
  const [facePreview, setFacePreview] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Analysis + questions
  const [analyzing, setAnalyzing] = useState(false);
  const [channelTitle, setChannelTitle] = useState('');
  const [styleProfile, setStyleProfile] = useState('');
  const [samples, setSamples] = useState<string[]>([]);
  const [isFaceDriven, setIsFaceDriven] = useState(false);
  const [creatorDescription, setCreatorDescription] = useState('');
  const [featureMe, setFeatureMe] = useState(true); // reproduce the creator from their channel
  const [questions, setQuestions] = useState<ThumbnailQuestion[]>([]);
  const [answers, setAnswers] = useState<Record<string, string>>({});

  // Generation
  const [loading, setLoading] = useState(false);
  const [images, setImages] = useState<string[]>([]);

  // Persisted gallery of previously generated thumbnails
  const [gallery, setGallery] = useState<SavedThumbnail[]>([]);
  useEffect(() => {
    store.listThumbnails().then(setGallery);
  }, []);

  function onPickFace(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      toast({ variant: 'destructive', title: 'Not an image', description: 'Upload a PNG or JPG.' });
      return;
    }
    setFaceFile(file);
    setFacePreview(URL.createObjectURL(file));
  }
  function clearFace() {
    setFaceFile(null);
    setFacePreview('');
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  async function analyzeAndContinue() {
    if (!title.trim()) {
      toast({ variant: 'destructive', title: 'Add a title', description: 'What is the video about?' });
      return;
    }
    setAnalyzing(true);
    try {
      let profile = '';
      let cTitle = '';
      let sample: string[] = [];
      let faceDriven = false;
      let creatorDesc = '';
      if (channelUrl.trim()) {
        const res = await analyzeChannelStyle(channelUrl.trim());
        profile = res.styleProfile;
        cTitle = res.channelTitle;
        sample = res.sampleThumbnails;
        faceDriven = res.isFaceDriven;
        creatorDesc = res.creatorDescription;
      }
      setStyleProfile(profile);
      setChannelTitle(cTitle);
      setSamples(sample);
      setIsFaceDriven(faceDriven);
      setCreatorDescription(creatorDesc);
      setFeatureMe(faceDriven); // default on when the channel is face-driven

      const qs = await generateThumbnailQuestions(title.trim(), profile || 'bold high-CTR YouTube style');
      setQuestions(qs);
      setAnswers({});
      setStep('refine');
    } catch (err: any) {
      console.error(err);
      toast({ variant: 'destructive', title: 'Analysis failed', description: err?.message || 'Try again.' });
    } finally {
      setAnalyzing(false);
    }
  }

  async function generate() {
    setLoading(true);
    setStep('results');
    try {
      const form = new FormData();
      form.append('title', title.trim());
      form.append('style', 'mrbeast'); // preset fallback; styleProfile drives the look when present
      form.append('size', size);
      form.append('n', count);
      if (notes.trim()) form.append('notes', notes.trim());
      if (styleProfile) form.append('styleProfile', styleProfile);
      if (channelTitle) form.append('channelTitle', channelTitle);
      if (Object.keys(answers).length) form.append('answers', JSON.stringify(answers));
      if (faceFile) form.append('face', faceFile);
      // Reproduce the creator from their channel thumbnails when "feature me" is on
      // (and they didn't upload their own photo).
      if (featureMe && !faceFile && samples.length) {
        form.append('referenceUrls', JSON.stringify(samples.slice(0, 3)));
        if (creatorDescription) form.append('identityDescription', creatorDescription);
      }

      const res = await fetch('/api/thumbnails', { method: 'POST', body: form });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || `Request failed (${res.status})`);
      const next: string[] = data.images ?? [];
      setImages(next);
      if (next.length) {
        const updated = await store.addThumbnails(next, {
          title: title.trim(),
          channelTitle: channelTitle || undefined,
        });
        setGallery(updated);
      }
    } catch (err: any) {
      console.error(err);
      toast({ variant: 'destructive', title: 'Generation failed', description: err?.message || 'Try again.' });
      setStep('refine');
    } finally {
      setLoading(false);
    }
  }

  function download(src: string, i: number) {
    const a = document.createElement('a');
    a.href = src;
    a.download = `thumbnail-${Date.now()}-${i + 1}.png`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  async function removeFromGallery(id: string) {
    setGallery(await store.removeThumbnail(id));
  }

  const n = parseInt(count, 10) || 2;

  return (
    <div className="max-w-5xl mx-auto space-y-6 py-2 animate-in fade-in">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={onBack}><ChevronLeft className="h-5 w-5" /></Button>
        <div className="h-11 w-11 rounded-2xl bg-gradient-to-br from-fuchsia-500 to-indigo-500 flex items-center justify-center shrink-0">
          <ImageIcon className="h-5 w-5 text-white" />
        </div>
        <div>
          <h2 className="font-bold text-lg text-slate-900">Thumbnail Studio</h2>
          <p className="text-xs text-slate-500">Reads your channel’s style, asks a few questions, then designs.</p>
        </div>
      </div>

      {/* STEP 1 — inputs */}
      {step === 'input' && (
        <Card className="border-none shadow-sm">
          <CardContent className="p-6 space-y-5">
            <div className="space-y-2">
              <Label>Your channel <span className="text-slate-400 font-normal">(optional — for style matching)</span></Label>
              <div className="flex items-center gap-2 bg-slate-50 rounded-xl px-3">
                <Youtube className="h-4 w-4 text-red-500 shrink-0" />
                <Input
                  placeholder="https://youtube.com/@yourchannel"
                  value={channelUrl}
                  onChange={(e) => setChannelUrl(e.target.value)}
                  className="border-none bg-transparent shadow-none focus-visible:ring-0 px-0"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label>Video title or topic</Label>
              <Input placeholder="e.g., I Survived 100 Hours in the Wild" value={title} onChange={(e) => setTitle(e.target.value)} />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Aspect ratio</Label>
                <Select value={size} onValueChange={setSize}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{SIZES.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Variations</Label>
                <Select value={count} onValueChange={setCount}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{['1', '2', '3', '4'].map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <Label>Your face or logo <span className="text-slate-400 font-normal">(optional)</span></Label>
              {facePreview ? (
                <div className="relative w-full h-28 rounded-xl overflow-hidden border">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={facePreview} alt="reference" className="w-full h-full object-cover" />
                  <button onClick={clearFace} className="absolute top-2 right-2 h-7 w-7 rounded-full bg-black/60 text-white flex items-center justify-center hover:bg-black/80"><X className="h-4 w-4" /></button>
                </div>
              ) : (
                <button onClick={() => fileInputRef.current?.click()} className="w-full h-28 rounded-xl border-2 border-dashed flex flex-col items-center justify-center gap-2 text-slate-400 hover:border-primary/50 hover:text-primary transition-colors">
                  <Upload className="h-5 w-5" />
                  <span className="text-xs">Upload a photo to feature yourself</span>
                </button>
              )}
              <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={onPickFace} />
            </div>

            <Button className="w-full gap-2" onClick={analyzeAndContinue} disabled={analyzing}>
              {analyzing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              {analyzing ? (channelUrl.trim() ? 'Reading your thumbnails…' : 'Thinking…') : 'Analyze & Continue'}
            </Button>
          </CardContent>
        </Card>
      )}

      {/* STEP 2 — refine (style + questions) */}
      {step === 'refine' && (
        <div className="space-y-5">
          {(styleProfile || samples.length > 0) && (
            <Card className="border-none shadow-sm bg-gradient-to-br from-indigo-50 to-fuchsia-50">
              <CardContent className="p-5 space-y-3">
                <div className="flex items-center gap-2 text-sm font-bold text-slate-800">
                  <Check className="h-4 w-4 text-emerald-500" /> Detected {channelTitle ? `${channelTitle}'s` : 'the'} thumbnail style
                </div>
                {samples.length > 0 && (
                  <div className="flex gap-2 overflow-x-auto pb-1">
                    {samples.map((s, i) => (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img key={i} src={s} alt="sample" className="h-16 rounded-lg object-cover shrink-0" />
                    ))}
                  </div>
                )}
                <p className="text-xs text-slate-600 whitespace-pre-wrap leading-relaxed">{styleProfile}</p>

                {isFaceDriven && !faceFile && (
                  <div className="flex items-center justify-between gap-3 rounded-xl bg-white/70 p-3">
                    <div>
                      <p className="text-xs font-bold text-slate-800">Feature you (from your channel)</p>
                      <p className="text-[11px] text-slate-500">We spotted a recurring creator — we’ll reproduce your face. No photo upload needed.</p>
                    </div>
                    <Switch checked={featureMe} onCheckedChange={setFeatureMe} />
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          <Card className="border-none shadow-sm">
            <CardContent className="p-6 space-y-5">
              <p className="text-sm font-bold text-slate-800">A few quick choices</p>
              {questions.map((q, qi) => (
                <div key={qi} className="space-y-2">
                  <Label className="text-slate-700">{q.question}</Label>
                  <div className="flex flex-wrap gap-2">
                    {q.options.map((opt) => (
                      <button
                        key={opt}
                        onClick={() => setAnswers((a) => ({ ...a, [q.question]: opt }))}
                        className={cn(
                          'px-3 py-1.5 rounded-full text-xs font-medium border transition-all',
                          answers[q.question] === opt
                            ? 'bg-primary text-white border-primary'
                            : 'bg-white text-slate-600 border-slate-200 hover:border-primary/50'
                        )}
                      >
                        {opt}
                      </button>
                    ))}
                  </div>
                  <Input
                    placeholder="…or type your own"
                    className="h-8 text-xs"
                    value={answers[q.question] && !q.options.includes(answers[q.question]) ? answers[q.question] : ''}
                    onChange={(e) => setAnswers((a) => ({ ...a, [q.question]: e.target.value }))}
                  />
                </div>
              ))}
              <div className="space-y-2">
                <Label className="text-slate-700">Anything else? <span className="text-slate-400 font-normal">(optional)</span></Label>
                <Textarea placeholder="e.g., add a jungle background, use green and yellow" className="min-h-[60px]" value={notes} onChange={(e) => setNotes(e.target.value)} />
              </div>

              <div className="flex gap-2">
                <Button variant="outline" className="gap-2" onClick={() => setStep('input')}><ChevronLeft className="h-4 w-4" /> Back</Button>
                <Button className="flex-1 gap-2" onClick={generate} disabled={loading}>
                  <Wand2 className="h-4 w-4" /> Generate Thumbnails
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* STEP 3 — results */}
      {step === 'results' && (
        <div className="space-y-4">
          {loading ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {Array.from({ length: n }).map((_, i) => <Skeleton key={i} className="w-full aspect-video rounded-xl" />)}
            </div>
          ) : (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {images.map((src, i) => (
                  <Card key={i} className="border-none shadow-sm overflow-hidden">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={src} alt={`thumbnail ${i + 1}`} className="w-full aspect-video object-cover" />
                    <div className="p-3">
                      <Button variant="outline" size="sm" className="w-full gap-1.5" onClick={() => download(src, i)}>
                        <Download className="h-3.5 w-3.5" /> Download
                      </Button>
                    </div>
                  </Card>
                ))}
              </div>
              <div className="flex gap-2">
                <Button variant="outline" className="gap-2" onClick={() => setStep('refine')}><ChevronLeft className="h-4 w-4" /> Tweak choices</Button>
                <Button className="gap-2" onClick={generate} disabled={loading}><RefreshCw className="h-4 w-4" /> Regenerate</Button>
              </div>
            </>
          )}
        </div>
      )}

      {/* Persisted gallery — previously generated thumbnails, survive refresh */}
      {gallery.length > 0 && (
        <section className="space-y-3 pt-2">
          <h3 className="text-[11px] font-bold uppercase tracking-widest text-slate-500">Your Thumbnails</h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
            {gallery.map((t) => (
              <div key={t.id} className="group relative rounded-xl overflow-hidden border shadow-sm">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={t.src} alt={t.title} className="w-full aspect-video object-cover" />
                <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col justify-between p-2">
                  <div className="flex justify-end gap-1">
                    <button
                      onClick={() => download(t.src, 0)}
                      className="h-7 w-7 rounded-full bg-white/90 text-slate-700 hover:bg-white flex items-center justify-center"
                      title="Download"
                    >
                      <Download className="h-3.5 w-3.5" />
                    </button>
                    <button
                      onClick={() => removeFromGallery(t.id)}
                      className="h-7 w-7 rounded-full bg-white/90 text-slate-700 hover:text-destructive hover:bg-white flex items-center justify-center"
                      title="Remove"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  <p className="text-[10px] text-white/90 line-clamp-2 leading-tight">{t.title}</p>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
