import type { Env } from "./types";
import { getWeather } from "./weather";
import { getFact, getTodayEvents } from "./fact";
import { generateMomentImage, generateMomentImage1Bit, generateMomentImageRaw } from "./image";
import { generateMomentBefore } from "./moment";
import { handleWeatherPage } from "./pages/weather";
import { handleFactPage } from "./pages/fact";

const VERSION = "2.0.0";

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
    return jsonResponse(weather, 200, 1800); // 30 min
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

/**
 * Generate the "Moment Before" image.
 *
 * Pipeline:
 *   Wikipedia events → LLM picks event + scene → AI image gen → dither → 1-bit PNG
 *
 * Cached in KV for 24 hours per date.
 */
async function handleFactImage(env: Env): Promise<Response> {
  // Determine today's cache key
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
  const cacheKey = `factpng_sdxl:v1:${dateStr}`;

  // Try KV cache first
  const cachedB64 = await env.CACHE.get(cacheKey);
  if (cachedB64) {
    const binary = Uint8Array.from(atob(cachedB64), (c) => c.charCodeAt(0));
    return new Response(binary, {
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "public, max-age=86400",
        "Access-Control-Allow-Origin": "*",
      },
    });
  }

  // Cache miss — run the full Moment Before pipeline
  try {
    const png = await generateMomentPNG(env);

    // Store in KV as base64 (chunk to avoid stack overflow)
    let binary = "";
    const CHUNK = 8192;
    for (let i = 0; i < png.length; i += CHUNK) {
      binary += String.fromCharCode(...png.subarray(i, i + CHUNK));
    }
    const b64 = btoa(binary);
    await env.CACHE.put(cacheKey, b64);

    return new Response(png, {
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "public, max-age=86400",
        "Access-Control-Allow-Origin": "*",
      },
    });
  } catch (err) {
    console.error("Moment Before image error:", err);
    return new Response("Failed to generate image", { status: 503 });
  }
}

/**
 * Generate the 1-bit dithered "Moment Before" image for mono e-ink displays.
 * Cached separately from the grayscale version.
 */
async function handleFact1BitImage(env: Env): Promise<Response> {
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
  const cacheKey = `fact1png_sdxl:v1:${dateStr}`;

  // Try KV cache first
  const cachedB64 = await env.CACHE.get(cacheKey);
  if (cachedB64) {
    const binary = Uint8Array.from(atob(cachedB64), (c) => c.charCodeAt(0));
    return new Response(binary, {
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "public, max-age=86400",
        "Access-Control-Allow-Origin": "*",
      },
    });
  }

  // Cache miss — run the full pipeline with 1-bit dithering
  try {
    const { events, displayDate } = await getTodayEvents(env);
    const moment = await generateMomentBefore(env, events);
    const png = await generateMomentImage1Bit(env, moment, displayDate);

    // Store in KV as base64
    let binary = "";
    const CHUNK = 8192;
    for (let i = 0; i < png.length; i += CHUNK) {
      binary += String.fromCharCode(...png.subarray(i, i + CHUNK));
    }
    await env.CACHE.put(cacheKey, btoa(binary));

    return new Response(png, {
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "public, max-age=86400",
        "Access-Control-Allow-Origin": "*",
      },
    });
  } catch (err) {
    console.error("1-bit Moment Before image error:", err);
    return new Response("Failed to generate image", { status: 503 });
  }
}

/**
 * Full pipeline: Wikipedia → LLM → Image AI → dither → 1-bit PNG
 */
async function generateMomentPNG(env: Env): Promise<Uint8Array> {
  // 1. Get today's events from Wikipedia
  const { events, displayDate } = await getTodayEvents(env);
  console.log(`Pipeline: fetched ${events.length} events for ${displayDate}`);

  // 2. LLM picks event and generates scene + image prompt
  const moment = await generateMomentBefore(env, events);
  console.log(`Pipeline: LLM picked ${moment.year}, ${moment.location}`);

  // 3. Generate the image (AI + dither + text overlay + encode)
  const png = await generateMomentImage(env, moment, displayDate);
  console.log(`Pipeline: generated ${png.length} byte PNG`);
  return png;
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
  console.log("Cron: starting daily Moment Before refresh");

  try {
    // 1. Generate and cache today's Moment Before image
    const { events, dateStr, displayDate } = await getTodayEvents(env);
    console.log(`Cron: fetched ${events.length} events for ${dateStr}`);

    const moment = await generateMomentBefore(env, events);
    console.log(`Cron: LLM picked ${moment.year}, ${moment.location}`);

    // Generate and cache 8-bit grayscale image
    const png = await generateMomentImage(env, moment, displayDate);
    let cronBinary = "";
    const CRON_CHUNK = 8192;
    for (let i = 0; i < png.length; i += CRON_CHUNK) {
      cronBinary += String.fromCharCode(...png.subarray(i, i + CRON_CHUNK));
    }
    const b64 = btoa(cronBinary);
    const cacheKey = `factpng_sdxl:v1:${dateStr}`;
    await env.CACHE.put(cacheKey, b64);
    console.log(`Cron: cached grayscale image for ${dateStr} (${png.length} bytes)`);

    // Generate and cache 1-bit dithered image
    const png1 = await generateMomentImage1Bit(env, moment, displayDate);
    let cron1Binary = "";
    for (let i = 0; i < png1.length; i += CRON_CHUNK) {
      cron1Binary += String.fromCharCode(...png1.subarray(i, i + CRON_CHUNK));
    }
    const cache1Key = `fact1png_sdxl:v1:${dateStr}`;
    await env.CACHE.put(cache1Key, btoa(cron1Binary));
    console.log(`Cron: cached 1-bit image for ${dateStr} (${png1.length} bytes)`);

    // 2. Also cache the fact.json for backward compatibility
    await getFact(env);
    console.log(`Cron: cached fact.json for ${dateStr}`);

    // 3. Warm weather cache
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
      case "/weather":
        return handleWeatherPage(env);
      case "/fact":
        return handleFactPage();
      case "/health":
        return handleHealth();
      default:
        return jsonResponse(
          {
            error: "Not found",
            endpoints: ["/weather", "/fact", "/weather.json", "/fact.json", "/fact.png", "/fact1.png", "/health"],
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
