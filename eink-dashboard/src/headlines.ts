/**
 * Steel & trade headlines aggregator.
 *
 * Fetches RSS/API sources for steel tariff and trade news,
 * deduplicates, and uses LLM to generate 2-line summaries.
 */

import { fetchWithTimeout } from "./fetch-timeout";
import type { Env, Headline, CachedValue } from "./types";

const LLM_MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast" as const;
const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours

interface RawItem {
  title: string;
  link: string;
  pubDate: string;
  description: string;
  source: string;
}

/** Get current 6-hour period based on Chicago time. */
export function getCurrentPeriod(): number {
  const now = new Date();
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    hour: "numeric",
    hour12: false,
  });
  const hour = parseInt(fmt.format(now), 10);
  if (hour < 6) return 0;
  if (hour < 12) return 6;
  if (hour < 18) return 12;
  return 18;
}

/** Decode basic HTML entities. */
function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1");
}

/** Strip HTML tags. */
function stripTags(s: string): string {
  return s.replace(/<[^>]+>/g, "").trim();
}

/** Parse RSS items from XML text. */
function parseRSSItems(xml: string, sourceName: string): RawItem[] {
  const items: RawItem[] = [];
  const itemMatches = xml.match(/<item>([\s\S]*?)<\/item>/gi) ?? [];

  for (const itemXml of itemMatches) {
    const title = decodeEntities(stripTags(
      (itemXml.match(/<title>([\s\S]*?)<\/title>/i)?.[1] ?? "").trim()
    ));
    const link = decodeEntities(
      (itemXml.match(/<link>([\s\S]*?)<\/link>/i)?.[1] ?? "").trim()
    );
    const pubDate = decodeEntities(
      (itemXml.match(/<pubDate>([\s\S]*?)<\/pubDate>/i)?.[1] ?? "").trim()
    );
    const desc1 = decodeEntities(stripTags(
      (itemXml.match(/<description>([\s\S]*?)<\/description>/i)?.[1] ?? "").trim()
    )).slice(0, 300);
    const desc2 = decodeEntities(stripTags(
      (itemXml.match(/<content:encoded>([\s\S]*?)<\/content:encoded>/i)?.[1] ?? "").trim()
    )).slice(0, 300);
    const description = desc1.length > 50 ? desc1 : (desc2 || desc1);

    if (title) {
      items.push({ title, link, pubDate, description, source: sourceName });
    }
  }

  return items;
}

/** Parse news articles from SteelOrbis latest news HTML page. */
function parseSteelOrbisItems(html: string): RawItem[] {
  const items: RawItem[] = [];
  const currentYear = new Date().getFullYear();
  const aMatches = html.match(/<a[^>]+href="(\/steel-news\/latest-news\/[^"]+\.htm)"[^>]*>([\s\S]*?)<\/a>/gi) ?? [];
  for (const match of aMatches) {
    const href = match.match(/href="([^"]+)"/i)?.[1] ?? "";
    const rawDate = (match.match(/<div[^>]*article-date[^>]*>([\s\S]*?)<\/div>/i)?.[1] ?? "").trim();
    // SteelOrbis uses "25 Feb" (no year) — append current year for valid Date parsing
    const date = rawDate && !rawDate.match(/\d{4}/) ? `${rawDate} ${currentYear}` : rawDate;
    const titleRaw = stripTags(match.match(/<h3[^>]*>([\s\S]*?)<\/h3>/i)?.[1] ?? "").trim();
    const title = decodeEntities(titleRaw.replace(/^Free\s+/i, "").trim());
    if (title && href) {
      items.push({
        title,
        link: `https://www.steelorbis.com${href}`,
        pubDate: date,
        description: "",
        source: "SteelOrbis",
      });
    }
  }
  return items.slice(0, 6);
}

/** Simple title similarity check (Jaccard on words). */
function titleSimilarity(a: string, b: string): number {
  const wordsA = new Set(a.toLowerCase().split(/\s+/).filter(w => w.length > 3));
  const wordsB = new Set(b.toLowerCase().split(/\s+/).filter(w => w.length > 3));
  if (wordsA.size === 0 || wordsB.size === 0) return 0;
  let intersection = 0;
  for (const w of wordsA) {
    if (wordsB.has(w)) intersection++;
  }
  return intersection / Math.max(wordsA.size, wordsB.size);
}

/** Deduplicate items by title similarity. */
function deduplicateItems(items: RawItem[]): RawItem[] {
  const result: RawItem[] = [];
  for (const item of items) {
    const isDupe = result.some(existing => titleSimilarity(existing.title, item.title) > 0.5);
    if (!isDupe) result.push(item);
  }
  return result;
}

/** Categorize a headline based on keywords. */
function categorize(title: string, description: string): Headline["category"] {
  const text = (title + " " + description).toLowerCase();
  if (/tariff|duty|duties|section 232|import tax|anti.?dumping|countervail/i.test(text)) return "tariffs";
  if (/regulation|regulatory|compliance|federal register|rule|ruling|executive order/i.test(text)) return "regulatory";
  if (/market|price|index|stock|shares|earnings|revenue|profit/i.test(text)) return "markets";
  return "company";
}

/** Fetch headlines from RSS + HTML sources. */
async function fetchRawItems(): Promise<RawItem[]> {
  const headers = { "User-Agent": "eink-dashboard/3.9 (Cloudflare Worker)" };

  const fetches = [
    // Steel Industry News Substack — primary source (same newsletter user receives)
    fetchWithTimeout(
      "https://steelindustrynews.substack.com/feed",
      { headers },
    ).then(async r => {
      if (!r.ok) return [];
      return parseRSSItems(await r.text(), "Steel Industry News");
    }).catch(() => [] as RawItem[]),

    // SteelOrbis US latest news — HTML scrape
    fetchWithTimeout(
      "https://www.steelorbis.com/steel-news/latest-news/us",
      { headers },
    ).then(async r => {
      if (!r.ok) return [];
      return parseSteelOrbisItems(await r.text());
    }).catch(() => [] as RawItem[]),

    // Google News RSS: tariff / trade / import focus
    fetchWithTimeout(
      "https://news.google.com/rss/search?q=steel+tariffs+imports+USA+section+232&hl=en-US&gl=US&ceid=US:en",
      { headers },
    ).then(async r => {
      if (!r.ok) return [];
      return parseRSSItems(await r.text(), "Google News");
    }).catch(() => [] as RawItem[]),

    // Google News RSS: prices / market / companies focus
    fetchWithTimeout(
      "https://news.google.com/rss/search?q=steel+prices+HRC+scrap+Nucor+%22US+Steel%22+Cleveland-Cliffs&hl=en-US&gl=US&ceid=US:en",
      { headers },
    ).then(async r => {
      if (!r.ok) return [];
      return parseRSSItems(await r.text(), "Google News");
    }).catch(() => [] as RawItem[]),
  ];

  const results = await Promise.all(fetches);
  return results.flat();
}

/** Use LLM to select and summarize the best headlines. Returns up to 4 selected headlines. */
async function summarizeWithLLM(
  env: Env,
  items: RawItem[]
): Promise<Headline[]> {
  const headlinesText = items.map((item, i) =>
    `${i + 1}. "${item.title}" (${item.source})\n   ${item.description}`
  ).join("\n\n");

  try {
    const response: any = await env.AI.run(LLM_MODEL, {
      messages: [
        {
          role: "system",
          content: `You are a steel industry analyst writing for mill buyers and trade professionals. From the headlines provided, select the 4 most significant items. Prioritize: price moves, tariff decisions, import/export data, major company actions. Skip: podcast and video announcements, subscription pitches, generic overviews without new data, duplicates.

For each selected item write exactly 2 sentences:
- Sentence 1: state the specific fact — what changed, by how much, who did it, when. Extract all numbers, percentages, company names, and policy names from the title and description. Never be vague.
- Sentence 2: state the concrete market implication — what this means for buyers, mills, or pricing. Use your industry knowledge to add context beyond the title.

NEVER use hedge language: forbidden phrases include "may affect", "could impact", "might lead to", "may result in", "remains to be seen". State facts and implications directly.

Reply with ONLY a valid JSON array, no markdown fences, using the original 1-based index of each selected item:
[{"index":1,"summary":"..."},{"index":5,"summary":"..."},...]`
        },
        {
          role: "user",
          content: `Select 4 and summarize:\n\n${headlinesText}`,
        },
      ],
      max_tokens: 800,
      temperature: 0.3,
    });

    const raw = response?.response ?? response?.result?.response ?? "";
    const text = typeof raw === "string" ? raw : JSON.stringify(raw);

    const match = text.match(/\[[\s\S]*\]/);
    if (match) {
      const summaries: any[] = JSON.parse(match[0]);
      return summaries
        .map((s: any) => {
          const item = items[s.index - 1];
          if (!item || !s.summary) return null;
          return {
            title: item.title,
            source: item.source,
            timestamp: item.pubDate,
            summary: s.summary,
            category: categorize(item.title, item.description),
            link: item.link,
          } as Headline;
        })
        .filter((h): h is Headline => h !== null)
        .slice(0, 4);
    }
  } catch (err) {
    console.error("Headlines LLM error:", err);
  }

  // Fallback: return first 4 items with description as summary
  return items.slice(0, 4).map(item => ({
    title: item.title,
    source: item.source,
    timestamp: item.pubDate,
    summary: item.description.slice(0, 120),
    category: categorize(item.title, item.description),
    link: item.link,
  }));
}

/**
 * Get steel/trade headlines with LLM summaries.
 * Cached in KV for 6 hours per period.
 */
export async function getHeadlines(
  env: Env,
  dateStr: string,
  period: number,
): Promise<Headline[]> {
  const cacheKey = `headlines:v3:${dateStr}:${period}`;

  const cached = await env.CACHE.get<CachedValue<Headline[]>>(cacheKey, "json");
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    console.log("Headlines: cache hit");
    return cached.data;
  }

  try {
    const rawItems = await fetchRawItems();
    const unique = deduplicateItems(rawItems);
    const top10 = unique.slice(0, 10);

    if (top10.length === 0) {
      return cached?.data ?? [];
    }

    const headlines = await summarizeWithLLM(env, top10);
    await env.CACHE.put(cacheKey, JSON.stringify({ data: headlines, timestamp: Date.now() }), { expirationTtl: 604800 });
    return headlines;
  } catch (err) {
    console.error("Headlines fetch error:", err);
    return cached?.data ?? [];
  }
}
