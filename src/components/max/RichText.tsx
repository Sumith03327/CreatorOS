'use client';

// Lightweight markdown renderer (bold, headings, bullet/numbered lists).
// Originally copied from src/app/agents/page.tsx and kept feature-local; now
// shared between MaxChat and ResearchPanel, the two chat surfaces in this
// feature, so it's a real component instead of two duplicated copies.

import { cn } from '@/lib/utils';

function renderInline(text: string, keyBase: string) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((p, i) =>
    /^\*\*[^*]+\*\*$/.test(p) ? (
      <strong key={`${keyBase}-${i}`}>{p.slice(2, -2)}</strong>
    ) : (
      <span key={`${keyBase}-${i}`}>{p}</span>
    )
  );
}

export function RichText({ content }: { content: string }) {
  const lines = content.split('\n');
  return (
    <div className="space-y-1.5 leading-relaxed">
      {lines.map((line, i) => {
        const t = line.trim();
        if (!t) return <div key={i} className="h-1.5" />;
        if (/^---+$/.test(t)) return <hr key={i} className="my-2 border-white/10" />;
        const h = t.match(/^(#{1,4})\s+(.*)$/);
        if (h) {
          return (
            <div key={i} className={cn('font-bold text-white', h[1].length <= 2 ? 'text-base' : 'text-sm')}>
              {renderInline(h[2], `h${i}`)}
            </div>
          );
        }
        const bullet = t.match(/^[-*]\s+(.*)$/);
        if (bullet) {
          return (
            <div key={i} className="flex gap-2">
              <span className="text-primary/70 mt-0.5">•</span>
              <span>{renderInline(bullet[1], `b${i}`)}</span>
            </div>
          );
        }
        const num = t.match(/^(\d+)\.\s+(.*)$/);
        if (num) {
          return (
            <div key={i} className="flex gap-2">
              <span className="text-primary font-semibold">{num[1]}.</span>
              <span>{renderInline(num[2], `n${i}`)}</span>
            </div>
          );
        }
        return <div key={i}>{renderInline(t, `p${i}`)}</div>;
      })}
    </div>
  );
}
