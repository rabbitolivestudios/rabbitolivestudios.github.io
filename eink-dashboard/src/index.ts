import type { Env } from "./types";
import { getWeather } from "./weather";
import { getFact, getTodayEvents } from "./fact";
import { generateMomentImage, generateMomentImage1Bit, generateMomentImageRaw } from "./image";
import { generateMomentBefore } from "./moment";
import { handleWeatherPageV2 } from "./pages/weather2";
import { handleFactPage } from "./pages/fact";
import { getBirthdayToday, getBirthdayByKey } from "./birthday";
import { generateBirthdayImage } from "./birthday-image";

const VERSION = "3.0.0";

// Simple in-memory rate limiter (per isolate lifecycle)
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT = 60; // requests per minute per IP
const RATE_WINDOW_MS = 60_000;

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(ip);
  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(ip, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return true;
  }
  entry.count++;
  return entry.count <= RATE_LIMIT;
}

function jsonResponse(data: unknown, status: number = 200, maxAge: number = 1800): Response {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": `public, max-age=${maxAge}`,
      "Access-Control-Allow-Origin": "*",
    },
  });
}

function errorResponse(message: string, status: number): Response {
  return jsonResponse({ error: message }, status, 0);
}

async function handleWeather(env: Env): Promise<Response> {
  try {
    const weather = await getWeather(env);
    return jsonResponse(weather, 200, 900); // 15 min
  } catch (err) {
    console.error("Weather error:", err);
    return jsonResponse(
      {
        error: "Failed to fetch weather data",
        location: { zip: "60540", name: "Naperville, IL" },
      },
      503,
      60
    );
  }
}

async function handleFact(env: Env): Promise<Response> {
  try {
    const fact = await getFact(env);
    return jsonResponse(fact, 200, 86400); // 24h
  } catch (err) {
    console.error("Fact error:", err);
    return jsonResponse(
      {
        error: "Failed to fetch fact data",
        date: new Date().toISOString().slice(0, 10),
      },
      503,
      60
    );
  }
}

/** Helper: encode PNG bytes to base64 in chunks (avoids stack overflow). */
function pngToBase64(png: Uint8Array): string {
  let binary = "";
  const CHUNK = 8192;
  for (let i = 0; i < png.length; i += CHUNK) {
    binary += String.fromCharCode(...png.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

/** Helper: parse Chicago date parts. */
function getChicagoDateParts(): { year: string; month: string; day: string; dateStr: string } {
  const now = new Date();
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = fmt.formatToParts(now);
  const year = parts.find((p) => p.type === "year")!.value;
  const month = parts.find((p) => p.type === "month")!.value;
  const day = parts.find((p) => p.type === "day")!.value;
  const dateStr = `${year}-${month}-${day}`;
  return { year, month, day, dateStr };
}

const PNG_HEADERS = {
  "Content-Type": "image/png",
  "Cache-Control": "public, max-age=86400",
  "Access-Control-Allow-Origin": "*",
};

/**
 * Generate the "Moment Before" 4-level grayscale image.
 * On family birthdays, generates a portrait instead.
 * Cached in KV for 24 hours per date.
 */
async function handleFactImage(env: Env): Promise<Response> {
  const { year, month, day, dateStr } = getChicagoDateParts();
  const yearNum = parseInt(year);
  const monthNum = parseInt(month);
  const dayNum = parseInt(day);

  // Check for birthday
  const birthday = getBirthdayToday(monthNum, dayNum);

  if (birthday) {
    const bdayCacheKey = `birthday:v1:${dateStr}`;
    const cachedB64 = await env.CACHE.get(bdayCacheKey);
    if (cachedB64) {
      const binary = Uint8Array.from(atob(cachedB64), (c) => c.charCodeAt(0));
      return new Response(binary, { headers: PNG_HEADERS });
    }

    try {
      console.log(`Birthday detected: ${birthday.name} (${birthday.key})`);
      const png = await generateBirthdayImage(env, birthday, yearNum);
      await env.CACHE.put(bdayCacheKey, pngToBase64(png));
      return new Response(png, { headers: PNG_HEADERS });
    } catch (err) {
      console.error("Birthday image failed, falling back to Moment Before:", err);
      // Fall through to regular pipeline
    }
  }

  // Regular Moment Before pipeline
  const cacheKey = `fact4:v2:${dateStr}`;
  const cachedB64 = await env.CACHE.get(cacheKey);
  if (cachedB64) {
    const binary = Uint8Array.from(atob(cachedB64), (c) => c.charCodeAt(0));
    return new Response(binary, { headers: PNG_HEADERS });
  }

  try {
    const { events, displayDate } = await getTodayEvents(env);
    const moment = await generateMomentBefore(env, events);
    const png = await generateMomentImage(env, moment, displayDate);
    await env.CACHE.put(cacheKey, pngToBase64(png));
    return new Response(png, { headers: PNG_HEADERS });
  } catch (err) {
    console.error("Moment Before image error:", err);
    return new Response("Failed to generate image", { status: 503 });
  }
}

/**
 * Generate the 1-bit dithered "Moment Before" image for mono e-ink displays.
 * Always shows regular Moment Before content, even on birthdays.
 * Cached separately from the grayscale version.
 */
async function handleFact1BitImage(env: Env): Promise<Response> {
  const { dateStr } = getChicagoDateParts();
  const cacheKey = `fact1:v5:${dateStr}`;

  const cachedB64 = await env.CACHE.get(cacheKey);
  if (cachedB64) {
    const binary = Uint8Array.from(atob(cachedB64), (c) => c.charCodeAt(0));
    return new Response(binary, { headers: PNG_HEADERS });
  }

  try {
    const { events, displayDate } = await getTodayEvents(env);
    const moment = await generateMomentBefore(env, events);
    const png = await generateMomentImage1Bit(env, moment, displayDate);
    await env.CACHE.put(cacheKey, pngToBase64(png));
    return new Response(png, { headers: PNG_HEADERS });
  } catch (err) {
    console.error("1-bit Moment Before image error:", err);
    return new Response("Failed to generate image", { status: 503 });
  }
}

function handleHealth(): Response {
  return jsonResponse(
    {
      status: "ok",
      version: VERSION,
      worker: "eink-dashboard",
      concept: "Moment Before",
      timestamp: new Date().toISOString(),
    },
    200,
    0
  );
}

// --- Scheduled handler (Cron) ---

async function handleScheduled(env: Env): Promise<void> {
  console.log("Cron: starting daily refresh");

  try {
    const { events, dateStr, displayDate } = await getTodayEvents(env);
    const { year, month, day } = getChicagoDateParts();
    const yearNum = parseInt(year);
    const monthNum = parseInt(month);
    const dayNum = parseInt(day);
    console.log(`Cron: fetched ${events.length} events for ${dateStr}`);

    // 1. Check for birthday → generate portrait for /fact.png
    const birthday = getBirthdayToday(monthNum, dayNum);
    if (birthday) {
      try {
        console.log(`Cron: birthday detected — ${birthday.name}`);
        const bdayPng = await generateBirthdayImage(env, birthday, yearNum);
        await env.CACHE.put(`birthday:v1:${dateStr}`, pngToBase64(bdayPng));
        console.log(`Cron: cached birthday image for ${birthday.name} (${bdayPng.length} bytes)`);
      } catch (err) {
        console.error("Cron: birthday image failed, generating Moment Before instead:", err);
        // Fall through to generate regular 4-level as fallback
        const moment4 = await generateMomentBefore(env, events);
        const png4 = await generateMomentImage(env, moment4, displayDate);
        await env.CACHE.put(`fact4:v2:${dateStr}`, pngToBase64(png4));
        console.log(`Cron: cached fallback 4-level image for ${dateStr}`);
      }
    } else {
      // 2. No birthday — regular 4-level grayscale image
      const moment4 = await generateMomentBefore(env, events);
      console.log(`Cron 4-level: LLM picked ${moment4.year}, ${moment4.location}`);
      const png4 = await generateMomentImage(env, moment4, displayDate);
      await env.CACHE.put(`fact4:v2:${dateStr}`, pngToBase64(png4));
      console.log(`Cron: cached 4-level image for ${dateStr} (${png4.length} bytes)`);
    }

    // 3. Always generate 1-bit image (not affected by birthdays)
    const moment1 = await generateMomentBefore(env, events);
    console.log(`Cron 1-bit: LLM picked ${moment1.year}, ${moment1.location}`);
    const png1 = await generateMomentImage1Bit(env, moment1, displayDate);
    await env.CACHE.put(`fact1:v5:${dateStr}`, pngToBase64(png1));
    console.log(`Cron: cached 1-bit image for ${dateStr} (${png1.length} bytes)`);

    // 4. Cache fact.json for backward compatibility
    await getFact(env);
    console.log(`Cron: cached fact.json for ${dateStr}`);

    // 5. Warm weather cache
    await getWeather(env);
    console.log("Cron: warmed weather cache");
  } catch (err) {
    console.error("Cron error:", err);
  }
}

// --- Main export ---

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    // CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
          "Access-Control-Max-Age": "86400",
        },
      });
    }

    // Rate limiting
    const ip = request.headers.get("CF-Connecting-IP") ?? "unknown";
    if (!checkRateLimit(ip)) {
      return errorResponse("Rate limit exceeded. Try again in a minute.", 429);
    }

    // Routing
    switch (path) {
      case "/weather.json":
        return handleWeather(env);
      case "/fact.json":
        return handleFact(env);
      case "/fact.png":
        return handleFactImage(env);
      case "/fact1.png":
        return handleFact1BitImage(env);
      case "/fact-raw.jpg": {
        const { events, displayDate } = await getTodayEvents(env);
        const moment = await generateMomentBefore(env, events);
        const jpeg = await generateMomentImageRaw(env, moment);
        return new Response(jpeg, {
          headers: { "Content-Type": "image/jpeg", "Access-Control-Allow-Origin": "*" },
        });
      }
      case "/test.png": {
        // Test with a custom date: /test.png?m=10&d=20
        const m = url.searchParams.get("m") ?? "10";
        const d = url.searchParams.get("d") ?? "20";
        const wikiUrl = `https://en.wikipedia.org/api/rest_v1/feed/onthisday/events/${m}/${d}`;
        const wikiRes = await fetch(wikiUrl, {
          headers: { "User-Agent": "eink-dashboard/1.0 (Cloudflare Worker)" },
        });
        const wikiData: any = await wikiRes.json();
        const testEvents = (wikiData.events ?? [])
          .filter((e: any) => e.year && e.text)
          .map((e: any) => ({ year: e.year as number, text: e.text as string }));
        const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
        const displayDate = `${months[parseInt(m) - 1]} ${parseInt(d)}`;
        const moment = await generateMomentBefore(env, testEvents);
        const png = await generateMomentImage(env, moment, displayDate);
        return new Response(png, {
          headers: { "Content-Type": "image/png", "Access-Control-Allow-Origin": "*" },
        });
      }
      case "/test1.png": {
        // Test 1-bit with a custom date: /test1.png?m=10&d=31
        const m1 = url.searchParams.get("m") ?? "10";
        const d1 = url.searchParams.get("d") ?? "20";
        const wikiUrl1 = `https://en.wikipedia.org/api/rest_v1/feed/onthisday/events/${m1}/${d1}`;
        const wikiRes1 = await fetch(wikiUrl1, {
          headers: { "User-Agent": "eink-dashboard/1.0 (Cloudflare Worker)" },
        });
        const wikiData1: any = await wikiRes1.json();
        const testEvents1 = (wikiData1.events ?? [])
          .filter((e: any) => e.year && e.text)
          .map((e: any) => ({ year: e.year as number, text: e.text as string }));
        const months1 = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
        const displayDate1 = `${months1[parseInt(m1) - 1]} ${parseInt(d1)}`;
        const moment1 = await generateMomentBefore(env, testEvents1);
        const png1 = await generateMomentImage1Bit(env, moment1, displayDate1);
        return new Response(png1, {
          headers: { "Content-Type": "image/png", "Access-Control-Allow-Origin": "*" },
        });
      }
      case "/test-birthday.png": {
        // Test birthday portrait: /test-birthday.png?name=thiago&style=3
        const nameParam = url.searchParams.get("name") ?? "thiago";
        const person = getBirthdayByKey(nameParam);
        if (!person) {
          return errorResponse(`Unknown person key: ${nameParam}`, 400);
        }
        const styleParam = url.searchParams.get("style");
        const styleIdx = styleParam !== null ? parseInt(styleParam) : undefined;
        try {
          const png = await generateBirthdayImage(env, person, new Date().getFullYear(), styleIdx);
          return new Response(png, {
            headers: { "Content-Type": "image/png", "Access-Control-Allow-Origin": "*" },
          });
        } catch (err) {
          console.error("Test birthday error:", err);
          return new Response("Failed to generate birthday image", { status: 503 });
        }
      }
      case "/weather":
        return handleWeatherPageV2(env, url);
      case "/fact":
        return handleFactPage();
      case "/health":
        return handleHealth();
      default:
        return jsonResponse(
          {
            error: "Not found",
            endpoints: ["/weather", "/fact", "/weather.json", "/fact.json", "/fact.png", "/fact1.png", "/test-birthday.png", "/health"],
          },
          404,
          0
        );
    }
  },

  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(handleScheduled(env));
  },
};
