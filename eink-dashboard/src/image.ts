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
const FACT1_USE_MEDIAN = false; // toggle: median filter before threshold

// --- 1-bit style rotation (one per day, event-aware seed) ---

const STYLES_1BIT = [
  {
    name: "woodcut",
    prompt: "dramatic woodcut engraving, carved black ink, bold shadows, strong skyline silhouettes, thick lines, minimal gray",
  },
  {
    name: "scratchboard",
    prompt: "scratchboard illustration, black surface with white carved lines, high contrast, detailed but clean, no gradients",
  },
  {
    name: "linocut",
    prompt: "linocut print poster style, bold shapes, minimal detail, strong composition, thick ink blocks",
  },
  {
    name: "pen_ink",
    prompt: "black and white pen and ink illustration, architectural drawing, clean lines, minimal shading, white paper background",
  },
  {
    name: "silhouette",
    prompt: "bold silhouette composition, black skyline against white sky, minimal detail, dramatic shapes",
  },
] as const;

/** Pick a stable style for the day, seeded by date + event info. */
function pickOneBitStyle(dateStr: string, title: string, location: string): typeof STYLES_1BIT[number] {
  const seed = `${dateStr}|${title}|${location}`;
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = ((hash << 5) - hash + seed.charCodeAt(i)) | 0;
  }
  const idx = Math.abs(hash) % STYLES_1BIT.length;
  return STYLES_1BIT[idx];
}

/** Assemble the final SDXL prompt: style + negatives + scene. */
function buildOneBitPrompt(style: string, scene: string): string {
  return (
    `${style}. ` +
    `Black and white illustration only. ` +
    `Flat clean white background. Ink drawing. ` +
    `No photorealism. No grayscale painting. No watercolor. No gradients. No color. ` +
    `No texture, no grain, no paper noise. No halftone, no stippling, no dots. ` +
    `Minimal background detail. ` +
    `Scene: ${scene}`
  );
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

// --- 3x3 median filter: removes grid/banding artifacts, preserves real edges ---

function medianFilter3x3(gray: Uint8Array, w: number, h: number): void {
  const src = new Uint8Array(gray);
  const buf = new Uint8Array(9);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      let k = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          buf[k++] = src[(y + dy) * w + (x + dx)];
        }
      }
      // Insertion sort for 9 elements
      for (let i = 1; i < 9; i++) {
        const v = buf[i];
        let j = i - 1;
        while (j >= 0 && buf[j] > v) { buf[j + 1] = buf[j]; j--; }
        buf[j + 1] = v;
      }
      gray[y * w + x] = buf[4]; // median
    }
  }
}

// --- Auto-threshold: target blackRatio 0.12–0.28, adjust ±10, max 3 tries ---

function autoThreshold(gray: Uint8Array, startThresh: number = 200): { bits: Uint8Array; threshold: number; blackRatio: number } {
  const total = gray.length;
  const TARGET_LOW = 0.12;
  const TARGET_HIGH = 0.28;
  let thresh = startThresh;

  for (let iter = 0; iter < 8; iter++) {
    let blackCount = 0;
    for (let i = 0; i < total; i++) {
      if (gray[i] < thresh) blackCount++;
    }
    const ratio = blackCount / total;

    if (ratio >= TARGET_LOW && ratio <= TARGET_HIGH) {
      // Good range — produce final bits
      const bits = new Uint8Array(total);
      for (let i = 0; i < total; i++) {
        bits[i] = gray[i] < thresh ? 0 : 1;
      }
      return { bits, threshold: thresh, blackRatio: ratio };
    }

    // gray[i] < thresh → black, so:
    // Too dark → LOWER threshold (fewer pixels qualify as black)
    // Too light → RAISE threshold (more pixels qualify as black)
    // Step proportional to how far off we are
    if (ratio > TARGET_HIGH) {
      thresh -= Math.max(10, Math.round((ratio - TARGET_HIGH) * 200));
    } else {
      thresh += Math.max(10, Math.round((TARGET_LOW - ratio) * 200));
    }

    // Clamp
    if (thresh < 80) thresh = 80;
    if (thresh > 250) thresh = 250;
  }

  // After 3 iterations, use whatever we have
  let blackCount = 0;
  const bits = new Uint8Array(total);
  for (let i = 0; i < total; i++) {
    if (gray[i] < thresh) { bits[i] = 0; blackCount++; }
    else { bits[i] = 1; }
  }
  return { bits, threshold: thresh, blackRatio: blackCount / total };
}

// --- Symmetric despeckle: remove isolated black pixels AND white holes ---

function despeckle1Bit(pixels01: Uint8Array, w: number, h: number): void {
  const copy = new Uint8Array(pixels01);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const val = copy[i];
      let blackNeighbors = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          if (copy[(y + dy) * w + (x + dx)] === 0) blackNeighbors++;
        }
      }
      // Isolated black pixel (<=1 black neighbor) → flip to white
      if (val === 0 && blackNeighbors <= 1) pixels01[i] = 1;
      // Isolated white hole (>=7 black neighbors) → fill black
      if (val === 1 && blackNeighbors >= 7) pixels01[i] = 0;
    }
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

// --- Pipeline B: Artist-interpretation 1-bit (/fact1.png) ---
// Style-injected prompt → SDXL → grayscale → auto-threshold → despeckle → 1-bit.

export async function generateMomentImage1Bit(
  env: Env,
  moment: MomentBeforeData,
  displayDate: string,
  dateStr: string
): Promise<Uint8Array> {
  // 1. Use the same rich woodcut prompt from the LLM (proven to produce great scenes)
  //    The 1-bit conversion happens via threshold, not style injection.
  console.log(`fact1.png: using imagePrompt directly`);

  // 2. Generate → grayscale → crop → resize
  const gray = await generateAndDecodeGray(env, moment.imagePrompt, FACT1_STEPS, FACT1_GUIDANCE);

  // 4. Optional median filter (behind flag)
  if (FACT1_USE_MEDIAN) {
    medianFilter3x3(gray, WIDTH, HEIGHT);
  }

  // 5. Auto-threshold to target blackRatio 0.12–0.28
  const { bits, threshold, blackRatio } = autoThreshold(gray);
  console.log(`fact1.png: threshold=${threshold}, blackRatio=${(blackRatio * 100).toFixed(1)}%`);

  // 6. Symmetric despeckle (isolated pixels + white holes)
  despeckle1Bit(bits, WIDTH, HEIGHT);

  // 7. Elegant white strip caption (drawn AFTER threshold into 1-bit buffer)
  drawOverlayText1Bit(bits, moment, displayDate);

  return encodePNG1Bit(bits, WIDTH, HEIGHT);
}
