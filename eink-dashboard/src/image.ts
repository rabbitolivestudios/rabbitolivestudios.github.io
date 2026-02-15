/**
 * "Moment Before" image pipeline.
 *
 * Two separate pipelines, each with a configurable AI model:
 *
 * Pipeline A (/fact.png — 4-level grayscale):
 *   AI model → grayscale → resize → caption → tone curve → quantize 4 levels
 *
 * Pipeline B (/fact1.png — true 1-bit):
 *   AI model → grayscale → resize → style-aware 1-bit (Bayer or threshold) → caption
 *
 * Output: 800 × 480 px, full-bleed image
 */

import { encodePNGGray8, encodePNG1Bit } from "./png";
import { decodePNG } from "./png-decode";
import { measureText } from "./font";
import { FONT_8X8 as FONT_DATA } from "./font";
import { applyToneCurve } from "./convert-1bit";
import { convert1Bit } from "./convert-1bit";
import { pick1BitStyle, findStyleByName, ANTI_TEXT_SUFFIX } from "./styles-1bit";
import type { Env, MomentBeforeData } from "./types";

export const WIDTH = 800;
export const HEIGHT = 480;

// SDXL generation params (Pipeline B + Pipeline A fallback)
const SDXL_STEPS = 20;
const SDXL_GUIDANCE = 7.0;
const SDXL_WIDTH = 1024;
const SDXL_HEIGHT = 768;

// Pipeline B (1-bit) params
const FACT1_STEPS = 20;       // Workers AI max
const FACT1_GUIDANCE = 6.5;

// FLUX.2 params (Pipeline A primary)
const FLUX_MODEL = "@cf/black-forest-labs/flux-2-klein-9b";
const FLUX_WIDTH = 1024;
const FLUX_HEIGHT = 768;

// --- Scene styles for daily rotation (Pipeline A) ---

const SCENE_STYLES = [
  {
    name: "Woodcut",
    prompt: "hand-carved woodcut print, bold U-gouge marks, high contrast black and white, sweeping curved gouge strokes, large solid black ink areas with minimal midtones",
  },
  {
    name: "Pencil Sketch",
    prompt: "detailed graphite pencil sketch, fine cross-hatching, full tonal range, on white paper",
  },
  {
    name: "Charcoal",
    prompt: "dramatic charcoal drawing, expressive strokes, deep shadows, textured paper",
  },
] as const;

/** Get the scene style for a given date string (YYYY-MM-DD, Chicago timezone). */
export function getSceneStyle(dateStr: string): typeof SCENE_STYLES[number] {
  const d = new Date(dateStr + "T12:00:00");
  const start = new Date(d.getFullYear(), 0, 1);
  const dayOfYear = Math.floor((d.getTime() - start.getTime()) / 86400000) + 1;
  return SCENE_STYLES[dayOfYear % SCENE_STYLES.length];
}

// --- AI image generation (SDXL) ---

const SDXL_MODEL = "@cf/stabilityai/stable-diffusion-xl-base-1.0";

async function generateAIImage(
  env: Env,
  prompt: string,
  steps: number = SDXL_STEPS,
  guidance: number = SDXL_GUIDANCE,
): Promise<Uint8Array> {
  const result: any = await env.AI.run(SDXL_MODEL as any, {
    prompt,
    num_steps: steps,
    guidance,
    width: SDXL_WIDTH,
    height: SDXL_HEIGHT,
  });

  if (result instanceof Uint8Array) return result;
  if (result instanceof ArrayBuffer) return new Uint8Array(result);
  if (result instanceof ReadableStream) {
    return new Uint8Array(await new Response(result).arrayBuffer());
  }
  if (typeof result === "object" && result !== null) {
    const img = result.image ?? result.images?.[0];
    if (img && typeof img === "string") {
      return Uint8Array.from(atob(img), (c) => c.charCodeAt(0));
    }
  }

  throw new Error(`Unexpected AI image response type: ${typeof result}`);
}

// --- AI image generation (FLUX.2 klein-9b) ---

async function generateFluxImage(env: Env, prompt: string): Promise<Uint8Array> {
  const form = new FormData();
  form.append("prompt", prompt);
  form.append("width", String(FLUX_WIDTH));
  form.append("height", String(FLUX_HEIGHT));
  form.append("guidance", "7.0");

  const formResponse = new Response(form);
  const formStream = formResponse.body;
  const formContentType = formResponse.headers.get("content-type")!;

  const result: any = await env.AI.run(FLUX_MODEL as any, {
    multipart: {
      body: formStream,
      contentType: formContentType,
    },
  });

  if (result && typeof result === "object") {
    const img = result.image ?? result.images?.[0];
    if (img && typeof img === "string") {
      return Uint8Array.from(atob(img), c => c.charCodeAt(0));
    }
  }
  if (result instanceof Uint8Array) return result;
  if (result instanceof ArrayBuffer) return new Uint8Array(result);
  if (result instanceof ReadableStream) {
    return new Uint8Array(await new Response(result).arrayBuffer());
  }

  throw new Error(`Unexpected FLUX.2 response type: ${typeof result}`);
}

// --- Bilinear resize (grayscale) ---

export function resizeGray(
  src: Uint8Array,
  srcW: number,
  srcH: number,
  dstW: number,
  dstH: number
): Uint8Array {
  const dst = new Uint8Array(dstW * dstH);
  const xRatio = srcW / dstW;
  const yRatio = srcH / dstH;

  for (let y = 0; y < dstH; y++) {
    const srcY = y * yRatio;
    const y0 = Math.floor(srcY);
    const y1 = Math.min(y0 + 1, srcH - 1);
    const fy = srcY - y0;

    for (let x = 0; x < dstW; x++) {
      const srcX = x * xRatio;
      const x0 = Math.floor(srcX);
      const x1 = Math.min(x0 + 1, srcW - 1);
      const fx = srcX - x0;

      const a = src[y0 * srcW + x0];
      const b = src[y0 * srcW + x1];
      const c = src[y1 * srcW + x0];
      const d = src[y1 * srcW + x1];

      const value = a * (1 - fx) * (1 - fy) + b * fx * (1 - fy) + c * (1 - fx) * fy + d * fx * fy;
      dst[y * dstW + x] = Math.round(value);
    }
  }
  return dst;
}

// --- Center-crop to target aspect ratio ---

export function centerCropGray(
  src: Uint8Array,
  srcW: number,
  srcH: number,
  targetW: number,
  targetH: number
): { gray: Uint8Array; width: number; height: number } {
  const srcAspect = srcW / srcH;
  const targetAspect = targetW / targetH;
  let cropW: number, cropH: number, offsetX: number, offsetY: number;

  if (srcAspect > targetAspect) {
    cropH = srcH;
    cropW = Math.round(srcH * targetAspect);
    offsetX = Math.floor((srcW - cropW) / 2);
    offsetY = 0;
  } else {
    cropW = srcW;
    cropH = Math.round(srcW / targetAspect);
    offsetX = 0;
    offsetY = Math.floor((srcH - cropH) / 2);
  }

  const dst = new Uint8Array(cropW * cropH);
  for (let y = 0; y < cropH; y++) {
    const srcOff = (y + offsetY) * srcW + offsetX;
    dst.set(src.subarray(srcOff, srcOff + cropW), y * cropW);
  }

  return { gray: dst, width: cropW, height: cropH };
}

// --- Text overlay (thin bottom caption bar) ---

const BAR_H = 24;
const BAR_PAD = 8;
const CAPTION_SCALE = 1;    // 8px bitmap font, small and subtle

export function drawText(
  buf: Uint8Array,
  x: number,
  y: number,
  text: string,
  scale: number,
  color: number
): void {
  const charWidth = 8 * scale;
  const spacing = scale;

  for (let i = 0; i < text.length; i++) {
    const cx = x + i * (charWidth + spacing);
    const code = text.charCodeAt(i);
    const idx = code - 32;
    if (idx < 0 || idx >= FONT_DATA.length) continue;
    const glyph = FONT_DATA[idx];
    for (let row = 0; row < 8; row++) {
      const byte = glyph[row];
      for (let col = 0; col < 8; col++) {
        if (byte & (0x80 >> col)) {
          for (let sy = 0; sy < scale; sy++) {
            for (let sx = 0; sx < scale; sx++) {
              const px = cx + col * scale + sx;
              const py = y + row * scale + sy;
              if (px >= 0 && px < WIDTH && py >= 0 && py < HEIGHT) {
                buf[py * WIDTH + px] = color;
              }
            }
          }
        }
      }
    }
  }
}

/**
 * Thin bottom bar: location (left) | title (center) | date (right).
 * Small 8px bitmap font, 24px bar height.
 */
function drawOverlayText(
  buf: Uint8Array,
  moment: MomentBeforeData,
  displayDate: string
): void {
  const barY = HEIGHT - BAR_H;
  const textH = 8 * CAPTION_SCALE;
  const textY = barY + Math.floor((BAR_H - textH) / 2);

  // Solid black bar
  for (let y = barY; y < HEIGHT; y++) {
    for (let x = 0; x < WIDTH; x++) {
      buf[y * WIDTH + x] = 0;
    }
  }

  // Left: location
  const location = moment.location.length > 35
    ? moment.location.slice(0, 32) + "..."
    : moment.location;
  drawText(buf, BAR_PAD, textY, location, CAPTION_SCALE, 255);

  // Right: date
  const dateLine = `${displayDate}, ${moment.year}`;
  const dateW = measureText(dateLine, CAPTION_SCALE);
  drawText(buf, WIDTH - BAR_PAD - dateW, textY, dateLine, CAPTION_SCALE, 255);

  // Center: title (centered in gap between location and date)
  const locW = measureText(location, CAPTION_SCALE);
  const locEnd = BAR_PAD + locW;
  const dateStart = WIDTH - BAR_PAD - dateW;
  const gap = 12;
  const availW = dateStart - locEnd - 2 * gap;
  let title = moment.title;
  if (title.length > 0 && availW > 0) {
    while (measureText(title, CAPTION_SCALE) > availW && title.length > 3) {
      title = title.slice(0, -1);
    }
    if (title.length < moment.title.length) title += "...";
    const titleW = measureText(title, CAPTION_SCALE);
    const titleX = locEnd + gap + Math.floor((availW - titleW) / 2);
    drawText(buf, titleX, textY, title, CAPTION_SCALE, 255);
  }
}

/**
 * Draw caption into 1-bit buffer: elegant white strip with black text.
 * 16px white strip at bottom, 8px black text centered vertically.
 */
const STRIP_H = 16;

function drawOverlayText1Bit(
  bits: Uint8Array,
  moment: MomentBeforeData,
  displayDate: string
): void {
  const stripY = HEIGHT - STRIP_H;
  const textH = 8; // CAPTION_SCALE=1
  const textY = stripY + Math.floor((STRIP_H - textH) / 2);

  // White strip background (1 = white)
  for (let y = stripY; y < HEIGHT; y++) {
    for (let x = 0; x < WIDTH; x++) {
      bits[y * WIDTH + x] = 1;
    }
  }

  // Helper: draw text into 1-bit buffer
  const draw1Bit = (x: number, y: number, text: string, val: number) => {
    for (let i = 0; i < text.length; i++) {
      const cx = x + i * 9; // 8px char + 1px spacing
      const code = text.charCodeAt(i);
      const idx = code - 32;
      if (idx < 0 || idx >= FONT_DATA.length) continue;
      const glyph = FONT_DATA[idx];
      for (let row = 0; row < 8; row++) {
        const byte = glyph[row];
        for (let col = 0; col < 8; col++) {
          if (byte & (0x80 >> col)) {
            const px = cx + col;
            const py = y + row;
            if (px >= 0 && px < WIDTH && py >= 0 && py < HEIGHT) {
              bits[py * WIDTH + px] = val;
            }
          }
        }
      }
    }
  };

  // Left: location (black text on white strip)
  const location = moment.location.length > 35
    ? moment.location.slice(0, 32) + "..."
    : moment.location;
  draw1Bit(BAR_PAD, textY, location, 0);

  // Right: date
  const dateLine = `${displayDate}, ${moment.year}`;
  const dateW = measureText(dateLine, CAPTION_SCALE);
  draw1Bit(WIDTH - BAR_PAD - dateW, textY, dateLine, 0);

  // Center: title (centered in gap between location and date)
  const locW = measureText(location, CAPTION_SCALE);
  const locEnd = BAR_PAD + locW;
  const dateStart = WIDTH - BAR_PAD - dateW;
  const gap = 12;
  const availW = dateStart - locEnd - 2 * gap;
  let title = moment.title;
  if (title.length > 0 && availW > 0) {
    while (measureText(title, CAPTION_SCALE) > availW && title.length > 3) {
      title = title.slice(0, -1);
    }
    if (title.length < moment.title.length) title += "...";
    const titleW = measureText(title, CAPTION_SCALE);
    const titleX = locEnd + gap + Math.floor((availW - titleW) / 2);
    draw1Bit(titleX, textY, title, 0);
  }
}

// --- Debug: return raw AI image before processing ---

export async function generateMomentImageRaw(
  env: Env,
  moment: MomentBeforeData,
): Promise<Uint8Array> {
  return generateAIImage(env, moment.imagePrompt);
}

// --- 4-level quantization (no dithering) ---

export function quantize4Level(gray: Uint8Array): void {
  for (let i = 0; i < gray.length; i++) {
    const v = gray[i];
    if (v < 64) gray[i] = 0;
    else if (v < 128) gray[i] = 85;
    else if (v < 192) gray[i] = 170;
    else gray[i] = 255;
  }
}

// --- Common: AI model → grayscale → crop → resize ---

async function generateAndDecodeGray(
  env: Env,
  prompt: string,
  steps: number = SDXL_STEPS,
  guidance: number = SDXL_GUIDANCE,
): Promise<Uint8Array> {
  // 1. Generate image (returns JPEG)
  const jpegBytes = await generateAIImage(env, prompt, steps, guidance);

  // 2. Convert JPEG → PNG via Cloudflare Images, then decode to grayscale
  const pngResponse = (await env.IMAGES.input(jpegBytes).output({ format: "image/png" })).response();
  const pngBytes = new Uint8Array(await pngResponse.arrayBuffer());
  const decoded = await decodePNG(pngBytes);

  // 3. Center-crop to 800:480 aspect ratio, then resize
  const cropped = centerCropGray(decoded.gray, decoded.width, decoded.height, WIDTH, HEIGHT);
  return (cropped.width === WIDTH && cropped.height === HEIGHT)
    ? cropped.gray
    : resizeGray(cropped.gray, cropped.width, cropped.height, WIDTH, HEIGHT);
}

// --- FLUX.2 decode helper ---

async function generateAndDecodeGrayFlux(
  env: Env,
  prompt: string,
): Promise<Uint8Array> {
  const jpegBytes = await generateFluxImage(env, prompt);

  const pngResponse = (await env.IMAGES.input(jpegBytes).output({ format: "image/png" })).response();
  const pngBytes = new Uint8Array(await pngResponse.arrayBuffer());
  const decoded = await decodePNG(pngBytes);

  const cropped = centerCropGray(decoded.gray, decoded.width, decoded.height, WIDTH, HEIGHT);
  return (cropped.width === WIDTH && cropped.height === HEIGHT)
    ? cropped.gray
    : resizeGray(cropped.gray, cropped.width, cropped.height, WIDTH, HEIGHT);
}

// --- Pipeline A: 4-level grayscale (/fact.png) ---
// Uses FLUX.2 klein-9b with daily style rotation, SDXL fallback.

export async function generateMomentImage(
  env: Env,
  moment: MomentBeforeData,
  displayDate: string,
  dateStr: string,
): Promise<Uint8Array> {
  const style = getSceneStyle(dateStr);
  const styledPrompt = `${style.prompt}, ${moment.imagePrompt}, no text, no words, no letters, no writing`;
  console.log(`Pipeline A: using ${style.name} style with FLUX.2`);

  let gray: Uint8Array | null = null;

  // Try FLUX.2 (retry once on failure)
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      gray = await generateAndDecodeGrayFlux(env, styledPrompt);
      break;
    } catch (err) {
      console.error(`Pipeline A FLUX.2 attempt ${attempt + 1} failed:`, err);
      if (attempt === 0) continue;
    }
  }

  // Fallback to SDXL with woodcut style
  if (!gray) {
    console.log("Pipeline A: FLUX.2 failed, falling back to SDXL");
    const woodcutStyle = findStyleByName("woodcut");
    const fallbackPrompt = `${woodcutStyle.prompt}, ${moment.imagePrompt}, ${ANTI_TEXT_SUFFIX}`;
    gray = await generateAndDecodeGray(env, fallbackPrompt);
  }

  // Caption bar (before tone curve so text stays clean)
  drawOverlayText(gray, moment, displayDate);

  // Gentle tone curve
  applyToneCurve(gray, 1.2, 0.95);

  // Quantize to exactly 4 levels, no dithering
  quantize4Level(gray);

  return encodePNGGray8(gray, WIDTH, HEIGHT);
}

// --- Pipeline B: style-aware 1-bit (/fact1.png) ---
// SDXL → grayscale → style-aware 1-bit conversion (Bayer or threshold) → caption.

export async function generateMomentImage1Bit(
  env: Env,
  moment: MomentBeforeData,
  displayDate: string,
  dateStr: string,
  forceStyle?: string,
): Promise<Uint8Array> {
  // 1. Pick style (deterministic by date+event, or forced for testing)
  const spec = forceStyle ? findStyleByName(forceStyle) : pick1BitStyle(dateStr, moment);

  // 2. Build prompt: style + scene + anti-text
  const prompt = `${spec.prompt}, ${moment.imagePrompt}, ${ANTI_TEXT_SUFFIX}`;

  // 3. Generate → grayscale → crop → resize (SDXL)
  const gray = await generateAndDecodeGray(env, prompt, FACT1_STEPS, FACT1_GUIDANCE);

  // 4. Style-aware 1-bit conversion (with stabilization + guardrail)
  const { bits, blackRatio, styleName } = convert1Bit(gray, WIDTH, HEIGHT, spec);

  // 5. Caption drawn AFTER conversion so text stays crisp
  drawOverlayText1Bit(bits, moment, displayDate);

  console.log(`Pipeline B: ${styleName} (${spec.mode}), blackRatio=${blackRatio.toFixed(3)}`);

  return encodePNG1Bit(bits, WIDTH, HEIGHT);
}
