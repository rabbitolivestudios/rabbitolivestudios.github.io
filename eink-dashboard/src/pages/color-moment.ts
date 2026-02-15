/**
 * Color "Moment Before" page for reTerminal E1002 (Spectra 6).
 *
 * Generates an AI image dithered to the 6-color Spectra palette,
 * served as HTML with inline base64 PNG.
 *
 * Route: /color/moment
 * Test:  /color/test-moment?m=7&d=20
 */

import type { Env, MomentBeforeData } from "../types";
import { getChicagoDateParts } from "../date-utils";
import { getTodayEvents } from "../fact";
import { getOrGenerateMoment, generateMomentBefore } from "../moment";
import { getBirthdayToday } from "../birthday";
import { generateAndDecodeColorFlux, generateAndDecodeColor } from "../image-color";
import { ditherFloydSteinberg, posterizeRGB } from "../dither-spectra6";
import { SPECTRA6_PALETTE } from "../spectra6";
import { encodePNGIndexed } from "../png";
import { spectra6CSS } from "../spectra6";
import { WIDTH, HEIGHT } from "../image";

const COLOR_STYLE_PREFIX = "screen print poster, flat inks, bold shapes, iconic composition, high contrast, minimal shading, no gradients, ";
const ANTI_TEXT_SUFFIX = "no text, no words, no letters, no writing, no signage, no captions, no watermark";

/** Encode PNG bytes to base64 in chunks. */
function pngToBase64(png: Uint8Array): string {
  let binary = "";
  const CHUNK = 8192;
  for (let i = 0; i < png.length; i += CHUNK) {
    binary += String.fromCharCode(...png.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

/** Generate a color Spectra 6 moment image, returns base64 PNG. */
async function generateColorMoment(
  env: Env,
  moment: MomentBeforeData,
): Promise<string> {
  const prompt = `${COLOR_STYLE_PREFIX}${moment.imagePrompt}, ${ANTI_TEXT_SUFFIX}`;

  let rgb: Uint8Array | null = null;

  // Try FLUX.2 first (better color range)
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      rgb = await generateAndDecodeColorFlux(env, prompt);
      break;
    } catch (err) {
      console.error(`Color moment FLUX.2 attempt ${attempt + 1} failed:`, err);
    }
  }

  // Fallback to SDXL
  if (!rgb) {
    console.log("Color moment: FLUX.2 failed, falling back to SDXL");
    rgb = await generateAndDecodeColor(env, prompt);
  }

  // Dither to Spectra 6 palette
  const indices = ditherFloydSteinberg(rgb, WIDTH, HEIGHT, SPECTRA6_PALETTE);
  const png = await encodePNGIndexed(indices, WIDTH, HEIGHT, SPECTRA6_PALETTE);
  return pngToBase64(png);
}

/** Generate a color birthday portrait, returns base64 PNG. */
async function generateColorBirthday(
  env: Env,
  birthday: { name: string; key: string },
): Promise<string> {
  // Simplified color birthday: generate with FLUX.2, posterize, dither
  const prompt = `${COLOR_STYLE_PREFIX}portrait of a person named ${birthday.name}, celebratory, warm tones, ${ANTI_TEXT_SUFFIX}`;

  let rgb: Uint8Array;
  try {
    rgb = await generateAndDecodeColorFlux(env, prompt);
  } catch {
    rgb = await generateAndDecodeColor(env, prompt);
  }

  // Posterize before dithering for smoother result
  posterizeRGB(rgb, 8);
  const indices = ditherFloydSteinberg(rgb, WIDTH, HEIGHT, SPECTRA6_PALETTE);
  const png = await encodePNGIndexed(indices, WIDTH, HEIGHT, SPECTRA6_PALETTE);
  return pngToBase64(png);
}

function renderHTML(
  imageB64: string,
  moment: MomentBeforeData,
  displayDate: string,
  isBirthday: boolean = false,
): string {
  const caption = isBirthday
    ? `Happy Birthday!`
    : `${moment.location} | ${moment.title || moment.scene.slice(0, 40)} | ${displayDate}, ${moment.year}`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=800">
<title>Moment Before</title>
<style>
  :root { ${spectra6CSS()} }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    width: 800px; height: 480px; overflow: hidden;
    background: #fff; color: #000;
    font-family: -apple-system, "Helvetica Neue", Arial, sans-serif;
  }
  .image-container {
    width: 800px; height: 456px;
    overflow: hidden;
  }
  .image-container img {
    width: 800px; height: 456px;
    object-fit: cover;
    display: block;
  }
  .caption {
    width: 800px; height: 24px;
    background: #000; color: #fff;
    font-size: 14px; font-weight: 600;
    display: flex; align-items: center; justify-content: center;
    padding: 0 16px;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
</style>
</head>
<body>
  <div class="image-container">
    <img src="data:image/png;base64,${imageB64}" alt="Moment Before">
  </div>
  <div class="caption">${caption}</div>
</body>
</html>`;
}

export async function handleColorMomentPage(env: Env, url: URL): Promise<Response> {
  const { year, month, day, dateStr } = getChicagoDateParts();
  const monthNum = parseInt(month);
  const dayNum = parseInt(day);

  // Check KV cache
  const birthday = getBirthdayToday(monthNum, dayNum);
  const cacheKey = birthday ? `color-birthday:v1:${dateStr}` : `color-moment:v1:${dateStr}`;

  const cached = await env.CACHE.get(cacheKey);
  if (cached) {
    // Cached value is JSON: { imageB64, moment, displayDate, isBirthday }
    try {
      const data = JSON.parse(cached);
      const html = renderHTML(data.imageB64, data.moment, data.displayDate, data.isBirthday);
      return new Response(html, {
        headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "public, max-age=86400" },
      });
    } catch { /* cache corrupted, regenerate */ }
  }

  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const displayDate = `${months[monthNum - 1]} ${dayNum}`;

  let imageB64: string;
  let moment: MomentBeforeData;
  let isBirthday = false;

  if (birthday) {
    isBirthday = true;
    moment = { year: parseInt(year), location: "", title: birthday.name, scene: "", imagePrompt: "" };
    try {
      imageB64 = await generateColorBirthday(env, birthday);
    } catch (err) {
      console.error("Color birthday failed, falling back to moment:", err);
      isBirthday = false;
      const { events } = await getTodayEvents(env);
      moment = await getOrGenerateMoment(env, events, dateStr);
      imageB64 = await generateColorMoment(env, moment);
    }
  } else {
    const { events } = await getTodayEvents(env);
    moment = await getOrGenerateMoment(env, events, dateStr);
    imageB64 = await generateColorMoment(env, moment);
  }

  // Cache the result
  const cacheData = JSON.stringify({ imageB64, moment, displayDate, isBirthday });
  await env.CACHE.put(cacheKey, cacheData, { expirationTtl: 86400 });

  const html = renderHTML(imageB64, moment, displayDate, isBirthday);
  return new Response(html, {
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "public, max-age=86400" },
  });
}

/** Test endpoint for color moment with custom date. */
export async function handleColorTestMoment(env: Env, url: URL): Promise<Response> {
  const m = url.searchParams.get("m") ?? "7";
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
  const imageB64 = await generateColorMoment(env, moment);

  const html = renderHTML(imageB64, moment, displayDate);
  return new Response(html, {
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
  });
}
