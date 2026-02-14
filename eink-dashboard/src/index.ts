import type { Env } from "./types";
import { getWeather } from "./weather";
import { getFact, getTodayEvents } from "./fact";
import { generateMomentImage } from "./image";
import { generateMomentBefore } from "./moment";

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
  const cacheKey = `factpng:${dateStr}`;

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

    // Store in KV as base64
    const b64 = btoa(String.fromCharCode(...png));
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
 * Full pipeline: Wikipedia → LLM → Image AI → dither → 1-bit PNG
 */
async function generateMomentPNG(env: Env): Promise<Uint8Array> {
  // 1. Get today's events from Wikipedia
  const { events, displayDate } = await getTodayEvents(env);

  // 2. LLM picks event and generates scene + image prompt
  const moment = await generateMomentBefore(env, events);

  // 3. Generate the image (AI + dither + text overlay + encode)
  return generateMomentImage(env, moment, displayDate);
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

    const png = await generateMomentImage(env, moment, displayDate);
    const b64 = btoa(String.fromCharCode(...png));
    const cacheKey = `factpng:${dateStr}`;
    await env.CACHE.put(cacheKey, b64);
    console.log(`Cron: cached Moment Before image for ${dateStr} (${png.length} bytes)`);

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
      case "/health":
        return handleHealth();
      default:
        return jsonResponse(
          {
            error: "Not found",
            endpoints: ["/weather.json", "/fact.json", "/fact.png", "/health"],
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
