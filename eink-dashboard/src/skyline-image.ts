/**
 * World Skyline Series — image generation + post-processing.
 *
 * BW path:    SDXL → grayscale → crop/resize → caption → tone curve → 4-level quantize → 8-bit PNG
 * Color path: SDXL → RGB crop/resize → Floyd-Steinberg dither → Spectra 6 indexed PNG (caption in HTML)
 *
 * Uses SDXL for stability (skyline silhouettes are well-defined with SDXL).
 */

import type { Env } from "./types";
import type { SkylineColorMode } from "./skyline";
import {
  generateAIImage,
  WIDTH,
  HEIGHT,
  centerCropGray,
  resizeGray,
  drawText,
  quantize4Level,
} from "./image";
import { applyToneCurve } from "./convert-1bit";
import { encodePNGGray8, encodePNGIndexed, pngToBase64 } from "./png";
import { decodePNG } from "./png-decode";
import { measureText } from "./font";
import { generateAndDecodeColor } from "./image-color";
import { ditherFloydSteinberg } from "./dither-spectra6";
import { SPECTRA6_PALETTE } from "./spectra6";

// SDXL params (same as Pipeline B — stable for architectural subjects)
const SDXL_STEPS = 20;
const SDXL_GUIDANCE = 7.0;

// Caption bar dimensions (match Pipeline A: 24px black bar, white 8px text)
const BAR_H = 24;
const BAR_PAD = 8;
const CAPTION_SCALE = 1;

// --- BW path: grayscale 4-level ---

async function generateGraySkyline(env: Env, prompt: string): Promise<Uint8Array> {
  const jpegBytes = await generateAIImage(env, prompt, SDXL_STEPS, SDXL_GUIDANCE);

  const pngResponse = (await env.IMAGES.input(jpegBytes).output({ format: "image/png" })).response();
  const pngBytes = new Uint8Array(await pngResponse.arrayBuffer());
  const decoded = await decodePNG(pngBytes);

  const cropped = centerCropGray(decoded.gray, decoded.width, decoded.height, WIDTH, HEIGHT);
  return (cropped.width === WIDTH && cropped.height === HEIGHT)
    ? cropped.gray
    : resizeGray(cropped.gray, cropped.width, cropped.height, WIDTH, HEIGHT);
}

function drawSkylineCaptionGray(
  buf: Uint8Array,
  left: string,
  center: string,
  right: string,
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

  // Left: city (truncate at 35 chars)
  const leftText = left.length > 35 ? left.slice(0, 32) + "..." : left;
  drawText(buf, BAR_PAD, textY, leftText, CAPTION_SCALE, 255);

  // Right: date
  const rightW = measureText(right, CAPTION_SCALE);
  drawText(buf, WIDTH - BAR_PAD - rightW, textY, right, CAPTION_SCALE, 255);

  // Center: series name (centered in gap between left and right)
  const leftW = measureText(leftText, CAPTION_SCALE);
  const leftEnd = BAR_PAD + leftW;
  const rightStart = WIDTH - BAR_PAD - rightW;
  const gap = 12;
  const availW = rightStart - leftEnd - 2 * gap;

  if (availW > 0) {
    let centerText = center;
    while (measureText(centerText, CAPTION_SCALE) > availW && centerText.length > 3) {
      centerText = centerText.slice(0, -1);
    }
    if (centerText.length < center.length) centerText += "...";
    const centerW = measureText(centerText, CAPTION_SCALE);
    const centerX = leftEnd + gap + Math.floor((availW - centerW) / 2);
    drawText(buf, centerX, textY, centerText, CAPTION_SCALE, 255);
  }
}

// --- Color path: Spectra 6 dithered ---

async function generateColorSkyline(env: Env, prompt: string): Promise<Uint8Array> {
  // Use SDXL → crop/resize to 800×480 RGB via Cloudflare Images
  return generateAndDecodeColor(env, prompt, SDXL_STEPS, SDXL_GUIDANCE);
}

// --- Public API ---

export interface SkylineImageResult {
  png: Uint8Array;
  base64: string;
  colorMode: SkylineColorMode;
}

/**
 * Generate a skyline image.
 *
 * BW mode: returns 4-level grayscale PNG with bitmap caption bar baked in.
 * Color mode: returns Spectra 6 indexed PNG (caption rendered in HTML, not baked).
 */
export async function generateSkylineImage(
  env: Env,
  prompt: string,
  caption: { left: string; center: string; right: string },
  colorMode: SkylineColorMode,
): Promise<SkylineImageResult> {
  if (colorMode === "bw") {
    // Grayscale path: SDXL → gray → caption → tone curve → 4-level
    const gray = await generateGraySkyline(env, prompt);
    drawSkylineCaptionGray(gray, caption.left, caption.center, caption.right);
    applyToneCurve(gray, 1.2, 0.95);
    quantize4Level(gray);
    const png = await encodePNGGray8(gray, WIDTH, HEIGHT);
    return { png, base64: pngToBase64(png), colorMode };
  }

  // Color path: SDXL → RGB → Floyd-Steinberg → Spectra 6 indexed PNG
  const rgb = await generateColorSkyline(env, prompt);
  const indices = ditherFloydSteinberg(rgb, WIDTH, HEIGHT, SPECTRA6_PALETTE);
  const png = await encodePNGIndexed(indices, WIDTH, HEIGHT, SPECTRA6_PALETTE);
  return { png, base64: pngToBase64(png), colorMode };
}
