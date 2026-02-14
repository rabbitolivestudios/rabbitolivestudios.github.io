/**
 * "Moment Before" image pipeline.
 *
 * 1. Generate an ink-illustration image via Workers AI (FLUX-2-dev) → JPEG
 * 2. Convert JPEG → PNG via Cloudflare Images binding
 * 3. Decode the PNG into grayscale pixels
 * 4. Resize to 800×480 if needed
 * 5. Overlay location + date text
 * 6. Encode as 8-bit grayscale PNG
 *
 * Output: 800 × 480 px, 8-bit grayscale, full-bleed image
 */

import { encodePNGGray8, encodePNG1Bit } from "./png";
import { decodePNG } from "./png-decode";
import { measureText } from "./font";
import { FONT_8X8 as FONT_DATA } from "./font";
import type { Env, MomentBeforeData } from "./types";

const WIDTH = 800;
const HEIGHT = 480;
const IMAGE_MODEL = "@cf/stabilityai/stable-diffusion-xl-base-1.0" as const;
const SDXL_STEPS = 20;       // max supported by Workers AI
const SDXL_GUIDANCE = 6.5;
const SDXL_WIDTH = 1024;
const SDXL_HEIGHT = 768;

// --- AI image generation (SDXL) ---

async function generateAIImage(env: Env, prompt: string): Promise<Uint8Array> {
  const result: any = await env.AI.run(IMAGE_MODEL, {
    prompt,
    num_steps: SDXL_STEPS,
    guidance: SDXL_GUIDANCE,
    width: SDXL_WIDTH,
    height: SDXL_HEIGHT,
  });

  // SDXL returns raw JPEG bytes (various possible runtime types)
  if (result instanceof Uint8Array) return result;
  if (result instanceof ArrayBuffer) return new Uint8Array(result);
  if (result instanceof ReadableStream) {
    return new Uint8Array(await new Response(result).arrayBuffer());
  }
  // Fallback for base64 response format
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
    // Source is wider → crop width
    cropH = srcH;
    cropW = Math.round(srcH * targetAspect);
    offsetX = Math.floor((srcW - cropW) / 2);
    offsetY = 0;
  } else {
    // Source is taller → crop height
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

// --- Text overlay ---

const BAR_H = 24;          // thin bottom info bar
const BAR_PAD = 8;          // horizontal padding inside bar
const CAPTION_SCALE = 1;    // 8px tall text (small, elegant)

/**
 * Draw white text glyphs onto a buffer (no backing rectangle).
 */
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
 * Thin bottom bar with 3 fields: location (left) | title (center) | date (right).
 */
function drawOverlayText(
  buf: Uint8Array,
  moment: MomentBeforeData,
  displayDate: string
): void {
  const barY = HEIGHT - BAR_H;
  const textH = 8 * CAPTION_SCALE;
  const textY = barY + Math.floor((BAR_H - textH) / 2);

  // Draw solid black bar
  for (let y = barY; y < HEIGHT; y++) {
    for (let x = 0; x < WIDTH; x++) {
      buf[y * WIDTH + x] = 0;
    }
  }

  // Left: location
  const location = moment.location.length > 25
    ? moment.location.slice(0, 22) + "..."
    : moment.location;
  drawText(buf, BAR_PAD, textY, location, CAPTION_SCALE, 255);

  // Right: date
  const dateLine = `${displayDate}, ${moment.year}`;
  const dateW = measureText(dateLine, CAPTION_SCALE);
  drawText(buf, WIDTH - BAR_PAD - dateW, textY, dateLine, CAPTION_SCALE, 255);

  // Center: title (truncate to fit between location and date)
  const locW = measureText(location, CAPTION_SCALE);
  const gap = 20; // min gap between fields
  const maxTitleW = WIDTH - 2 * BAR_PAD - locW - dateW - 2 * gap;
  let title = moment.title;
  if (title.length > 0 && maxTitleW > 0) {
    while (measureText(title, CAPTION_SCALE) > maxTitleW && title.length > 3) {
      title = title.slice(0, -1);
    }
    if (title.length < moment.title.length) title += "...";
    const titleW = measureText(title, CAPTION_SCALE);
    drawText(buf, Math.round((WIDTH - titleW) / 2), textY, title, CAPTION_SCALE, 255);
  }
}

// --- Debug: return raw AI image before processing ---

export async function generateMomentImageRaw(
  env: Env,
  moment: MomentBeforeData,
): Promise<Uint8Array> {
  return generateAIImage(env, moment.imagePrompt);
}

// --- Tone curve + Floyd-Steinberg dithering for 1-bit output ---

/**
 * In-place contrast + gamma adjustment on grayscale buffer.
 * Contrast stretches around midpoint (128), gamma < 1 darkens midtones.
 */
function applyToneCurve(gray: Uint8Array, contrast = 1.3, gamma = 0.9): void {
  for (let i = 0; i < gray.length; i++) {
    let x = (gray[i] - 128) * contrast + 128;
    if (x < 0) x = 0;
    if (x > 255) x = 255;
    x = 255 * Math.pow(x / 255, gamma);
    gray[i] = Math.round(x < 0 ? 0 : x > 255 ? 255 : x);
  }
}

/**
 * Floyd-Steinberg dithering: grayscale → 1-bit.
 * Returns Uint8Array where 0=black, 1=white (matches encodePNG1Bit input).
 */
function floydSteinbergDither(gray: Uint8Array, w: number, h: number): Uint8Array {
  const buf = new Float32Array(gray.length);
  for (let i = 0; i < gray.length; i++) buf[i] = gray[i];

  const out = new Uint8Array(w * h);

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = y * w + x;
      const old = buf[idx];
      const val = old < 128 ? 0 : 255;
      out[idx] = val === 0 ? 0 : 1;
      const err = old - val;

      if (x + 1 < w) buf[idx + 1] += err * 7 / 16;
      if (y + 1 < h) {
        if (x > 0) buf[(y + 1) * w + (x - 1)] += err * 3 / 16;
        buf[(y + 1) * w + x] += err * 5 / 16;
        if (x + 1 < w) buf[(y + 1) * w + (x + 1)] += err * 1 / 16;
      }
    }
  }

  return out;
}

// --- Main entry point ---

export async function generateMomentImage(
  env: Env,
  moment: MomentBeforeData,
  displayDate: string
): Promise<Uint8Array> {
  // 1. Generate image via SDXL (returns JPEG)
  const jpegBytes = await generateAIImage(env, moment.imagePrompt);

  // 2. Convert JPEG → PNG via Cloudflare Images, then decode to grayscale
  const pngResponse = (await env.IMAGES.input(jpegBytes).output({ format: "image/png" })).response();
  const pngBytes = new Uint8Array(await pngResponse.arrayBuffer());
  const decoded = await decodePNG(pngBytes);

  // 3. Center-crop to 800:480 aspect ratio, then resize
  const cropped = centerCropGray(decoded.gray, decoded.width, decoded.height, WIDTH, HEIGHT);
  const gray = (cropped.width === WIDTH && cropped.height === HEIGHT)
    ? cropped.gray
    : resizeGray(cropped.gray, cropped.width, cropped.height, WIDTH, HEIGHT);

  // 4. Overlay caption bar
  drawOverlayText(gray, moment, displayDate);

  // 5. Encode as 8-bit grayscale PNG
  return encodePNGGray8(gray, WIDTH, HEIGHT);
}

/**
 * Full pipeline ending in 1-bit dithered PNG for mono e-ink displays.
 * Same as generateMomentImage but adds tone curve + Floyd-Steinberg dither.
 */
export async function generateMomentImage1Bit(
  env: Env,
  moment: MomentBeforeData,
  displayDate: string
): Promise<Uint8Array> {
  // 1. Generate image via SDXL (returns JPEG)
  const jpegBytes = await generateAIImage(env, moment.imagePrompt);

  // 2. Convert JPEG → PNG via Cloudflare Images, then decode to grayscale
  const pngResponse = (await env.IMAGES.input(jpegBytes).output({ format: "image/png" })).response();
  const pngBytes = new Uint8Array(await pngResponse.arrayBuffer());
  const decoded = await decodePNG(pngBytes);

  // 3. Center-crop to 800:480 aspect ratio, then resize
  const cropped = centerCropGray(decoded.gray, decoded.width, decoded.height, WIDTH, HEIGHT);
  const gray = (cropped.width === WIDTH && cropped.height === HEIGHT)
    ? cropped.gray
    : resizeGray(cropped.gray, cropped.width, cropped.height, WIDTH, HEIGHT);

  // 4. Overlay caption bar (before dithering so text stays crisp)
  drawOverlayText(gray, moment, displayDate);

  // 5. Apply tone curve (contrast + gamma)
  applyToneCurve(gray);

  // 6. Floyd-Steinberg dither → 1-bit
  const bits = floydSteinbergDither(gray, WIDTH, HEIGHT);

  // 7. Encode as 1-bit PNG
  return encodePNG1Bit(bits, WIDTH, HEIGHT);
}
