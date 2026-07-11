'use server';

/**
 * @fileOverview Creator Times feed ingestion.
 *
 * Every source here is a public RSS/Atom feed: no API key, no auth, and — this
 * is the point — **zero YouTube quota**. The research features can exhaust the
 * daily 10,000 units in a few runs; this one costs nothing and can be refreshed
 * as often as we like.
 *
 * The primary source is Creator Insider, YouTube's own weekly channel where the
 * product managers announce what shipped. Because it's a YouTube video, we can
 * fetch its transcript and read what was actually said — see
 * `creator-news-flow.ts`. A web-search tool cannot do this: the news is spoken
 * aloud in a video the open web doesn't index, which is why a Perplexity probe
 * for "what changed in the last 30 days" came back with a 2018 Reddit thread and
 * concluded nothing had happened.
 */

// Sources, types, and the FeedItem shape live in `@/lib/feed-sources` — a
// `'use server'` module may only export async functions, so a plain `const` array
// exported from here would stop Next from loading the module at all.
import { FEED_SOURCES, type FeedItem, type FeedSource, type FetchFeedsResult, type SourceId } from '@/lib/feed-sources';

// --- XML parsing ------------------------------------------------------------
//
// Deliberately dependency-free. These are two well-specified formats (Atom for
// YouTube, RSS 2.0 for the blog), and the alternative is dragging in a parser to
// read six fields. Everything is defensive: a malformed entry is skipped, never
// thrown, so one bad feed can't take down the page.

const ENTITIES: Record<string, string> = {
  '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'", '&#39;': "'", '&nbsp;': ' ',
};

function decodeEntities(text: string): string {
  return text
    .replace(/&(?:amp|lt|gt|quot|apos|#39|nbsp);/g, m => ENTITIES[m] ?? m)
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)));
}

/** Reads a tag's text content, unwrapping CDATA and stripping any inline HTML. */
function tagText(xml: string, tag: string): string {
  const match = xml.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'i'));
  if (!match) return '';
  const raw = match[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');
  return decodeEntities(raw.replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();
}

function tagAttr(xml: string, tag: string, attr: string): string {
  const match = xml.match(new RegExp(`<${tag}[^>]*\\s${attr}="([^"]*)"`, 'i'));
  return match ? decodeEntities(match[1]) : '';
}

function blocks(xml: string, tag: string): string[] {
  return xml.match(new RegExp(`<${tag}(?:\\s[^>]*)?>[\\s\\S]*?</${tag}>`, 'gi')) ?? [];
}

function toIso(value: string): string {
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? new Date(time).toISOString() : new Date().toISOString();
}

const SUMMARY_CHARS = 400;

function parseAtom(xml: string, source: FeedSource): FeedItem[] {
  return blocks(xml, 'entry').flatMap(entry => {
    const videoId = tagText(entry, 'yt:videoId');
    const title = tagText(entry, 'title');
    if (!title) return [];

    return [{
      id: videoId || tagText(entry, 'id'),
      sourceId: source.id,
      sourceLabel: source.label,
      authority: source.authority,
      title,
      url: tagAttr(entry, 'link', 'href') || (videoId ? `https://www.youtube.com/watch?v=${videoId}` : ''),
      publishedAt: toIso(tagText(entry, 'published') || tagText(entry, 'updated')),
      summary: tagText(entry, 'media:description').slice(0, SUMMARY_CHARS),
      videoId: videoId || undefined,
      thumbnail: tagAttr(entry, 'media:thumbnail', 'url') || undefined,
    }];
  });
}

function parseRss(xml: string, source: FeedSource): FeedItem[] {
  return blocks(xml, 'item').flatMap(item => {
    const title = tagText(item, 'title');
    const link = tagText(item, 'link');
    if (!title) return [];

    return [{
      id: tagText(item, 'guid') || link || title,
      sourceId: source.id,
      sourceLabel: source.label,
      authority: source.authority,
      title,
      url: link,
      publishedAt: toIso(tagText(item, 'pubDate') || tagText(item, 'dc:date')),
      summary: (tagText(item, 'description') || tagText(item, 'content:encoded')).slice(0, SUMMARY_CHARS),
      // The YouTube blog attaches its hero image as <media:content medium="image">.
      thumbnail: tagAttr(item, 'media:content', 'url') || undefined,
    }];
  });
}

// --- Fetching ---------------------------------------------------------------

// Feeds update at most a few times a day; an hour of staleness is invisible and
// keeps us from hammering anyone's server on every page load.
const FEED_TTL_MS = 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 12_000;

const feedCache = new Map<SourceId, { items: FeedItem[]; expiresAt: number }>();

/**
 * blog.youtube intermittently drops a connection — measured, roughly one attempt
 * in three cold — and a single transient timeout was enough to strike the source
 * off the page and print "couldn't reach YouTube Official Blog". One retry turns
 * a visible failure into a non-event.
 */
const FETCH_ATTEMPTS = 2;
const RETRY_DELAY_MS = 600;

async function fetchSource(source: FeedSource): Promise<FeedItem[]> {
  const cached = feedCache.get(source.id);
  if (cached && cached.expiresAt > Date.now()) return cached.items;

  for (let attempt = 0; attempt < FETCH_ATTEMPTS; attempt++) {
    try {
      const response = await fetch(source.url, {
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        headers: {
          'User-Agent': 'CreatorHub/1.0 (+news reader)',
          Accept: 'application/rss+xml, application/atom+xml, application/xml',
        },
      });
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);

      const xml = await response.text();
      const items = source.kind === 'youtube' ? parseAtom(xml, source) : parseRss(xml, source);

      // An empty parse means the feed changed shape. Serve the stale copy rather
      // than caching the emptiness for an hour and blanking the page.
      if (items.length === 0) return cached?.items ?? [];

      feedCache.set(source.id, { items, expiresAt: Date.now() + FEED_TTL_MS });
      return items;
    } catch (e) {
      if (attempt < FETCH_ATTEMPTS - 1) {
        await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS));
        continue;
      }
      console.warn(`Feed fetch failed (${source.id}) after ${FETCH_ATTEMPTS} attempts:`, e);
    }
  }

  return cached?.items ?? [];
}

/**
 * Every source, newest first. One dead feed degrades the page rather than
 * breaking it — a news reader that 500s because a blog is down is worse than one
 * that quietly shows less news.
 */
export async function fetchCreatorFeeds(windowDays = 45): Promise<FetchFeedsResult> {
  const results = await Promise.all(FEED_SOURCES.map(async source => ({ source, items: await fetchSource(source) })));

  const cutoff = Date.now() - windowDays * 24 * 60 * 60 * 1000;
  const items = results
    .flatMap(r => r.items)
    .filter(item => new Date(item.publishedAt).getTime() >= cutoff)
    .sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime());

  return {
    items,
    failedSources: results.filter(r => r.items.length === 0).map(r => r.source.label),
  };
}

/** The most recent Creator Insider episode — the one worth decoding. */
export async function fetchLatestCreatorInsider(): Promise<FeedItem | null> {
  const source = FEED_SOURCES.find(s => s.id === 'creator-insider')!;
  const items = await fetchSource(source);
  return items.find(item => item.videoId) ?? null;
}
