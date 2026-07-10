/** Shared number formatting. Kept separate so cards, charts, and tooltips agree. */

/** Drops a dead ".0" so we render "412M", not "412.0M". */
function trim(v: number): string {
  return v.toFixed(1).replace(/\.0$/, '');
}

/** 1_234_567 → "1.2M". Returns "0" for absent or unparseable input. */
export function formatNumber(num?: string | number): string {
  if (num === undefined || num === null || num === '') return '0';
  const n = typeof num === 'string' ? parseInt(num, 10) : num;
  if (!Number.isFinite(n)) return '0';
  if (Math.abs(n) >= 1_000_000_000) return trim(n / 1_000_000_000) + 'B';
  if (Math.abs(n) >= 1_000_000) return trim(n / 1_000_000) + 'M';
  if (Math.abs(n) >= 1_000) return trim(n / 1_000) + 'K';
  return String(n);
}

/** Full-precision with thousands separators, for tooltips that show real values. */
export function formatExact(num?: string | number): string {
  if (num === undefined || num === null || num === '') return '—';
  const n = typeof num === 'string' ? parseInt(num, 10) : num;
  if (!Number.isFinite(n)) return '—';
  return n.toLocaleString('en-US');
}
