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
    const description = decodeEntities(stripTags(
      (itemXml.match(/<description>([\s\S]*?)<\/description>/i)?.[1] ?? "").trim()
    )).slice(0, 200);

    if (title) {
      items.push({ title, link, pubDate, description, source: sourceName });
    }
  }

  return items;
}

/** Parse Federal Register API results. */
function parseFederalRegister(data: any): RawItem[] {
  const items: RawItem[] = [];
  const results = data.results ?? [];
  for (const r of results) {
    if (r.title) {
      items.push({
        title: r.title,
        link: r.html_url ?? "",
        pubDate: r.publication_date ?? "",
        description: (r.abstract ?? "").slice(0, 200),
        source: "Federal Register",
      });
    }
  }
  return items;
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

/** Fetch headlines from RSS + API sources. */
async function fetchRawItems(): Promise<RawItem[]> {
  const headers = { "User-Agent": "eink-dashboard/3.5 (Cloudflare Worker)" };

  const fetches = [
    // Google News RSS for steel/trade/tariff
    fetchWithTimeout(
      "https://news.google.com/rss/search?q=steel+tariff+trade+section+232+USA&hl=en-US&gl=US",
      { headers },
    ).then(async r => {
      if (!r.ok) return [];
      return parseRSSItems(await r.text(), "Google News");
    }).catch(() => [] as RawItem[]),

    // Federal Register API
    fetchWithTimeout(
      "https://www.federalregister.gov/api/v1/documents.json?conditions[term]=steel+tariff&per_page=5&order=newest",
      { headers },
    ).then(async r => {
      if (!r.ok) return [];
      return parseFederalRegister(await r.json());
    }).catch(() => [] as RawItem[]),
  ];

  const results = await Promise.all(fetches);
  return results.flat();
}

/** Use LLM to summarize headlines. Returns headlines with summaries. */
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
          content: `You summarize steel and trade news headlines. For each headline, write a 2-line factual summary. No speculation, no opinions.

Reply with ONLY valid JSON array, no markdown fences:
[{"index":1,"summary":"First line of summary. Second line of summary."},...]`
        },
        {
          role: "user",
          content: `Summarize these headlines:\n\n${headlinesText}`
        },
      ],
      max_tokens: 800,
      temperature: 0.3,
    });

    const raw = response?.response ?? response?.result?.response ?? "";
    const text = typeof raw === "string" ? raw : JSON.stringify(raw);

    // Try to parse JSON array from response
    const match = text.match(/\[[\s\S]*\]/);
    if (match) {
      const summaries: any[] = JSON.parse(match[0]);
      return items.map((item, i) => {
        const s = summaries.find((s: any) => s.index === i + 1);
        return {
          title: item.title,
          source: item.source,
          timestamp: item.pubDate,
          summary: s?.summary ?? item.description.slice(0, 100),
          category: categorize(item.title, item.description),
          link: item.link,
        };
      });
    }
  } catch (err) {
    console.error("Headlines LLM error:", err);
  }

  // Fallback: use descriptions as summaries
  return items.map(item => ({
    title: item.title,
    source: item.source,
    timestamp: item.pubDate,
    summary: item.description.slice(0, 100),
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
  const cacheKey = `headlines:v1:${dateStr}:${period}`;

  const cached = await env.CACHE.get<CachedValue<Headline[]>>(cacheKey, "json");
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    console.log("Headlines: cache hit");
    return cached.data;
  }

  try {
    const rawItems = await fetchRawItems();
    const unique = deduplicateItems(rawItems);
    const top5 = unique.slice(0, 5);

    if (top5.length === 0) {
      return cached?.data ?? [];
    }

    const headlines = await summarizeWithLLM(env, top5);
    await env.CACHE.put(cacheKey, JSON.stringify({ data: headlines, timestamp: Date.now() }), { expirationTtl: 604800 });
    return headlines;
  } catch (err) {
    console.error("Headlines fetch error:", err);
    return cached?.data ?? [];
  }
}
