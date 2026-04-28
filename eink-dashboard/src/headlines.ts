/**
 * Steel & trade headlines aggregator.
 *
 * Fetches RSS/HTML sources for steel tariff and trade news,
 * deduplicates, and ranks them without using Workers AI.
 */

import { fetchWithTimeout } from "./fetch-timeout";
import type { Env, Headline, CachedValue } from "./types";

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

function sourceWeight(source: string): number {
  if (source === "Steel Industry News") return 30;
  if (source === "SteelOrbis") return 24;
  return 12;
}

function topicWeight(title: string, description: string): number {
  const text = `${title} ${description}`.toLowerCase();
  let score = 0;
  if (/tariff|section 232|anti.?dumping|countervail|import|export|trade/i.test(text)) score += 12;
  if (/price|hrc|scrap|rebar|coil|plate|market|index/i.test(text)) score += 10;
  if (/nucor|cleveland-cliffs|us steel|steel dynamics|arcelormittal/i.test(text)) score += 8;
  if (/\d+(?:\.\d+)?%|\$\d+|\b\d{3,}\b/.test(text)) score += 6;
  if (/podcast|webinar|sponsored|subscribe|newsletter/i.test(text)) score -= 20;
  return score;
}

function firstReadableSentence(text: string): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return "";
  const sentence = clean.match(/^(.{40,220}?[.!?])\s/)?.[1] ?? clean;
  return sentence.length > 180 ? sentence.slice(0, 177).trimEnd() + "..." : sentence;
}

function fallbackSummary(item: RawItem): string {
  const sentence = firstReadableSentence(item.description);
  if (sentence) return sentence;
  return item.title.length > 180 ? item.title.slice(0, 177).trimEnd() + "..." : item.title;
}

/** Select and summarize headlines without using the LLM neuron budget. */
function selectHeadlines(items: RawItem[]): Headline[] {
  return [...items]
    .sort((a, b) => {
      const scoreA = sourceWeight(a.source) + topicWeight(a.title, a.description);
      const scoreB = sourceWeight(b.source) + topicWeight(b.title, b.description);
      return scoreB - scoreA;
    })
    .slice(0, 4)
    .map((item) => ({
      title: item.title,
      source: item.source,
      timestamp: item.pubDate,
      summary: fallbackSummary(item),
      category: categorize(item.title, item.description),
      link: item.link,
    }));
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

/**
 * Get steel/trade headlines without Workers AI.
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

    const headlines = selectHeadlines(top10);
    await env.CACHE.put(cacheKey, JSON.stringify({ data: headlines, timestamp: Date.now() }), { expirationTtl: 604800 });
    return headlines;
  } catch (err) {
    console.error("Headlines fetch error:", err);
    return cached?.data ?? [];
  }
}
