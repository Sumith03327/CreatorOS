/**
 * Shared helpers for working with YouTube video metadata on the client.
 */

/** Parses an ISO 8601 duration (e.g. "PT1M30S", "PT2H5M") into total seconds. */
export function parseIsoDuration(iso?: string): number {
  if (!iso) return 0;
  const match = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!match) return 0;
  const [, h, m, s] = match;
  return (parseInt(h || '0') * 3600) + (parseInt(m || '0') * 60) + parseInt(s || '0');
}

/** Formats total seconds into m:ss or h:mm:ss. */
export function formatDuration(iso?: string): string {
  const total = parseIsoDuration(iso);
  if (total <= 0) return '';
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

// YouTube Shorts are vertical clips historically capped at 60s. We treat anything
// at or under this as a Short and everything longer as long-form.
export const SHORT_MAX_SECONDS = 60;

export function isShort(iso?: string): boolean {
  const total = parseIsoDuration(iso);
  return total > 0 && total <= SHORT_MAX_SECONDS;
}

/**
 * Rough ad-revenue estimate for a given view count. Real RPM swings widely by
 * niche, geography, and season, so we return a conservative low–high band rather
 * than a single fake-precise number. Long-form monetized views ≈ $1–$4 / 1000;
 * Shorts earn far less (≈ $0.03–$0.08 / 1000).
 */
export function estimateEarnings(
  views?: string | number,
  opts?: { short?: boolean; rpmLow?: number; rpmHigh?: number }
): { low: number; high: number } {
  const n = typeof views === 'string' ? parseInt(views) : (views || 0);
  if (!n || isNaN(n)) return { low: 0, high: 0 };
  const perK = n / 1000;
  if (opts?.short) return { low: perK * 0.03, high: perK * 0.08 };
  // Use the AI's niche-specific RPM band when available, else a generic default.
  const lo = opts?.rpmLow && opts.rpmLow > 0 ? opts.rpmLow : 1;
  const hi = opts?.rpmHigh && opts.rpmHigh > 0 ? opts.rpmHigh : 4;
  return { low: perK * lo, high: perK * Math.max(lo, hi) };
}

/** Compact USD formatter: $1.2K, $3.4M, $12. */
export function formatMoney(n: number): string {
  if (!n || isNaN(n)) return '$0';
  if (n >= 1000000) return '$' + (n / 1000000).toFixed(1) + 'M';
  if (n >= 1000) return '$' + (n / 1000).toFixed(1) + 'K';
  return '$' + Math.round(n).toString();
}

/** Formats an earnings band as "$1.2K–$4.8K". */
export function formatEarningsRange(band: { low: number; high: number }): string {
  return `${formatMoney(band.low)}–${formatMoney(band.high)}`;
}

/** Extracts a YouTube video ID from a watch/share/shorts/embed URL or a bare ID. */
export function extractVideoId(input?: string): string | null {
  if (!input) return null;
  const s = input.trim();
  // Bare 11-char video ID
  if (/^[a-zA-Z0-9_-]{11}$/.test(s)) return s;
  const patterns = [
    /[?&]v=([a-zA-Z0-9_-]{11})/,      // watch?v=ID
    /youtu\.be\/([a-zA-Z0-9_-]{11})/,  // youtu.be/ID
    /\/shorts\/([a-zA-Z0-9_-]{11})/,   // /shorts/ID
    /\/embed\/([a-zA-Z0-9_-]{11})/,    // /embed/ID
    /\/live\/([a-zA-Z0-9_-]{11})/,     // /live/ID
  ];
  for (const re of patterns) {
    const m = s.match(re);
    if (m) return m[1];
  }
  return null;
}

/** Relative "time ago" label from an ISO date string. */
export function timeAgo(iso?: string): string {
  if (!iso) return '';
  const then = new Date(iso).getTime();
  if (isNaN(then)) return '';
  const days = Math.floor((Date.now() - then) / (1000 * 60 * 60 * 24));
  if (days < 1) return 'today';
  if (days === 1) return '1d ago';
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.floor(months / 12)}y ago`;
}
