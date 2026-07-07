
'use client';

import { useState, useEffect, useMemo, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Image from 'next/image';
import { 
  Zap, 
  Loader2, 
  Sparkles, 
  Copy, 
  FileText, 
  MonitorPlay,
  Clock,
  ChevronLeft,
  PlayCircle,
  Edit3,
  Wand2,
  TrendingUp,
  AlertCircle,
  Layers,
  Magnet,
  Flame,
  Layout,
  CheckCircle2
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useFirebase, doc, getDoc, setDoc, collection, query, orderBy, limit, getDocs, serverTimestamp, Timestamp } from '@/firebase';
import { fetchVideoDetails, fetchSupadataTranscript, fetchAssemblyAITranscript, fetchTranscript, type YouTubeVideoData } from '@/services/youtube';
import { callMesh } from '@/services/mesh';
import { toast } from '@/hooks/use-toast';
import { SidebarNav } from '@/components/dashboard/SidebarNav';
import { cn } from '@/lib/utils';

// --- Types ---

type Mode = 'ENTRY' | 'MODE_A' | 'MODE_B' | 'MODE_C' | 'RESULT' | 'TABS';

interface MaxAnalysisResult {
  generatedScript?: any;
  overallScore: number;
  hookAnalysis: {
    score: number;
    hookText: string;
    strength: 'Weak' | 'Average' | 'Strong' | 'Exceptional';
    rewrittenHook: string;
  };
  scriptStructure: {
    hook: { percentage: number; description: string };
    buildup: { percentage: number; description: string };
    coreContent: { percentage: number; description: string };
    climax: { percentage: number; description: string };
    cta: { percentage: number; description: string };
  };
  energyMap: Array<{ zone: 'High' | 'Medium' | 'Low'; label: string; percentage: number }>;
  strongestMoment: { quote: string; reason: string };
  weakestMoment: { quote: string; reason: string };
  titleSuggestions: Array<{ title: string; psychology: 'Curiosity' | 'Value' | 'Fear' | 'Story' | 'Challenge' }>;
  thumbnailTextIdeas: string[];
  patternDetected: { name: string; explanation: string };
  idealVideoLength: { range: string; reasoning: string };
  oneBigSuggestion: string;
}

const LOADING_MESSAGES = [
  "Max is reading the script...",
  "Analyzing hook strength...",
  "Mapping the energy flow...",
  "Finding the strongest moments...",
  "Building your title options...",
  "Almost done..."
];

// --- Helpers ---

const cleanTranscriptJs = (text: string): string => {
  let cleaned = text.replace(/\[\d{1,2}:\d{2}(:\d{2})?\]|\(\d{1,2}:\d{2}(:\d{2})?\)/g, '');
  cleaned = cleaned.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"');
  cleaned = cleaned.replace(/\s+/g, ' ').trim();
  return cleaned;
};

const cleanJsonResponse = (str: string) => {
  return str.replace(/```json\n?|```/g, '').trim();
};

const formatScriptText = (script: any): string => {
  if (!script) return '';
  if (typeof script === 'string') return script;
  if (typeof script === 'object') {
    return Object.entries(script)
      .map(([key, value]) => `[${key.toUpperCase()}]\n${value}`)
      .join('\n\n');
  }
  return String(script);
};

const hashCode = (str: string) => {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(36);
};

// --- Main Component ---

function MaxAnalyzerContent() {
  const searchParams = useSearchParams();
  const videoIdsFromParam = useMemo(() => searchParams.get('videoIds')?.split(',').filter(id => !!id) || [], [searchParams]);
  const { user } = useFirebase();

  // Navigation State
  const [mode, setMode] = useState<Mode>('ENTRY');
  const [loading, setLoading] = useState(false);
  const [loadingMsgIdx, setLoadingMsgIdx] = useState(0);

  // Input States
  const [urlInput, setUrlInput] = useState('');
  const [scriptInput, setScriptInput] = useState('');
  const [topicInput, setTopicInput] = useState('');
  const [audienceInput, setAudienceInput] = useState('');
  const [toneInput, setToneInput] = useState('Conversational');
  const [lengthInput, setLengthInput] = useState('Medium');
  const [ctaInput, setCtaInput] = useState('');

  // Result States
  const [activeAnalysis, setActiveAnalysis] = useState<{
    id: string;
    title: string;
    thumbnailUrl: string;
    mode: 'A' | 'B' | 'C';
    result: MaxAnalysisResult;
    rawText: string;
  } | null>(null);
  const [recentAnalyses, setRecentAnalyses] = useState<any[]>([]);

  // Existing Tab-based State
  const [tabVideos, setTabVideos] = useState<Record<string, YouTubeVideoData>>({});
  const [tabTranscripts, setTabTranscripts] = useState<Record<string, string>>({});

  useEffect(() => {
    if (videoIdsFromParam.length > 0) {
      setMode('TABS');
      processTabVideos(videoIdsFromParam);
    } else {
      loadRecentAnalyses();
    }
  }, [videoIdsFromParam, user]);

  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (loading) {
      interval = setInterval(() => {
        setLoadingMsgIdx((prev) => (prev + 1) % LOADING_MESSAGES.length);
      }, 2000);
    }
    return () => clearInterval(interval);
  }, [loading]);

  async function loadRecentAnalyses() {
    if (!user) return;
    try {
      // Manual mock: read from history collection in localStorage
      const results = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key?.startsWith(`fs_users/${user.uid}/scriptAnalyses/`)) {
          results.push(JSON.parse(localStorage.getItem(key)!));
        }
      }
      setRecentAnalyses(results.sort((a,b) => new Date(b.analyzedAt).getTime() - new Date(a.analyzedAt).getTime()).slice(0, 3));
    } catch (e) {
      console.error("Load recent failed:", e);
    }
  }

  // --- Core Processing Functions ---

  async function processTabVideos(ids: string[]) {
    if (!user) return;
    setLoading(true);
    const detailsMap: Record<string, YouTubeVideoData> = {};
    const transcriptsMap: Record<string, string> = {};
    for (const id of ids) {
      try {
        const details = await fetchVideoDetails(id);
        if (details) detailsMap[id] = details;
        const transcript = await getTranscript(id);
        if (transcript) transcriptsMap[id] = transcript;
      } catch (e) {}
    }
    setTabVideos(detailsMap);
    setTabTranscripts(transcriptsMap);
    setLoading(false);
  }

  async function getTranscript(videoId: string): Promise<string | null> {
    let rawText = await fetchSupadataTranscript(videoId);
    if (!rawText || rawText.length < 100) {
      const segments = await fetchTranscript(videoId);
      if (segments?.length > 0) rawText = segments.map(s => s.text).join(' ');
    }
    return rawText ? cleanTranscriptJs(rawText) : null;
  }

  async function runModeAAnalysis(videoId: string) {
    if (!user) return;
    setLoading(true);
    try {
      const cacheRef = doc('users', user.uid, 'scriptAnalyses', videoId);
      const cacheSnap = await getDoc(cacheRef);
      if (cacheSnap.exists()) {
        setActiveAnalysis({ id: videoId, ...cacheSnap.data() } as any);
        setMode('RESULT');
        return;
      }

      const details = await fetchVideoDetails(videoId);
      if (!details) throw new Error("Video not found");
      const transcript = await getTranscript(videoId);
      if (!transcript) throw new Error("Transcript unavailable");

      const systemPrompt = "You are Max, an expert YouTube script analyst. Analyze this transcript and return ONLY a JSON object.";
      const userPrompt = `Analyze this transcript:\n\n${transcript}`;
      const response = await callMesh(userPrompt, systemPrompt);
      const result = JSON.parse(cleanJsonResponse(response));

      const analysisData = {
        title: details.title,
        thumbnailUrl: details.thumbnail,
        mode: 'A',
        analyzedAt: serverTimestamp(),
        result,
        rawText: transcript
      };
      await setDoc(cacheRef, analysisData);
      setActiveAnalysis({ id: videoId, ...analysisData } as any);
      setMode('RESULT');
    } catch (e: any) {
      console.error(e);
      toast({ variant: "destructive", title: "Analysis failed", description: e.message });
    } finally {
      setLoading(false);
    }
  }

  async function runModeBAnalysis() {
    if (!user || !scriptInput) return;
    setLoading(true);
    try {
      const hash = hashCode(scriptInput.substring(0, 100));
      const analysisId = `review_${hash}`;
      const cacheRef = doc('users', user.uid, 'scriptAnalyses', analysisId);
      const cacheSnap = await getDoc(cacheRef);
      if (cacheSnap.exists()) {
        setActiveAnalysis({ id: analysisId, ...cacheSnap.data() } as any);
        setMode('RESULT');
        return;
      }

      const systemPrompt = "You are Max, an expert YouTube script analyst. Analyze this transcript.";
      const userPrompt = `Topic: ${topicInput}\nAudience: ${audienceInput}\n\nAnalyze this script:\n\n${scriptInput}`;
      const response = await callMesh(userPrompt, systemPrompt);
      const result = JSON.parse(cleanJsonResponse(response));

      const analysisData = {
        title: topicInput || "Manual Script Review",
        thumbnailUrl: "https://picsum.photos/seed/script/640/360",
        mode: 'B',
        analyzedAt: serverTimestamp(),
        result,
        rawText: scriptInput
      };
      await setDoc(cacheRef, analysisData);
      setActiveAnalysis({ id: analysisId, ...analysisData } as any);
      setMode('RESULT');
    } catch (e: any) {
      console.error(e);
      toast({ variant: "destructive", title: "Review failed" });
    } finally {
      setLoading(false);
    }
  }

  async function runModeCAnalysis() {
    if (!user || !topicInput) return;
    setLoading(true);
    try {
      const slug = topicInput.toLowerCase().replace(/[^a-z0-9]/g, '_').substring(0, 30);
      const analysisId = `${slug}_${toneInput}_${lengthInput}`;
      const cacheRef = doc('users', user.uid, 'generatedScripts', analysisId);
      
      const systemPrompt = "You are Max, an expert YouTube scriptwriter. Generate and analyze a complete script.";
      const userPrompt = `Topic: ${topicInput}\nAudience: ${audienceInput}\nTone: ${toneInput}\nTarget Length: ${lengthInput}`;
      const response = await callMesh(userPrompt, systemPrompt);
      const result = JSON.parse(cleanJsonResponse(response));

      const scriptText = formatScriptText(result.generatedScript);
      result.generatedScript = scriptText;

      const analysisData = {
        title: topicInput,
        thumbnailUrl: "https://picsum.photos/seed/generated/640/360",
        mode: 'C',
        analyzedAt: serverTimestamp(),
        result,
        rawText: scriptText
      };
      await setDoc(cacheRef, analysisData);
      setActiveAnalysis({ id: analysisId, ...analysisData } as any);
      setMode('RESULT');
    } catch (e: any) {
      console.error(e);
      toast({ variant: "destructive", title: "Generation failed" });
    } finally {
      setLoading(false);
    }
  }

  // --- Views ---
  const EntryScreen = () => (
    <div className="max-w-6xl mx-auto space-y-12 py-8 animate-in fade-in duration-700">
      <div className="text-center space-y-4">
        <div className="inline-flex h-16 w-16 bg-primary/10 rounded-3xl items-center justify-center mb-2">
          <Sparkles className="h-8 w-8 text-primary fill-primary" />
        </div>
        <h1 className="text-4xl font-bold tracking-tight text-white font-headline">Script with Max</h1>
        <p className="text-slate-400 text-lg">Analyze any script. Review your own. Generate from scratch.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <ModeCard icon={PlayCircle} title="Analyze Video" desc="Paste a YouTube URL to decode its success patterns." btnText="Analyze Video" color="purple" onClick={() => setMode('MODE_A')} />
        <ModeCard icon={Edit3} title="Review Script" desc="Get feedback on your draft before you film." btnText="Review Script" color="emerald" onClick={() => setMode('MODE_B')} />
        <ModeCard icon={Wand2} title="Generate Script" desc="Transform a topic into a complete script." btnText="Generate Script" color="orange" onClick={() => setMode('MODE_C')} />
      </div>
    </div>
  );

  const ResultsPanel = () => {
    if (!activeAnalysis) return null;
    const { result, mode, title } = activeAnalysis;
    const displayScript = formatScriptText(result.generatedScript);

    return (
      <div className="max-w-6xl mx-auto py-8 space-y-8 animate-in fade-in duration-500">
        <Button variant="ghost" className="text-slate-400 hover:text-white" onClick={() => setMode('ENTRY')}><ChevronLeft className="mr-2 h-4 w-4" /> Back</Button>
        {mode === 'C' && (
          <Card className="bg-primary/10 border-primary/20 overflow-hidden mb-8">
            <CardHeader><CardTitle className="text-primary flex items-center gap-2"><Wand2 className="h-5 w-5" /> Generated Script</CardTitle></CardHeader>
            <CardContent><ScrollArea className="h-[300px] bg-white/5 rounded-xl border border-white/5 p-6 text-slate-300 whitespace-pre-wrap">{displayScript}</ScrollArea></CardContent>
          </Card>
        )}
      </div>
    );
  };

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <SidebarNav />
      <main className="flex-1 overflow-y-auto p-8 bg-gradient-to-b from-sidebar to-background">
        {loading ? <div className="flex flex-col items-center justify-center h-[60vh] text-white">Loading...</div> : (
          <>
            {mode === 'ENTRY' && <EntryScreen />}
            {mode === 'MODE_A' && <div className="max-w-xl mx-auto py-20"><Input placeholder="Video URL" value={urlInput} onChange={e => setUrlInput(e.target.value)} /><Button className="w-full mt-4" onClick={() => runModeAAnalysis(urlInput)}>Analyze</Button></div>}
            {mode === 'RESULT' && <ResultsPanel />}
          </>
        )}
      </main>
    </div>
  );
}

function ModeCard({ icon: Icon, title, desc, btnText, color, onClick }: any) {
  return (
    <Card className="bg-white/5 border-none p-6 space-y-6 flex flex-col hover:bg-white/10 transition-all cursor-pointer" onClick={onClick}>
      <div className="h-12 w-12 rounded-2xl flex items-center justify-center border bg-white/5"><Icon className="h-6 w-6 text-primary" /></div>
      <div className="space-y-2 flex-1"><h3 className="text-lg font-bold text-white font-headline">{title}</h3><p className="text-xs text-slate-400">{desc}</p></div>
      <Button className="w-full rounded-xl font-bold">{btnText}</Button>
    </Card>
  );
}

export default function MaxAnalyzerPage() {
  return (
    <Suspense fallback={<div className="flex h-screen items-center justify-center">Loading...</div>}>
      <MaxAnalyzerContent />
    </Suspense>
  );
}
