import type { Env } from "./types";
import { getWeather, getWeatherForLocation } from "./weather";
import { getFact, getTodayEvents } from "./fact";
import { generateMomentImage, generateMomentImage1Bit, generateMomentImageRaw } from "./image";
import { generateMomentBefore, getOrGenerateMoment } from "./moment";
import { handleWeatherPageV2 } from "./pages/weather2";
import { handleFactPage } from "./pages/fact";
import { handleColorWeatherPage } from "./pages/color-weather";
import { handleColorMomentPage, handleColorTestMoment, handleColorTestBirthday, generateColorMoment, getColorMomentStyle } from "./pages/color-moment";
// Headlines temporarily disabled — stale news problem; will rethink approach
// import { handleColorHeadlinesPage } from "./pages/color-headlines";
import { skylinePageResponse, skylineTestPageResponse, skylineBwPageResponse } from "./pages/skyline";
import { getBirthdayToday, getBirthdayByKey } from "./birthday";
import { generateBirthdayImage } from "./birthday-image";
import { fetchDeviceData, E1001_DEVICE_ID, E1002_DEVICE_ID } from "./device";
import { fetchWithTimeout } from "./fetch-timeout";
import { getChicagoDateParts } from "./date-utils";
import { parseMonth, parseDay, parseStyleIdx } from "./validate";
// Headlines temporarily disabled — stale news problem; will rethink approach
// import { getHeadlines, getCurrentPeriod } from "./headlines";
import { pngToBase64 } from "./png";
import {
  parseDateParts,
  pickSkylineCity,
  pickSkylineStyle,
  buildSkylinePrompt,
  formatSkylineCaption,
  findSkylineStyleByKey,
  findSkylineCity,
  buildSkylineRefPrompt,
  computeBucket,
  DEFAULT_MODE,
  DEFAULT_ROTATE_MIN,
  djb2,
} from "./skyline";
import type { SkylineColorMode, SkylineMode, SkylinePickerOpts, SkylineCity } from "./skyline";
import { generateSkylineImage } from "./skyline-image";

const VERSION = "3.11.1";

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

// --- Skyline helpers ---

function parseSkylineMode(raw: string | null): SkylineMode {
  if (raw === "daily" || raw === "random" || raw === "rotate") return raw;
  return DEFAULT_MODE;
}

function parseSkylineRotateMin(raw: string | null): number {
  if (!raw) return DEFAULT_ROTATE_MIN;
  const n = parseInt(raw, 10);
  if (isNaN(n) || n < 1) return DEFAULT_ROTATE_MIN;
  return Math.min(n, 1440); // cap at 24h
}

// --- Skyline debug headers ---

function skylineDebugHeaders(
  dateStr: string, mode: string, rotateMin: number, bucket: number,
  city: SkylineCity, styleKey: string, colorMode: string,
): Record<string, string> {
  return {
    "X-Skyline-Date": dateStr,
    "X-Skyline-Mode": mode,
    "X-Skyline-RotateMin": String(rotateMin),
    "X-Skyline-Bucket": mode === "rotate" ? String(bucket) : "-",
    "X-Skyline-City": city.name,
    "X-Skyline-CityKey": city.key,
    "X-Skyline-Style": styleKey,
    "X-Skyline-ColorMode": colorMode,
  };
}

// --- Skyline stale fallback ---

/**
 * Scan previous rotation buckets and yesterday's cache for a stale skyline image.
 * Returns base64 string if found, null otherwise.
 */
async function findStaleSkylineCache(
  env: Env, dateStr: string, rotateMin: number, currentBucket: number, bwSuffix: string,
): Promise<string | null> {
  // Try today's daily key first
  const dailyKey = `skyline:v3:${dateStr}:daily${bwSuffix}`;
  const dailyVal = await env.CACHE.get(dailyKey);
  if (dailyVal) {
    console.log("Skyline stale fallback: found today's daily cache");
    return dailyVal;
  }

  // Try previous rotation buckets (up to 10 back = ~2.5 hours at 15-min rotation)
  for (let i = 1; i <= 10; i++) {
    const prevBucket = currentBucket - i;
    if (prevBucket < 0) break;
    const key = `skyline:v3:${dateStr}:r${rotateMin}:b${prevBucket}${bwSuffix}`;
    const val = await env.CACHE.get(key);
    if (val) {
      console.log(`Skyline stale fallback: found bucket b${prevBucket}`);
      return val;
    }
  }

  // Try yesterday's daily + rotation keys
  const yesterday = new Date(Date.now() - 86400000);
  const yStr = `${yesterday.getFullYear()}-${String(yesterday.getMonth() + 1).padStart(2, "0")}-${String(yesterday.getDate()).padStart(2, "0")}`;

  const yDailyVal = await env.CACHE.get(`skyline:v3:${yStr}:daily${bwSuffix}`);
  if (yDailyVal) {
    console.log(`Skyline stale fallback: found yesterday ${yStr} daily cache`);
    return yDailyVal;
  }

  for (let i = 0; i <= 5; i++) {
    const key = `skyline:v3:${yStr}:r${rotateMin}:b${currentBucket - i}${bwSuffix}`;
    const val = await env.CACHE.get(key);
    if (val) {
      console.log(`Skyline stale fallback: found yesterday ${yStr} b${currentBucket - i}`);
      return val;
    }
  }

  // Try v2 keys (pre-upgrade cache) as last resort
  for (let i = 0; i <= 5; i++) {
    const key = `skyline:v2:${dateStr}:r${rotateMin}:b${currentBucket - i}${bwSuffix}`;
    const val = await env.CACHE.get(key);
    if (val) {
      console.log(`Skyline stale fallback: found v2 cache b${currentBucket - i}`);
      return val;
    }
  }

  return null;
}

// --- Skyline handlers ---

/**
 * Cross-fallback: if color skyline is unavailable, try serving the BW cache.
 * A BW image on a color display is far better than a blank screen / 503.
 */
async function findBwFallback(
  env: Env, dateStr: string, rotateMin: number, bucket: number,
): Promise<string | null> {
  return findStaleSkylineCache(env, dateStr, rotateMin, bucket, ":bw");
}

async function handleSkylinePng(env: Env, url: URL): Promise<Response> {
  const { dateStr } = getChicagoDateParts();
  const mode = parseSkylineMode(url.searchParams.get("mode"));
  const rotateMin = parseSkylineRotateMin(url.searchParams.get("rotateMin"));
  const bucket = computeBucket(rotateMin);
  const bwOnly = url.searchParams.get("bw") === "1";
  const colorModeFilter = bwOnly ? "bw" as const : undefined;
  const opts: SkylinePickerOpts = { mode, rotateMin, bucket, colorModeFilter };

  // Resolve city + style (needed for debug headers even on cache hit)
  const parts = parseDateParts(dateStr);
  const city = pickSkylineCity(parts, opts);
  const style = pickSkylineStyle(parts, opts);
  const debug = skylineDebugHeaders(dateStr, mode, rotateMin, bucket, city, style.key, style.colorMode);

  const refPrompt = buildSkylineRefPrompt(city, style);
  const sdxlPrompt = buildSkylinePrompt(city, style);
  const caption = formatSkylineCaption(city, parts.displayDate);
  const photoSeed = djb2(`${dateStr}|photo|${bucket}`);

  // mode=random → no cache
  if (mode === "random") {
    try {
      console.log(`Skyline random: ${city.name} | ${style.label} (${style.colorMode})`);
      const result = await generateSkylineImage(env, refPrompt, sdxlPrompt, caption, style.colorMode, city.key, photoSeed, bwOnly);
      return new Response(result.png, {
        headers: { "Content-Type": "image/png", "Cache-Control": "no-store", "Access-Control-Allow-Origin": "*", ...debug, "X-Skyline-UsedRef": String(result.usedRef) },
      });
    } catch (err) {
      console.error("Skyline random error:", err);
      // Random mode has no cache to fall back to — try any recent bucket
      const stale = await findStaleSkylineCache(env, dateStr, rotateMin, bucket, bwOnly ? ":bw" : "");
      if (stale) {
        console.log("Skyline random: serving stale fallback");
        try {
          const binary = Uint8Array.from(atob(stale), (c) => c.charCodeAt(0));
          return new Response(binary, {
            headers: { "Content-Type": "image/png", "Cache-Control": "no-store", "Access-Control-Allow-Origin": "*", ...debug, "X-Skyline-Fallback": "stale" },
          });
        } catch { /* fall through */ }
      }
      // Cross-fallback: color request can serve BW cache (better than blank screen)
      if (!bwOnly) {
        const bwFallback = await findBwFallback(env, dateStr, rotateMin, bucket);
        if (bwFallback) {
          console.log("Skyline: serving BW cache as cross-fallback for color");
          try {
            const binary = Uint8Array.from(atob(bwFallback), (c) => c.charCodeAt(0));
            return new Response(binary, {
              headers: { "Content-Type": "image/png", "Cache-Control": "no-store", "Access-Control-Allow-Origin": "*", ...debug, "X-Skyline-Fallback": "bw-cross" },
            });
          } catch { /* fall through */ }
        }
      }
      return new Response("Failed to generate skyline image", { status: 503 });
    }
  }

  // mode=rotate or daily → KV cached
  const bwSuffix = bwOnly ? ":bw" : "";
  const cacheKey = mode === "rotate"
    ? `skyline:v3:${dateStr}:r${rotateMin}:b${bucket}${bwSuffix}`
    : `skyline:v3:${dateStr}:daily${bwSuffix}`;
  const ttl = mode === "rotate" ? rotateMin * 60 : 86400;
  const maxAge = mode === "rotate" ? rotateMin * 60 : 86400;

  const cached = await env.CACHE.get(cacheKey);
  if (cached) {
    console.log(`skyline.png: cache hit (${mode}, bucket=${bucket})`);
    try {
      const binary = Uint8Array.from(atob(cached), (c) => c.charCodeAt(0));
      return new Response(binary, {
        headers: { "Content-Type": "image/png", "Cache-Control": `public, max-age=${maxAge}`, "Access-Control-Allow-Origin": "*", ...debug },
      });
    } catch { /* cache corrupted, regenerate */ }
  }

  try {
    console.log(`Skyline ${mode}: ${city.name} | ${style.label} (${style.colorMode}) | bucket=${bucket}${bwOnly ? " sdxlOnly" : ""}`);

    const result = await generateSkylineImage(env, refPrompt, sdxlPrompt, caption, style.colorMode, city.key, photoSeed, bwOnly);
    await env.CACHE.put(cacheKey, result.base64, { expirationTtl: Math.max(ttl, 900) });

    return new Response(result.png, {
      headers: { "Content-Type": "image/png", "Cache-Control": `public, max-age=${maxAge}`, "Access-Control-Allow-Origin": "*", ...debug, "X-Skyline-UsedRef": String(result.usedRef) },
    });
  } catch (err) {
    console.error("Skyline image error:", err);

    // Stale fallback: try recent previous buckets, then yesterday's cache
    const stale = await findStaleSkylineCache(env, dateStr, rotateMin, bucket, bwSuffix);
    if (stale) {
      console.log("Skyline: serving stale cached image as fallback");
      try {
        const binary = Uint8Array.from(atob(stale), (c) => c.charCodeAt(0));
        return new Response(binary, {
          headers: { "Content-Type": "image/png", "Cache-Control": "no-store", "Access-Control-Allow-Origin": "*", ...debug, "X-Skyline-Fallback": "stale" },
        });
      } catch { /* corrupted, fall through */ }
    }

    // Cross-fallback: color request can serve BW cache (better than blank screen)
    if (!bwOnly) {
      const bwFallback = await findBwFallback(env, dateStr, rotateMin, bucket);
      if (bwFallback) {
        console.log("Skyline: serving BW cache as cross-fallback for color");
        try {
          const binary = Uint8Array.from(atob(bwFallback), (c) => c.charCodeAt(0));
          return new Response(binary, {
            headers: { "Content-Type": "image/png", "Cache-Control": "no-store", "Access-Control-Allow-Origin": "*", ...debug, "X-Skyline-Fallback": "bw-cross" },
          });
        } catch { /* fall through */ }
      }
    }

    return new Response("Failed to generate skyline image", { status: 503 });
  }
}

function handleSkylinePage(url: URL): Response {
  return skylinePageResponse(url.search.replace(/^\?/, ""));
}

async function handleSkylineTestPng(env: Env, url: URL): Promise<Response> {
  const hasExplicitDate = url.searchParams.has("date");
  const dateParam = url.searchParams.get("date") ?? getChicagoDateParts().dateStr;
  const parts = parseDateParts(dateParam);

  // Default to daily when date is provided (so different dates show different cities)
  const modeParam = url.searchParams.get("mode");
  const mode: SkylineMode = modeParam ? parseSkylineMode(modeParam) : (hasExplicitDate ? "daily" : DEFAULT_MODE);
  const rotateMin = parseSkylineRotateMin(url.searchParams.get("rotateMin"));
  const bucket = computeBucket(rotateMin);
  const opts: SkylinePickerOpts = { mode, rotateMin, bucket };

  const cityOverride = url.searchParams.get("city");
  const styleOverride = url.searchParams.get("style");
  const colorOverride = url.searchParams.get("color");

  const city: SkylineCity = (cityOverride ? findSkylineCity(cityOverride) : null)
    ?? (cityOverride ? { name: cityOverride, key: cityOverride.toLowerCase().replace(/[^a-z0-9]+/g, "_"), landmarks: "" } : null)
    ?? pickSkylineCity(parts, opts);
  const style = (styleOverride ? findSkylineStyleByKey(styleOverride) : null) ?? pickSkylineStyle(parts, opts);
  const colorMode: SkylineColorMode = colorOverride === "1" ? "color" : colorOverride === "0" ? "bw" : style.colorMode;

  const refPrompt = buildSkylineRefPrompt(city, { ...style, colorMode });
  const sdxlPrompt = buildSkylinePrompt(city, { ...style, colorMode });
  const caption = formatSkylineCaption(city, parts.displayDate);
  const photoSeed = djb2(`${parts.dateStr}|photo|${bucket}`);
  console.log(`Skyline test: ${city.name} | ${style.label} (${colorMode}) | ${parts.dateStr} | mode=${mode}`);

  const debug = skylineDebugHeaders(parts.dateStr, mode, rotateMin, bucket, city, style.key, colorMode);
  const result = await generateSkylineImage(env, refPrompt, sdxlPrompt, caption, colorMode, city.key, photoSeed);
  return new Response(result.png, {
    headers: { "Content-Type": "image/png", "Cache-Control": "no-store", "Access-Control-Allow-Origin": "*", ...debug, "X-Skyline-UsedRef": String(result.usedRef) },
  });
}

function handleSkylineTestPage(url: URL): Response {
  return skylineTestPageResponse(url.search.replace(/^\?/, ""));
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

async function handleHealthDetailed(env: Env): Promise<Response> {
  const { month, day, dateStr } = getChicagoDateParts();
  const monthNum = parseInt(month);
  const dayNum = parseInt(day);
  const now = Date.now();

  function parseEphemeral(raw: string | null): { timestamp: number } | null {
    if (!raw) return null;
    try { return JSON.parse(raw) as { timestamp: number }; } catch { return null; }
  }

  function ageMins(entry: { timestamp: number } | null): number | null {
    if (!entry) return null;
    return Math.round((now - entry.timestamp) / 6000) / 10;
  }

  function ephemeralStatus(entry: { timestamp: number } | null, softTtlMin: number) {
    const age = ageMins(entry);
    return { cached: entry !== null, age_min: age, stale: age !== null ? age > softTtlMin : true };
  }

  // Determine daily image keys (birthday-aware)
  const birthday = getBirthdayToday(monthNum, dayNum);
  const colorStyle = getColorMomentStyle(dateStr);
  const fact4Key = birthday ? `birthday:v1:${dateStr}` : `fact4:v4:${dateStr}`;
  const fact1Key = `fact1:v7:${dateStr}`;
  const colorMomentKey = birthday ? `color-birthday:v1:${dateStr}` : `color-moment:v2:${dateStr}:${colorStyle.id}`;
  const skylineKey = DEFAULT_MODE === "daily"
    ? `skyline:v3:${dateStr}:daily`
    : `skyline:v3:${dateStr}:r${DEFAULT_ROTATE_MIN}:b${computeBucket(DEFAULT_ROTATE_MIN)}`;
  const skylineBwKey = DEFAULT_MODE === "daily"
    ? `skyline:v3:${dateStr}:daily:bw`
    : `skyline:v3:${dateStr}:r${DEFAULT_ROTATE_MIN}:b${computeBucket(DEFAULT_ROTATE_MIN)}:bw`;
  const momentKey = `moment:v1:${dateStr}`;

  // Fetch all keys in parallel
  const [
    fact4Raw, fact1Raw, colorMomentRaw, skylineRaw, skylineBwRaw, momentRaw,
    weatherHomeRaw, weatherOfficeRaw,
    alertsHomeRaw, alertsOfficeRaw,
    deviceHomeRaw, deviceOfficeRaw,
  ] = await Promise.all([
    env.CACHE.get(fact4Key),
    env.CACHE.get(fact1Key),
    env.CACHE.get(colorMomentKey),
    env.CACHE.get(skylineKey),
    env.CACHE.get(skylineBwKey),
    env.CACHE.get(momentKey),
    env.CACHE.get("weather:60540:v2"),
    env.CACHE.get("weather:60606:v2"),
    env.CACHE.get("alerts:60540:v1"),
    env.CACHE.get("alerts:60606:v1"),
    env.CACHE.get(`device:${E1001_DEVICE_ID}:v1`),
    env.CACHE.get(`device:${E1002_DEVICE_ID}:v1`),
  ]);

  return jsonResponse(
    {
      status: "ok",
      version: VERSION,
      timestamp: new Date().toISOString(),
      date_chicago: dateStr,
      daily_images: {
        fact4_gray:   { cached: fact4Raw !== null,       key: fact4Key },
        fact1_1bit:   { cached: fact1Raw !== null,       key: fact1Key },
        color_moment: { cached: colorMomentRaw !== null, key: colorMomentKey, style: colorStyle.id },
        skyline:      { cached: skylineRaw !== null,     key: skylineKey },
        skyline_bw:   { cached: skylineBwRaw !== null,   key: skylineBwKey },
        moment_event: { cached: momentRaw !== null,      key: momentKey },
      },
      ephemeral: {
        weather_home:   ephemeralStatus(parseEphemeral(weatherHomeRaw),   15),
        weather_office: ephemeralStatus(parseEphemeral(weatherOfficeRaw), 15),
        alerts_home:    ephemeralStatus(parseEphemeral(alertsHomeRaw),     5),
        alerts_office:  ephemeralStatus(parseEphemeral(alertsOfficeRaw),   5),
        device_home:    ephemeralStatus(parseEphemeral(deviceHomeRaw),     5),
        device_office:  ephemeralStatus(parseEphemeral(deviceOfficeRaw),   5),
      },
      config: {
        test_auth_key: env.TEST_AUTH_KEY ? "configured" : "missing",
      },
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

    // --- Every-6h: weather + device (parallel, independent) ---
    // Headlines temporarily disabled — stale news problem; will rethink approach
    const sixHourResults = await Promise.allSettled([
      getWeather(env),
      getWeatherForLocation(env, 41.8781, -87.6298, "60606", "Chicago, IL"),
      fetchDeviceData(env, E1001_DEVICE_ID),
      fetchDeviceData(env, E1002_DEVICE_ID),
    ]);
    const labels = ["weather-60540", "weather-60606", "device-E1001", "device-E1002"] as const;
    for (let i = 0; i < sixHourResults.length; i++) {
      if (sixHourResults[i].status === "rejected") {
        console.error(`Cron: ${labels[i]} warm failed:`, (sixHourResults[i] as PromiseRejectedResult).reason);
      }
    }
    console.log("Cron: warmed 6h data (weather, devices)");

    // --- Daily only: images + skyline ---
    if (!isDaily) return;

    // Shared dependencies: events + moment (needed by all image pipelines)
    const { events, displayDate } = await getTodayEvents(env);
    console.log(`Cron: fetched ${events.length} events for ${dateStr}`);

    const sharedMoment = await getOrGenerateMoment(env, events, dateStr);
    console.log(`Cron: shared moment — ${sharedMoment.year}, ${sharedMoment.location}`);

    const birthday = getBirthdayToday(monthNum, dayNum);

    // fact.json first (no AI cost)
    try {
      await getFact(env);
      console.log(`Cron: cached fact.json for ${dateStr}`);
    } catch (err) {
      console.error("Cron: fact.json failed:", err);
    }

    // --- Sequential image generation with neuron budget awareness ---
    // Workers AI free tier = 10,000 neurons/day. Running in parallel would
    // exhaust the budget before any single pipeline finishes its SDXL fallback.
    // Sequential execution + early abort ensures core images are prioritized.
    let budgetExhausted = false;
    function isNeuronError(err: unknown): boolean {
      const msg = String((err as any)?.message ?? err);
      return msg.includes("4006") || msg.includes("neurons");
    }

    // 1. Pipeline A (or birthday) — HIGHEST PRIORITY
    if (!budgetExhausted) {
      try {
        if (birthday) {
          console.log(`Cron: birthday detected — ${birthday.name}`);
          const bdayPng = await generateBirthdayImage(env, birthday, yearNum);
          await env.CACHE.put(`birthday:v1:${dateStr}`, pngToBase64(bdayPng), { expirationTtl: 604800 });
          console.log(`Cron: cached birthday image for ${birthday.name}`);
        } else {
          const png4 = await generateMomentImage(env, sharedMoment, displayDate, dateStr);
          await env.CACHE.put(`fact4:v4:${dateStr}`, pngToBase64(png4), { expirationTtl: 604800 });
          console.log(`Cron: cached 4-level image for ${dateStr}`);
        }
      } catch (err) {
        if (isNeuronError(err)) {
          budgetExhausted = true;
          console.error("Cron: neuron budget exhausted at Pipeline A");
        } else {
          console.error("Cron: Pipeline A failed:", err);
        }
      }
    }

    // 2. Pipeline B
    if (!budgetExhausted) {
      try {
        const png1 = await generateMomentImage1Bit(env, sharedMoment, displayDate, dateStr);
        await env.CACHE.put(`fact1:v7:${dateStr}`, pngToBase64(png1), { expirationTtl: 604800 });
        console.log(`Cron: cached 1-bit image for ${dateStr}`);
      } catch (err) {
        if (isNeuronError(err)) {
          budgetExhausted = true;
          console.error("Cron: neuron budget exhausted at Pipeline B");
        } else {
          console.error("Cron: Pipeline B failed:", err);
        }
      }
    }

    // 3. Color moment
    if (!budgetExhausted && !birthday) {
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
        if (isNeuronError(err)) {
          budgetExhausted = true;
          console.error("Cron: neuron budget exhausted at color moment");
        } else {
          console.error("Cron: color moment warm failed:", err);
        }
      }
    }

    // 4. Skyline — daily mode (one generation per day) — LOWEST PRIORITY
    if (!budgetExhausted) {
      try {
        const skylineCacheKey = `skyline:v3:${dateStr}:daily`;
        const existingSkyline = await env.CACHE.get(skylineCacheKey);
        if (!existingSkyline) {
          const skylineParts = parseDateParts(dateStr);
          const skylineOpts: SkylinePickerOpts = { mode: "daily", rotateMin: DEFAULT_ROTATE_MIN, bucket: 0 };
          const skylineCity = pickSkylineCity(skylineParts, skylineOpts);
          const skylineStyle = pickSkylineStyle(skylineParts, skylineOpts);
          const skylineRefPrompt = buildSkylineRefPrompt(skylineCity, skylineStyle);
          const skylineSdxlPrompt = buildSkylinePrompt(skylineCity, skylineStyle);
          const skylineCaption = formatSkylineCaption(skylineCity, skylineParts.displayDate);
          const skylinePhotoSeed = djb2(`${dateStr}|photo|daily`);
          const skylineResult = await generateSkylineImage(env, skylineRefPrompt, skylineSdxlPrompt, skylineCaption, skylineStyle.colorMode, skylineCity.key, skylinePhotoSeed);
          await env.CACHE.put(skylineCacheKey, skylineResult.base64, { expirationTtl: 86400 });
          console.log(`Cron: cached skyline daily (${skylineCity.name}, ${skylineStyle.label}, ref=${skylineResult.usedRef})`);
        } else {
          console.log(`Cron: skyline already cached for today`);
        }
      } catch (err) {
        if (isNeuronError(err)) {
          budgetExhausted = true;
          console.error("Cron: neuron budget exhausted at skyline");
        } else {
          console.error("Cron: skyline warm failed:", err);
        }
      }
    }

    // 5. Skyline BW — daily mode
    if (!budgetExhausted) {
      try {
        const bwCacheKey = `skyline:v3:${dateStr}:daily:bw`;
        const existingBw = await env.CACHE.get(bwCacheKey);
        if (!existingBw) {
          const bwParts = parseDateParts(dateStr);
          const bwOpts: SkylinePickerOpts = { mode: "daily", rotateMin: DEFAULT_ROTATE_MIN, bucket: 0, colorModeFilter: "bw" };
          const bwCity = pickSkylineCity(bwParts, bwOpts);
          const bwStyle = pickSkylineStyle(bwParts, bwOpts);
          const bwRefPrompt = buildSkylineRefPrompt(bwCity, bwStyle);
          const bwSdxlPrompt = buildSkylinePrompt(bwCity, bwStyle);
          const bwCaption = formatSkylineCaption(bwCity, bwParts.displayDate);
          const bwPhotoSeed = djb2(`${dateStr}|photo|daily-bw`);
          const bwResult = await generateSkylineImage(env, bwRefPrompt, bwSdxlPrompt, bwCaption, bwStyle.colorMode, bwCity.key, bwPhotoSeed, true);
          await env.CACHE.put(bwCacheKey, bwResult.base64, { expirationTtl: 86400 });
          console.log(`Cron: cached skyline BW daily (${bwCity.name}, ${bwStyle.label}, sdxlOnly)`);
        } else {
          console.log(`Cron: skyline BW already cached for today`);
        }
      } catch (err) {
        if (isNeuronError(err)) {
          budgetExhausted = true;
          console.error("Cron: neuron budget exhausted at skyline BW");
        } else {
          console.error("Cron: skyline BW warm failed:", err);
        }
      }
    }

    if (budgetExhausted) {
      console.error("Cron: WARNING — neuron budget exhausted before all images generated. Consider upgrading to Workers Paid plan ($5/mo).");
    }
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
        // Redirect legacy APOD route to skyline
        return Response.redirect(new URL("/skyline", url).href, 301);
      case "/color/headlines":
        // Headlines temporarily disabled — redirect to skyline so E1002 pagelist doesn't break
        return Response.redirect(new URL("/skyline", url).href, 302);
      case "/skyline.png":
        return handleSkylinePng(env, url);
      case "/skyline":
        return handleSkylinePage(url);
      case "/skyline-bw":
        return skylineBwPageResponse();
      case "/skyline-test.png": {
        const authBlockST = checkTestAuth(url, env);
        if (authBlockST) return authBlockST;
        return handleSkylineTestPng(env, url);
      }
      case "/skyline-test": {
        const authBlockSTP = checkTestAuth(url, env);
        if (authBlockSTP) return authBlockSTP;
        return handleSkylineTestPage(url);
      }
      case "/health":
        return handleHealth();
      case "/health-detailed":
        return handleHealthDetailed(env);
      default:
        return jsonResponse(
          {
            error: "Not found",
            endpoints: [
              "/weather", "/fact", "/weather.json", "/fact.json", "/fact.png", "/fact1.png",
              "/color/weather", "/color/moment",
              "/skyline", "/skyline-bw", "/skyline.png",
              "/test-birthday.png", "/health", "/health-detailed",
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
