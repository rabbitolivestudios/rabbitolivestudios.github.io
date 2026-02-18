/**
 * Color "Moment Before" page for reTerminal E1002 (Spectra 6).
 *
 * Generates an AI image dithered to the 6-color Spectra palette,
 * served as HTML with inline base64 PNG.
 *
 * Route: /color/moment
 * Test:  /color/test-moment?m=7&d=20
 */

import { fetchWithTimeout } from "../fetch-timeout";
import type { Env, MomentBeforeData } from "../types";
import { getChicagoDateParts } from "../date-utils";
import { getTodayEvents } from "../fact";
import { getOrGenerateMoment, generateMomentBefore } from "../moment";
import { getBirthdayToday, getBirthdayByKey, getArtStyle } from "../birthday";
import type { BirthdayPerson } from "../birthday";
import { callFluxPortrait, fetchReferencePhotos, ageDescription } from "../birthday-image";
import { generateAndDecodeColorFlux, generateAndDecodeColor, centerCropRGB, resizeRGB } from "../image-color";
import { decodePNG } from "../png-decode";
import { ditherFloydSteinberg } from "../dither-spectra6";
import { SPECTRA6_PALETTE } from "../spectra6";
import { encodePNGIndexed } from "../png";
import { spectra6CSS } from "../spectra6";
import { WIDTH, HEIGHT } from "../image";
import { escapeHTML } from "../escape";
import { htmlResponse } from "../response";
import { parseMonth, parseDay, parseStyleIdx } from "../validate";

const ANTI_TEXT_SUFFIX = "no text, no words, no letters, no writing, no signage, no captions, no watermark";

/** Art styles optimized for 6-color Floyd-Steinberg dithering on Spectra 6 display. */
export const COLOR_MOMENT_STYLES = [
  {
    id: "gouache",
    name: "Gouache",
    prompt: "gouache painting, opaque matte pigment, bold flat color fields, visible brush strokes, thick paint application",
  },
  {
    id: "oil_painting",
    name: "Oil Painting",
    prompt: "oil painting on canvas, rich saturated colors, visible impasto brush strokes, dramatic lighting, painterly realism",
  },
  {
    id: "graphic_novel",
    name: "Graphic Novel",
    prompt: "graphic novel panel illustration, bold ink outlines, flat color fills, cel-shaded, high contrast, comic book art",
  },
  {
    id: "ink_wash",
    name: "Ink + Wash",
    prompt: "ink and watercolor wash illustration, black ink outlines with transparent color washes, loose brushwork, visible paper texture",
  },
  {
    id: "woodblock",
    name: "Color Woodblock",
    prompt: "Japanese woodblock print, ukiyo-e style, bold flat color areas, black key block outlines, hand-carved texture, limited color palette",
  },
] as const;

const COLOR_PALETTE_SUFFIX = "limited palette, large flat color regions, bold saturated reds blues yellows greens, no gradients, avoid tiny details, high contrast";

/** Get the color moment style for a given Chicago-timezone date string. */
export function getColorMomentStyle(dateStr: string): typeof COLOR_MOMENT_STYLES[number] {
  const d = new Date(dateStr + "T12:00:00Z");
  const start = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const dayOfYear = Math.floor((d.getTime() - start.getTime()) / 86400000) + 1;
  return COLOR_MOMENT_STYLES[(dayOfYear - 1) % COLOR_MOMENT_STYLES.length];
}

/** Encode PNG bytes to base64 in chunks. */
function pngToBase64(png: Uint8Array): string {
  let binary = "";
  const CHUNK = 8192;
  for (let i = 0; i < png.length; i += CHUNK) {
    binary += String.fromCharCode(...png.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

/** Generate a color Spectra 6 moment image, returns base64 PNG + styleId. */
export async function generateColorMoment(
  env: Env,
  moment: MomentBeforeData,
  dateStr: string,
  forceStyleId?: string,
): Promise<{ base64: string; styleId: string }> {
  const style = forceStyleId
    ? (COLOR_MOMENT_STYLES.find(s => s.id === forceStyleId) ?? getColorMomentStyle(dateStr))
    : getColorMomentStyle(dateStr);
  console.log(`Color moment style: ${style.name} (${style.id})`);
  const prompt = `${style.prompt}, ${moment.imagePrompt}, ${COLOR_PALETTE_SUFFIX}, ${ANTI_TEXT_SUFFIX}`;

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
  return { base64: pngToBase64(png), styleId: style.id };
}

/** Decode JPEG bytes to 800x480 RGB via Cloudflare Images. */
async function jpegToRGB(env: Env, jpegBytes: Uint8Array): Promise<Uint8Array> {
  const pngResponse = (await env.IMAGES.input(jpegBytes).output({ format: "image/png" })).response();
  const pngBytes = new Uint8Array(await pngResponse.arrayBuffer());
  const decoded = await decodePNG(pngBytes);
  if (!decoded.rgb) throw new Error("Expected color PNG but got grayscale");
  const cropped = centerCropRGB(decoded.rgb, decoded.width, decoded.height, WIDTH, HEIGHT);
  return (cropped.width === WIDTH && cropped.height === HEIGHT)
    ? cropped.rgb
    : resizeRGB(cropped.rgb, cropped.width, cropped.height, WIDTH, HEIGHT);
}

/** Generate a color birthday portrait, returns base64 PNG. */
async function generateColorBirthday(
  env: Env,
  person: BirthdayPerson,
  currentYear: number,
  styleOverride?: number,
): Promise<string> {
  const style = styleOverride !== undefined
    ? getArtStyle(2020 + styleOverride)
    : getArtStyle(currentYear);

  const photos = await fetchReferencePhotos(env, person.key);
  console.log(`Color birthday: found ${photos.length} reference photo(s) for ${person.key}`);

  // Try FLUX.2 with reference photos (2 attempts)
  let rgb: Uint8Array | null = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const jpegBytes = await callFluxPortrait(env, person, style.prompt, photos, currentYear);
      rgb = await jpegToRGB(env, jpegBytes);
      break;
    } catch (err) {
      console.error(`Color birthday FLUX.2 attempt ${attempt + 1} failed:`, err);
    }
  }

  // Fallback: SDXL with text-only prompt (no reference photos — API limitation)
  if (!rgb) {
    console.log("Color birthday: FLUX.2 failed, falling back to SDXL");
    const ageLine = ageDescription(person, currentYear);
    const prompt = `artistic portrait of ${ageLine}, ${style.prompt}, head and shoulders, centered composition, looking at viewer, smiling, ${ANTI_TEXT_SUFFIX}`;
    rgb = await generateAndDecodeColor(env, prompt);
  }

  // Dither to Spectra 6 palette
  const indices = ditherFloydSteinberg(rgb, WIDTH, HEIGHT, SPECTRA6_PALETTE);
  const png = await encodePNGIndexed(indices, WIDTH, HEIGHT, SPECTRA6_PALETTE);
  return pngToBase64(png);
}

interface BirthdayCaptionInfo {
  name: string;
  age: number;
  styleName: string;
}

function renderHTML(
  imageB64: string,
  moment: MomentBeforeData,
  displayDate: string,
  birthdayInfo?: BirthdayCaptionInfo,
): string {
  let captionHTML: string;
  if (birthdayInfo) {
    // Match E1001: "Happy Birthday!" left | "Name - age years" center | style right
    captionHTML = `<span class="cap-left">Happy Birthday!</span><span class="cap-center">${escapeHTML(birthdayInfo.name)} - ${birthdayInfo.age} years</span><span class="cap-right">${escapeHTML(birthdayInfo.styleName)}</span>`;
  } else {
    const location = moment.location.length > 35
      ? moment.location.slice(0, 32) + "..."
      : moment.location;
    const title = moment.title || moment.scene.slice(0, 40);
    const dateLine = `${displayDate}, ${moment.year}`;
    captionHTML = `<span class="cap-left">${escapeHTML(location)}</span><span class="cap-center">${escapeHTML(title)}</span><span class="cap-right">${dateLine}</span>`;
  }

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
    display: flex; align-items: center;
    padding: 0 12px;
    overflow: hidden;
    white-space: nowrap;
  }
  .cap-left { flex-shrink: 0; }
  .cap-center {
    flex: 1; text-align: center;
    overflow: hidden; text-overflow: ellipsis;
  }
  .cap-right { flex-shrink: 0; }
</style>
</head>
<body>
  <div class="image-container">
    <img src="data:image/png;base64,${imageB64}" alt="Moment Before">
  </div>
  <div class="caption">${captionHTML}</div>
</body>
</html>`;
}

export async function handleColorMomentPage(env: Env, url: URL): Promise<Response> {
  const { year, month, day, dateStr } = getChicagoDateParts();
  const monthNum = parseInt(month);
  const dayNum = parseInt(day);

  // Check KV cache
  const birthday = getBirthdayToday(monthNum, dayNum);
  const colorStyle = getColorMomentStyle(dateStr);
  const cacheKey = birthday ? `color-birthday:v1:${dateStr}` : `color-moment:v2:${dateStr}:${colorStyle.id}`;

  const cached = await env.CACHE.get(cacheKey);
  if (cached) {
    console.log(`color/moment: cache hit (${cacheKey})`);
    try {
      const data = JSON.parse(cached);
      const html = renderHTML(data.imageB64, data.moment, data.displayDate, data.birthdayInfo);
      return htmlResponse(html, "public, max-age=86400");
    } catch { /* cache corrupted, regenerate */ }
  }

  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const displayDate = `${months[monthNum - 1]} ${dayNum}`;
  const currentYear = parseInt(year);

  let imageB64: string;
  let moment: MomentBeforeData;
  let birthdayInfo: BirthdayCaptionInfo | undefined;

  if (birthday) {
    const age = currentYear - birthday.birthYear;
    const style = getArtStyle(currentYear);
    moment = { year: currentYear, location: "", title: birthday.name, scene: "", imagePrompt: "" };
    try {
      imageB64 = await generateColorBirthday(env, birthday, currentYear);
      birthdayInfo = { name: birthday.name, age, styleName: style.name };
    } catch (err) {
      console.error("Color birthday failed, falling back to moment:", err);
      const { events } = await getTodayEvents(env);
      moment = await getOrGenerateMoment(env, events, dateStr);
      const result = await generateColorMoment(env, moment, dateStr);
      imageB64 = result.base64;
    }
  } else {
    const { events } = await getTodayEvents(env);
    moment = await getOrGenerateMoment(env, events, dateStr);
    const result = await generateColorMoment(env, moment, dateStr);
    imageB64 = result.base64;
  }

  // Cache the result
  const cacheData = JSON.stringify({ imageB64, moment, displayDate, birthdayInfo });
  await env.CACHE.put(cacheKey, cacheData, { expirationTtl: 604800 });

  const html = renderHTML(imageB64, moment, displayDate, birthdayInfo);
  return htmlResponse(html, "public, max-age=86400");
}

/** Test endpoint for color moment with custom date. */
export async function handleColorTestMoment(env: Env, url: URL): Promise<Response> {
  const m = parseMonth(url.searchParams.get("m") ?? "7");
  const d = parseDay(url.searchParams.get("d") ?? "20");
  const forceStyle = url.searchParams.get("style") ?? undefined;
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
  const result = await generateColorMoment(env, moment, testDateStr, forceStyle);

  const html = renderHTML(result.base64, moment, displayDate);
  return htmlResponse(html, "no-store");
}

/** Test endpoint for color birthday portrait. */
export async function handleColorTestBirthday(env: Env, url: URL): Promise<Response> {
  const nameParam = url.searchParams.get("name") ?? "thiago";
  const person = getBirthdayByKey(nameParam);
  if (!person) {
    const safeName = nameParam.slice(0, 50).replace(/[^\w-]/g, "");
    return new Response(`Unknown person key: ${safeName}`, {
      status: 400,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }
  const styleParam = url.searchParams.get("style");
  const styleIdx = parseStyleIdx(styleParam);
  const currentYear = new Date().getFullYear();

  try {
    const style = styleIdx !== undefined ? getArtStyle(2020 + styleIdx) : getArtStyle(currentYear);
    const age = currentYear - person.birthYear;
    const imageB64 = await generateColorBirthday(env, person, currentYear, styleIdx);
    const moment: MomentBeforeData = { year: currentYear, location: "", title: person.name, scene: "", imagePrompt: "" };
    const birthdayInfo: BirthdayCaptionInfo = { name: person.name, age, styleName: style.name };
    const html = renderHTML(imageB64, moment, "Birthday", birthdayInfo);
    return htmlResponse(html, "no-store");
  } catch (err) {
    console.error("Color test birthday error:", err);
    return new Response("Failed to generate color birthday image", { status: 503 });
  }
}
