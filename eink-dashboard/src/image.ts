/**
 * "Moment Before" image pipeline.
 *
 * Two separate pipelines, each with a configurable AI model:
 *
 * Pipeline A (/fact.png — 4-level grayscale):
 *   AI model → grayscale → resize → caption → tone curve → quantize 4 levels
 *
 * Pipeline B (/fact1.png — true 1-bit):
 *   AI model → grayscale → resize → caption → tone curve → threshold → despeckle
 *
 * Output: 800 × 480 px, full-bleed image
 */

import { encodePNGGray8, encodePNG1Bit } from "./png";
import { decodePNG } from "./png-decode";
import { measureText } from "./font";
import { FONT_8X8 as FONT_DATA } from "./font";
import type { Env, MomentBeforeData } from "./types";

const WIDTH = 800;
const HEIGHT = 480;

// /fact.png generation params (DO NOT CHANGE)
const SDXL_STEPS = 20;
const SDXL_GUIDANCE = 7.0;
const SDXL_WIDTH = 1024;
const SDXL_HEIGHT = 768;

// ====================================================================
// /fact1.png — Artist-interpretation 1-bit pipeline
// ====================================================================
const FACT1_STEPS = 20;       // Workers AI max
const FACT1_GUIDANCE = 6.5;

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

// --- Bilinear resize (grayscale) ---

function resizeGray(
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

function centerCropGray(
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

function drawText(
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

// --- Tone curve ---

function applyToneCurve(gray: Uint8Array, contrast: number, gamma: number): void {
  for (let i = 0; i < gray.length; i++) {
    let x = (gray[i] - 128) * contrast + 128;
    if (x < 0) x = 0;
    if (x > 255) x = 255;
    x = 255 * Math.pow(x / 255, gamma);
    gray[i] = Math.round(x < 0 ? 0 : x > 255 ? 255 : x);
  }
}

// --- 4-level quantization (no dithering) ---

function quantize4Level(gray: Uint8Array): void {
  for (let i = 0; i < gray.length; i++) {
    const v = gray[i];
    if (v < 64) gray[i] = 0;
    else if (v < 128) gray[i] = 85;
    else if (v < 192) gray[i] = 170;
    else gray[i] = 255;
  }
}

// --- 8×8 Bayer ordered dithering: stable dotted tonal texture for e-ink ---

const FACT1_DITHER_MODE = "bayer8";

// Classic 8×8 Bayer threshold matrix (values 0–63)
const BAYER8 = [
   0, 32,  8, 40,  2, 34, 10, 42,
  48, 16, 56, 24, 50, 18, 58, 26,
  12, 44,  4, 36, 14, 46,  6, 38,
  60, 28, 52, 20, 62, 30, 54, 22,
   3, 35, 11, 43,  1, 33,  9, 41,
  51, 19, 59, 27, 49, 17, 57, 25,
  15, 47,  7, 39, 13, 45,  5, 37,
  63, 31, 55, 23, 61, 29, 53, 21,
];

// Pre-compute normalized thresholds (0–255 range)
const BAYER8_NORM = BAYER8.map(v => (v / 64) * 255);

function bayerDither8x8(gray: Uint8Array, w: number, h: number): Uint8Array {
  const bits = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const row = (y & 7) << 3; // (y % 8) * 8
    for (let x = 0; x < w; x++) {
      const threshold = BAYER8_NORM[row + (x & 7)];
      bits[y * w + x] = gray[y * w + x] > threshold ? 1 : 0;
    }
  }
  return bits;
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

// --- Pipeline A: 4-level grayscale (/fact.png) ---

export async function generateMomentImage(
  env: Env,
  moment: MomentBeforeData,
  displayDate: string
): Promise<Uint8Array> {
  const gray = await generateAndDecodeGray(env, moment.imagePrompt);

  // Caption bar (before tone curve so text stays clean)
  drawOverlayText(gray, moment, displayDate);

  // Gentle tone curve
  applyToneCurve(gray, 1.2, 0.95);

  // Quantize to exactly 4 levels, no dithering
  quantize4Level(gray);

  return encodePNGGray8(gray, WIDTH, HEIGHT);
}

// --- Pipeline B: 1-bit Bayer dithered (/fact1.png) ---
// Same image generation as 4-level → tone adjust → 8×8 Bayer dithering → caption.

export async function generateMomentImage1Bit(
  env: Env,
  moment: MomentBeforeData,
  displayDate: string,
): Promise<Uint8Array> {
  // 1. Generate → grayscale → crop → resize (same prompt as 4-level)
  const gray = await generateAndDecodeGray(env, moment.imagePrompt, FACT1_STEPS, FACT1_GUIDANCE);

  // 2. Tone adjustment to preserve midtones for dithering
  applyToneCurve(gray, 1.20, 0.92);

  // 3. 8×8 Bayer ordered dithering → 1-bit
  const bits = bayerDither8x8(gray, WIDTH, HEIGHT);

  // 4. Caption drawn AFTER dithering so text stays crisp
  drawOverlayText1Bit(bits, moment, displayDate);

  return encodePNG1Bit(bits, WIDTH, HEIGHT);
}
