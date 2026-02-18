/**
 * NASA Astronomy Picture of the Day (APOD) fetcher.
 *
 * Fetches metadata and processes images for the Spectra 6 color display.
 * API key stored as Cloudflare Worker secret (APOD_API_KEY).
 */

import { fetchWithTimeout } from "./fetch-timeout";
import type { Env, APODData, CachedValue } from "./types";
import { decodePNG } from "./png-decode";
import { centerCropRGB, resizeRGB } from "./image-color";
import { ditherFloydSteinberg } from "./dither-spectra6";
import { SPECTRA6_PALETTE } from "./spectra6";
import { encodePNGIndexed, pngToBase64 } from "./png";
import { WIDTH, HEIGHT } from "./image";

const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Fetch APOD metadata for a given date.
 * Returns null on failure (graceful degradation).
 */
export async function getAPODData(env: Env, dateStr: string): Promise<APODData | null> {
  const cacheKey = `apod:v1:${dateStr}`;

  const cached = await env.CACHE.get<CachedValue<APODData>>(cacheKey, "json");
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    console.log("APOD: cache hit");
    return cached.data;
  }

  const apiKey = env.APOD_API_KEY || "DEMO_KEY";
  if (!env.APOD_API_KEY) {
    console.warn("APOD: no API key configured, using DEMO_KEY (rate-limited)");
  }

  try {
    const res = await fetchWithTimeout(
      `https://api.nasa.gov/planetary/apod?api_key=${apiKey}&date=${dateStr}`,
      { headers: { "User-Agent": "eink-dashboard/3.5 (Cloudflare Worker)" } },
    );

    if (!res.ok) {
      console.error(`APOD API returned ${res.status}`);
      return cached?.data ?? null;
    }

    const data: any = await res.json();
    const apod: APODData = {
      title: data.title ?? "Astronomy Picture of the Day",
      explanation: data.explanation ?? "",
      url: data.url ?? "",
      hdurl: data.hdurl,
      media_type: data.media_type ?? "image",
      date: data.date ?? dateStr,
      copyright: data.copyright,
      thumbnail_url: data.thumbnail_url,
    };

    await env.CACHE.put(cacheKey, JSON.stringify({ data: apod, timestamp: Date.now() }), { expirationTtl: 604800 });
    return apod;
  } catch (err) {
    console.error("APOD fetch error:", err);
    return cached?.data ?? null;
  }
}

/**
 * Get APOD image processed for Spectra 6 display.
 * Returns base64-encoded palette-indexed PNG, or null on failure.
 */
export async function getAPODColorImage(env: Env, dateStr: string): Promise<string | null> {
  const cacheKey = `apod-color:v1:${dateStr}`;

  const cached = await env.CACHE.get(cacheKey);
  if (cached) {
    console.log("APOD color: cache hit");
    return cached;
  }

  const apod = await getAPODData(env, dateStr);
  if (!apod || apod.media_type !== "image" || !apod.url) return null;

  try {
    // Use HD URL if available, fall back to regular URL
    const imageUrl = apod.hdurl || apod.url;
    const imgRes = await fetchWithTimeout(imageUrl, {
      headers: { "User-Agent": "eink-dashboard/3.5 (Cloudflare Worker)" },
    }, 15000);
    if (!imgRes.ok) throw new Error(`Image fetch returned ${imgRes.status}`);

    const imgBytes = new Uint8Array(await imgRes.arrayBuffer());

    // Convert to PNG via Cloudflare Images (handles JPEG, WebP, etc.)
    const pngResponse = (await env.IMAGES.input(imgBytes).output({ format: "image/png" })).response();
    const pngBytes = new Uint8Array(await pngResponse.arrayBuffer());
    const decoded = await decodePNG(pngBytes);

    if (!decoded.rgb) throw new Error("Expected color image");

    // Center-crop and resize to 800x480
    const cropped = centerCropRGB(decoded.rgb, decoded.width, decoded.height, WIDTH, HEIGHT);
    const rgb = (cropped.width === WIDTH && cropped.height === HEIGHT)
      ? cropped.rgb
      : resizeRGB(cropped.rgb, cropped.width, cropped.height, WIDTH, HEIGHT);

    // Dither to Spectra 6 palette
    const indices = ditherFloydSteinberg(rgb, WIDTH, HEIGHT, SPECTRA6_PALETTE);

    // Encode as palette-indexed PNG
    const png = await encodePNGIndexed(indices, WIDTH, HEIGHT, SPECTRA6_PALETTE);
    const b64 = pngToBase64(png);

    await env.CACHE.put(cacheKey, b64, { expirationTtl: 604800 });
    return b64;
  } catch (err) {
    console.error("APOD color image error:", err);
    return null;
  }
}
