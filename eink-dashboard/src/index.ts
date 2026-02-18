import type { Env } from "./types";
import { getWeather, getWeatherForLocation } from "./weather";
import { getFact, getTodayEvents } from "./fact";
import { generateMomentImage, generateMomentImage1Bit, generateMomentImageRaw } from "./image";
import { generateMomentBefore, getOrGenerateMoment } from "./moment";
import { handleWeatherPageV2 } from "./pages/weather2";
import { handleFactPage } from "./pages/fact";
import { handleColorWeatherPage } from "./pages/color-weather";
import { handleColorMomentPage, handleColorTestMoment, handleColorTestBirthday, generateColorMoment, getColorMomentStyle } from "./pages/color-moment";
import { handleColorAPODPage } from "./pages/color-apod";
import { handleColorHeadlinesPage } from "./pages/color-headlines";
import { getBirthdayToday, getBirthdayByKey } from "./birthday";
import { generateBirthdayImage } from "./birthday-image";
import { fetchDeviceData, E1001_DEVICE_ID, E1002_DEVICE_ID } from "./device";
import { fetchWithTimeout } from "./fetch-timeout";
import { getChicagoDateParts } from "./date-utils";
import { parseMonth, parseDay, parseStyleIdx } from "./validate";
import { getHeadlines, getCurrentPeriod } from "./headlines";
import { getAPODData, getAPODColorImage } from "./apod";
import { pngToBase64 } from "./png";

const VERSION = "3.9.0";

/** Check test endpoint auth. Returns null if allowed, or a 404 Response if denied. */
function checkTestAuth(url: URL, env: Env): Response | null {
  if (!env.TEST_AUTH_KEY) return null; // no secret configured → allow (local dev)
  const key = url.searchParams.get("key");
  if (key === env.TEST_AUTH_KEY) return null; // correct key → allow
  // Wrong or missing key → 404 (hide endpoint existence)
  return new Response("Not found", { status: 404 });
}

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
      console.log("birthday: cache hit");
      const binary = Uint8Array.from(atob(cachedB64), (c) => c.charCodeAt(0));
      return new Response(binary, { headers: PNG_HEADERS });
    }

    try {
      console.log(`Birthday detected: ${birthday.name} (${birthday.key})`);
      const png = await generateBirthdayImage(env, birthday, yearNum);
      await env.CACHE.put(bdayCacheKey, pngToBase64(png), { expirationTtl: 604800 });
      return new Response(png, { headers: PNG_HEADERS });
    } catch (err) {
      console.error("Birthday image failed, falling back to Moment Before:", err);
      // Fall through to regular pipeline
    }
  }

  // Regular Moment Before pipeline
  const cacheKey = `fact4:v4:${dateStr}`;
  const cachedB64 = await env.CACHE.get(cacheKey);
  if (cachedB64) {
    console.log("fact.png: cache hit");
    const binary = Uint8Array.from(atob(cachedB64), (c) => c.charCodeAt(0));
    return new Response(binary, { headers: PNG_HEADERS });
  }

  try {
    const { events, displayDate } = await getTodayEvents(env);
    const moment = await generateMomentBefore(env, events);
    const png = await generateMomentImage(env, moment, displayDate, dateStr);
    await env.CACHE.put(cacheKey, pngToBase64(png), { expirationTtl: 604800 });
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
  const cacheKey = `fact1:v7:${dateStr}`;

  const cachedB641 = await env.CACHE.get(cacheKey);
  if (cachedB641) {
    console.log("fact1.png: cache hit");
    const binary = Uint8Array.from(atob(cachedB641), (c) => c.charCodeAt(0));
    return new Response(binary, { headers: PNG_HEADERS });
  }

  try {
    const { events, displayDate } = await getTodayEvents(env);
    const moment = await generateMomentBefore(env, events);
    const png = await generateMomentImage1Bit(env, moment, displayDate, dateStr);
    await env.CACHE.put(cacheKey, pngToBase64(png), { expirationTtl: 604800 });
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

async function handleScheduled(env: Env, cronExpression: string): Promise<void> {
  const isDaily = cronExpression === "5 6 * * *";
  console.log(`Cron: ${isDaily ? "daily image warm" : "periodic data refresh"} (${cronExpression})`);

  try {
    const { year, month, day, dateStr } = getChicagoDateParts();
    const yearNum = parseInt(year);
    const monthNum = parseInt(month);
    const dayNum = parseInt(day);

    // --- Every-6h: headlines + weather + device (parallel, independent) ---
    const period = getCurrentPeriod();
    const sixHourResults = await Promise.allSettled([
      getHeadlines(env, dateStr, period),
      getWeather(env),
      getWeatherForLocation(env, 41.8781, -87.6298, "60606", "Chicago, IL"),
      fetchDeviceData(env, E1001_DEVICE_ID),
      fetchDeviceData(env, E1002_DEVICE_ID),
    ]);
    const labels = ["headlines", "weather-60540", "weather-60606", "device-E1001", "device-E1002"] as const;
    for (let i = 0; i < sixHourResults.length; i++) {
      if (sixHourResults[i].status === "rejected") {
        console.error(`Cron: ${labels[i]} warm failed:`, (sixHourResults[i] as PromiseRejectedResult).reason);
      }
    }
    console.log("Cron: warmed 6h data (headlines, weather, devices)");

    // --- Daily only: images + APOD ---
    if (!isDaily) return;

    // Shared dependencies: events + moment (needed by all image pipelines)
    const { events, displayDate } = await getTodayEvents(env);
    console.log(`Cron: fetched ${events.length} events for ${dateStr}`);

    const sharedMoment = await getOrGenerateMoment(env, events, dateStr);
    console.log(`Cron: shared moment — ${sharedMoment.year}, ${sharedMoment.location}`);

    const birthday = getBirthdayToday(monthNum, dayNum);

    // Launch all independent image tasks in parallel
    const tasks: Promise<void>[] = [];

    // Pipeline A or birthday
    tasks.push((async () => {
      if (birthday) {
        try {
          console.log(`Cron: birthday detected — ${birthday.name}`);
          const bdayPng = await generateBirthdayImage(env, birthday, yearNum);
          await env.CACHE.put(`birthday:v1:${dateStr}`, pngToBase64(bdayPng), { expirationTtl: 604800 });
          console.log(`Cron: cached birthday image for ${birthday.name}`);
        } catch (err) {
          console.error("Cron: birthday image failed, generating Moment Before instead:", err);
          const png4 = await generateMomentImage(env, sharedMoment, displayDate, dateStr);
          await env.CACHE.put(`fact4:v4:${dateStr}`, pngToBase64(png4), { expirationTtl: 604800 });
          console.log(`Cron: cached fallback 4-level image for ${dateStr}`);
        }
      } else {
        const png4 = await generateMomentImage(env, sharedMoment, displayDate, dateStr);
        await env.CACHE.put(`fact4:v4:${dateStr}`, pngToBase64(png4), { expirationTtl: 604800 });
        console.log(`Cron: cached 4-level image for ${dateStr}`);
      }
    })());

    // Pipeline B (always runs, independent of birthday)
    tasks.push((async () => {
      const png1 = await generateMomentImage1Bit(env, sharedMoment, displayDate, dateStr);
      await env.CACHE.put(`fact1:v7:${dateStr}`, pngToBase64(png1), { expirationTtl: 604800 });
      console.log(`Cron: cached 1-bit image for ${dateStr}`);
    })());

    // Color moment (skip on birthday)
    if (!birthday) {
      tasks.push((async () => {
        try {
          const colorStyle = getColorMomentStyle(dateStr);
          const colorCacheKey = `color-moment:v2:${dateStr}:${colorStyle.id}`;
          const existing = await env.CACHE.get(colorCacheKey);
          if (!existing) {
            const colorResult = await generateColorMoment(env, sharedMoment, dateStr);
            const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
            const colorDisplayDate = `${months[monthNum - 1]} ${dayNum}`;
            const cacheData = JSON.stringify({ imageB64: colorResult.base64, moment: sharedMoment, displayDate: colorDisplayDate });
            await env.CACHE.put(colorCacheKey, cacheData, { expirationTtl: 604800 });
            console.log(`Cron: cached color moment (${colorStyle.name}) for ${dateStr}`);
          } else {
            console.log(`Cron: color moment already cached for ${dateStr}`);
          }
        } catch (err) {
          console.error("Cron: color moment warm failed:", err);
        }
      })());
    }

    // APOD (independent)
    tasks.push((async () => {
      try {
        await getAPODData(env, dateStr);
        await getAPODColorImage(env, dateStr);
        console.log("Cron: warmed APOD data + color image");
      } catch (err) {
        console.error("Cron: APOD warm failed:", err);
      }
    })());

    // fact.json (independent)
    tasks.push((async () => {
      await getFact(env);
      console.log(`Cron: cached fact.json for ${dateStr}`);
    })());

    await Promise.allSettled(tasks);
    console.log("Cron: daily image warm complete");
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
        const authBlock = checkTestAuth(url, env);
        if (authBlock) return authBlock;
        // Test with a custom date: /test.png?m=10&d=20
        const m = parseMonth(url.searchParams.get("m") ?? "10");
        const d = parseDay(url.searchParams.get("d") ?? "20");
        const wikiUrl = `https://en.wikipedia.org/api/rest_v1/feed/onthisday/events/${m}/${d}`;
        const wikiRes = await fetchWithTimeout(wikiUrl, {
          headers: { "User-Agent": "eink-dashboard/1.0 (Cloudflare Worker)" },
        });
        const wikiData: any = await wikiRes.json();
        const testEvents = (wikiData.events ?? [])
          .filter((e: any) => e.year && e.text)
          .map((e: any) => ({ year: e.year as number, text: e.text as string }));
        const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
        const displayDate = `${months[m - 1]} ${d}`;
        const testDateStr = `2026-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
        const moment = await generateMomentBefore(env, testEvents);
        const png = await generateMomentImage(env, moment, displayDate, testDateStr);
        return new Response(png, {
          headers: { "Content-Type": "image/png", "Access-Control-Allow-Origin": "*" },
        });
      }
      case "/test1.png": {
        const authBlock1 = checkTestAuth(url, env);
        if (authBlock1) return authBlock1;
        // Test 1-bit with a custom date: /test1.png?m=10&d=31&style=woodcut
        const m1 = parseMonth(url.searchParams.get("m") ?? "10");
        const d1 = parseDay(url.searchParams.get("d") ?? "20");
        const forceStyle = url.searchParams.get("style") ?? undefined;
        const wikiUrl1 = `https://en.wikipedia.org/api/rest_v1/feed/onthisday/events/${m1}/${d1}`;
        const wikiRes1 = await fetchWithTimeout(wikiUrl1, {
          headers: { "User-Agent": "eink-dashboard/1.0 (Cloudflare Worker)" },
        });
        const wikiData1: any = await wikiRes1.json();
        const testEvents1 = (wikiData1.events ?? [])
          .filter((e: any) => e.year && e.text)
          .map((e: any) => ({ year: e.year as number, text: e.text as string }));
        const months1 = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
        const displayDate1 = `${months1[m1 - 1]} ${d1}`;
        const testDateStr = `2026-${String(m1).padStart(2, "0")}-${String(d1).padStart(2, "0")}`;
        const moment1 = await generateMomentBefore(env, testEvents1);
        const png1 = await generateMomentImage1Bit(env, moment1, displayDate1, testDateStr, forceStyle);
        return new Response(png1, {
          headers: {
            "Content-Type": "image/png",
            "Cache-Control": "no-store",
            "Access-Control-Allow-Origin": "*",
          },
        });
      }
      case "/test-birthday.png": {
        const authBlockBday = checkTestAuth(url, env);
        if (authBlockBday) return authBlockBday;
        // Test birthday portrait: /test-birthday.png?name=thiago&style=3
        const nameParam = url.searchParams.get("name") ?? "thiago";
        const person = getBirthdayByKey(nameParam);
        if (!person) {
          const safeName = nameParam.slice(0, 50).replace(/[^\w-]/g, "");
          return errorResponse(`Unknown person key: ${safeName}`, 400);
        }
        const styleParam = url.searchParams.get("style");
        const styleIdx = parseStyleIdx(styleParam);
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
      case "/color/weather":
        return handleColorWeatherPage(env, url);
      case "/color/moment":
        return handleColorMomentPage(env, url);
      case "/color/test-moment": {
        const authBlockCM = checkTestAuth(url, env);
        if (authBlockCM) return authBlockCM;
        return handleColorTestMoment(env, url);
      }
      case "/color/test-birthday": {
        const authBlockCB = checkTestAuth(url, env);
        if (authBlockCB) return authBlockCB;
        return handleColorTestBirthday(env, url);
      }
      case "/color/apod":
        return handleColorAPODPage(env, url);
      case "/color/headlines":
        return handleColorHeadlinesPage(env, url);
      case "/health":
        return handleHealth();
      default:
        return jsonResponse(
          {
            error: "Not found",
            endpoints: [
              "/weather", "/fact", "/weather.json", "/fact.json", "/fact.png", "/fact1.png",
              "/color/weather", "/color/moment", "/color/apod", "/color/headlines",
              "/test-birthday.png", "/health",
            ],
          },
          404,
          0
        );
    }
  },

  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(handleScheduled(env, event.cron));
  },
};
