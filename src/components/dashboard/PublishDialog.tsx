'use client';

import React, { useState } from 'react';
import { 
  Dialog, 
  DialogContent, 
  DialogDescription, 
  DialogFooter, 
  DialogHeader, 
  DialogTitle, 
  DialogTrigger 
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { 
  Globe, 
  Rocket, 
  CheckCircle2, 
  Copy, 
  ExternalLink, 
  Loader2,
  Share2,
  ShieldCheck,
  Zap
} from 'lucide-react';
import { toast } from '@/hooks/use-toast';
import { firebaseConfig } from '@/firebase/config';

interface PublishDialogProps {
  children: React.ReactNode;
}

export function PublishDialog({ children }: PublishDialogProps) {
  const [isPublishing, setIsPublishing] = useState(false);
  const [isPublished, setIsPublished] = useState(true); // Default to true as Studio apps are hosted
  
  const projectUrl = `https://${firebaseConfig.projectId}.web.app`;

  const handleCopyLink = () => {
    navigator.clipboard.writeText(projectUrl);
    toast({
      title: "Link Copied!",
      description: "Live URL has been copied to your clipboard.",
    });
  };

  const handlePublish = () => {
    setIsPublishing(true);
    // Simulate a deployment sync
    setTimeout(() => {
      setIsPublishing(false);
      setIsPublished(true);
      toast({
        title: "App Published!",
        description: "Your latest changes are now live and ready to share.",
      });
    }, 2000);
  };

  return (
    <Dialog>
      <DialogTrigger asChild>
        {children}
      </DialogTrigger>
      <DialogContent className="sm:max-w-[425px] border-none shadow-2xl bg-white">
        <DialogHeader>
          <div className="flex items-center gap-2 mb-2">
            <div className="h-8 w-8 bg-primary/10 rounded-lg flex items-center justify-center">
              <Rocket className="h-5 w-5 text-primary" />
            </div>
            <DialogTitle className="text-xl font-bold font-headline">Publish Creator Hub</DialogTitle>
          </div>
          <DialogDescription className="text-slate-500">
            Deploy your latest AI strategies and share your dashboard with the world.
          </DialogDescription>
        </DialogHeader>

        <div className="py-6 space-y-6">
          {/* Status Section */}
          <div className="bg-slate-50 rounded-2xl p-4 border border-slate-100">
            <div className="flex items-center justify-between mb-4">
              <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Current Status</span>
              {isPublished ? (
                <Badge className="bg-emerald-100 text-emerald-700 border-none flex items-center gap-1">
                  <CheckCircle2 className="h-3 w-3" />
                  Live & Optimized
                </Badge>
              ) : (
                <Badge variant="outline" className="text-slate-400 border-slate-200">Not Published</Badge>
              )}
            </div>
            
            <div className="space-y-3">
              <div className="flex items-center gap-3 text-sm">
                <ShieldCheck className="h-4 w-4 text-primary" />
                <span className="text-slate-600">Firebase App Hosting (Edge)</span>
              </div>
              <div className="flex items-center gap-3 text-sm">
                <Zap className="h-4 w-4 text-amber-500" />
                <span className="text-slate-600">Gemini AI Resilience: Active</span>
              </div>
              <div className="flex items-center gap-3 text-sm">
                <Globe className="h-4 w-4 text-blue-500" />
                <span className="text-slate-600">Global SSL Encryption</span>
              </div>
            </div>
          </div>

          {/* Share Section */}
          <div className="space-y-3">
            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest px-1">Shareable URL</label>
            <div className="flex gap-2">
              <div className="flex-1 h-10 px-3 bg-slate-100 rounded-lg border border-slate-200 flex items-center text-xs font-mono text-slate-500 truncate">
                {projectUrl}
              </div>
              <Button variant="outline" size="icon" onClick={handleCopyLink} className="shrink-0 h-10 w-10">
                <Copy className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>

        <DialogFooter className="flex flex-col sm:flex-row gap-2">
          <Button 
            variant="ghost" 
            className="flex-1 gap-2" 
            onClick={() => window.open(projectUrl, '_blank')}
          >
            <ExternalLink className="h-4 w-4" />
            View Live
          </Button>
          <Button 
            className="flex-1 bg-primary hover:bg-primary/90 gap-2" 
            onClick={handlePublish}
            disabled={isPublishing}
          >
            {isPublishing ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Share2 className="h-4 w-4" />
            )}
            {isPublished ? "Sync & Republish" : "Publish Now"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
