'use client';

import { useState } from 'react';
import { SidebarNav } from '@/components/dashboard/SidebarNav';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Loader2, Zap, Lightbulb, CheckCircle2, ArrowRight } from 'lucide-react';
import { generateContentActionPlan, type GenerateContentActionPlanOutput } from '@/ai/flows/generate-content-action-plan';

export default function PlanPage() {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<GenerateContentActionPlanOutput | null>(null);

  async function handleGenerate(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    const formData = new FormData(e.currentTarget);
    const summary = formData.get('summary') as string;

    try {
      const output = await generateContentActionPlan({
        channelAnalysisSummary: summary,
      });
      setResult(output);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <SidebarNav />
      <main className="flex-1 overflow-y-auto p-8">
        <header className="mb-8">
          <h1 className="text-3xl font-bold tracking-tight text-slate-900">Action Plan</h1>
          <p className="text-muted-foreground mt-1">Turn your analysis into a concrete growth strategy.</p>
        </header>

        <div className="max-w-4xl mx-auto space-y-8">
          <Card className="border-none shadow-sm">
            <CardHeader>
              <CardTitle>Strategy Input</CardTitle>
              <CardDescription>Provide a summary of your recent channel analysis to generate a custom plan.</CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleGenerate} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="summary">Analysis Summary</Label>
                  <Textarea 
                    id="summary" 
                    name="summary" 
                    placeholder="e.g., My latest video had a high click-through rate but low retention after the 2-minute mark. Most viewers left during the technical explanation..." 
                    className="min-h-[150px]"
                    required
                  />
                </div>
                <Button type="submit" className="w-full bg-primary" disabled={loading}>
                  {loading ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Generating Strategy...
                    </>
                  ) : (
                    <>
                      <Zap className="mr-2 h-4 w-4 fill-white" />
                      Generate Action Plan
                    </>
                  )}
                </Button>
              </form>
            </CardContent>
          </Card>

          {result && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
              <Card className="border-none shadow-sm h-full">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <CheckCircle2 className="h-5 w-5 text-primary" />
                    Strategic Steps
                  </CardTitle>
                  <CardDescription>Actionable tasks to improve performance</CardDescription>
                </CardHeader>
                <CardContent>
                  <ul className="space-y-4">
                    {result.strategicSteps.map((step, i) => (
                      <li key={i} className="flex gap-3 p-3 bg-slate-50 rounded-lg border border-slate-100">
                        <span className="h-5 w-5 rounded-full bg-primary/10 text-primary text-[10px] font-bold flex items-center justify-center shrink-0 mt-0.5">
                          {i + 1}
                        </span>
                        <p className="text-sm font-medium text-slate-700">{step}</p>
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>

              <Card className="border-none shadow-sm h-full">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Lightbulb className="h-5 w-5 text-amber-500" />
                    Content Ideas
                  </CardTitle>
                  <CardDescription>New video topics based on your niche</CardDescription>
                </CardHeader>
                <CardContent>
                  <ul className="space-y-3">
                    {result.contentIdeas.map((idea, i) => (
                      <li key={i} className="group cursor-pointer">
                        <div className="flex items-center justify-between p-3 rounded-lg border border-slate-100 hover:border-primary/30 hover:bg-primary/5 transition-all">
                          <p className="text-sm font-semibold text-slate-800">{idea}</p>
                          <ArrowRight className="h-4 w-4 text-slate-300 group-hover:text-primary transition-colors" />
                        </div>
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
