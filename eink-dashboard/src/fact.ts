import type { Env, FactResponse, CachedValue } from "./types";
import { getChicagoDateParts } from "./date-utils";

const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

const FALLBACK_FACT: FactResponse = {
  date: "",
  display_date: "",
  event: {
    year: 1991,
    text: "Did you know? The first website went live on August 6, 1991, created by Tim Berners-Lee at CERN.",
    pages: [{ title: "World Wide Web", url: "https://en.wikipedia.org/wiki/World_Wide_Web" }],
  },
  source: "Fallback",
};

function getTodayChicago(): { dateStr: string; displayDate: string; month: string; day: string } {
  const { month, day, dateStr } = getChicagoDateParts();

  const displayFmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    month: "short",
    day: "numeric",
  });
  const displayDate = displayFmt.format(new Date());

  return { dateStr, displayDate, month, day };
}

/**
 * Fetch all raw "on this day" events from Wikipedia.
 * Used by the Moment Before engine to pick the most visual event via LLM.
 */
export async function getTodayEvents(env: Env): Promise<{
  events: Array<{ year: number; text: string }>;
  dateStr: string;
  displayDate: string;
}> {
  const { dateStr, displayDate, month, day } = getTodayChicago();

  try {
    const url = `https://en.wikipedia.org/api/rest_v1/feed/onthisday/events/${month}/${day}`;
    const res = await fetch(url, {
      headers: { "User-Agent": "eink-dashboard/1.0 (Cloudflare Worker; contact: rabbitolivestudios@gmail.com)" },
    });

    if (!res.ok) throw new Error(`Wikipedia returned ${res.status}`);

    const data: any = await res.json();
    const rawEvents: any[] = data.events ?? [];

    const events = rawEvents
      .filter((e: any) => e.year && e.text)
      .map((e: any) => ({ year: e.year as number, text: cleanText(e.text) }));

    return { events, dateStr, displayDate };
  } catch {
    return { events: [], dateStr, displayDate };
  }
}

export async function getFact(env: Env): Promise<FactResponse> {
  const { dateStr, displayDate, month, day } = getTodayChicago();
  const cacheKey = `fact:${dateStr}`;

  // Check cache
  const cached = await env.CACHE.get<CachedValue<FactResponse>>(cacheKey, "json");
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return cached.data;
  }

  try {
    const url = `https://en.wikipedia.org/api/rest_v1/feed/onthisday/events/${month}/${day}`;
    const res = await fetch(url, {
      headers: { "User-Agent": "eink-dashboard/1.0 (Cloudflare Worker; contact: rabbitolivestudios@gmail.com)" },
    });

    if (!res.ok) {
      throw new Error(`Wikipedia returned ${res.status}`);
    }

    const data: any = await res.json();
    const events: any[] = data.events ?? [];

    if (events.length === 0) {
      throw new Error("No events returned");
    }

    const selected = selectEvent(events);
    const fact = buildFact(dateStr, displayDate, selected);

    await env.CACHE.put(cacheKey, JSON.stringify({ data: fact, timestamp: Date.now() }));
    return fact;
  } catch (err) {
    // Return stale cache if available
    if (cached) {
      return cached.data;
    }
    // Return fallback
    const fallback = { ...FALLBACK_FACT, date: dateStr, display_date: displayDate };
    return fallback;
  }
}

function selectEvent(events: any[]): any {
  // Prefer events 1900–2005 with short text
  const preferred = events.filter((e) => e.year >= 1900 && e.year <= 2005);
  const pool = preferred.length > 0 ? preferred : events;

  // Sort by text length ascending, pick shortest clean summary under 160 chars
  const sorted = [...pool].sort((a, b) => (a.text?.length ?? 999) - (b.text?.length ?? 999));
  const short = sorted.find((e) => e.text && e.text.length <= 160);
  return short ?? sorted[0];
}

function buildFact(dateStr: string, displayDate: string, event: any): FactResponse {
  const pages = (event.pages ?? []).slice(0, 3).map((p: any) => ({
    title: p.title ?? p.normalizedtitle ?? "",
    url: p.content_urls?.desktop?.page ?? `https://en.wikipedia.org/wiki/${encodeURIComponent(p.title ?? "")}`,
  }));

  return {
    date: dateStr,
    display_date: displayDate,
    event: {
      year: event.year ?? 0,
      text: cleanText(event.text ?? "An interesting event occurred on this day."),
      pages,
    },
    source: "Wikimedia On this day",
  };
}

function cleanText(text: string): string {
  // Strip HTML tags if any
  return text.replace(/<[^>]+>/g, "").trim();
}
