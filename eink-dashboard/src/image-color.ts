/**
 * Color image utilities for the Spectra 6 pipeline.
 *
 * RGB center-crop, bilinear resize, and AI-to-RGB decode helpers.
 * Parallel to the grayscale utilities in image.ts but working on 3-channel data.
 */

import { decodePNG } from "./png-decode";
import { generateAIImage, generateFluxImage, WIDTH, HEIGHT } from "./image";
import type { Env } from "./types";

// --- Bilinear resize (RGB, 3 bytes/pixel) ---

export function resizeRGB(
  src: Uint8Array,
  srcW: number,
  srcH: number,
  dstW: number,
  dstH: number
): Uint8Array {
  const dst = new Uint8Array(dstW * dstH * 3);
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

      for (let c = 0; c < 3; c++) {
        const a = src[(y0 * srcW + x0) * 3 + c];
        const b = src[(y0 * srcW + x1) * 3 + c];
        const cv = src[(y1 * srcW + x0) * 3 + c];
        const d = src[(y1 * srcW + x1) * 3 + c];

        const value = a * (1 - fx) * (1 - fy) + b * fx * (1 - fy) + cv * (1 - fx) * fy + d * fx * fy;
        dst[(y * dstW + x) * 3 + c] = Math.round(value);
      }
    }
  }
  return dst;
}

// --- Center-crop to target aspect ratio (RGB) ---

export function centerCropRGB(
  src: Uint8Array,
  srcW: number,
  srcH: number,
  targetW: number,
  targetH: number
): { rgb: Uint8Array; width: number; height: number } {
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

  const dst = new Uint8Array(cropW * cropH * 3);
  for (let y = 0; y < cropH; y++) {
    const srcOff = ((y + offsetY) * srcW + offsetX) * 3;
    dst.set(src.subarray(srcOff, srcOff + cropW * 3), y * cropW * 3);
  }

  return { rgb: dst, width: cropW, height: cropH };
}

// --- AI model → RGB → crop → resize (SDXL) ---

export async function generateAndDecodeColor(
  env: Env,
  prompt: string,
  steps: number = 20,
  guidance: number = 7.0,
): Promise<Uint8Array> {
  const jpegBytes = await generateAIImage(env, prompt, steps, guidance);

  const pngResponse = (await env.IMAGES.input(jpegBytes).output({ format: "image/png" })).response();
  const pngBytes = new Uint8Array(await pngResponse.arrayBuffer());
  const decoded = await decodePNG(pngBytes);

  if (!decoded.rgb) {
    throw new Error("Expected color PNG but got grayscale");
  }

  const cropped = centerCropRGB(decoded.rgb, decoded.width, decoded.height, WIDTH, HEIGHT);
  return (cropped.width === WIDTH && cropped.height === HEIGHT)
    ? cropped.rgb
    : resizeRGB(cropped.rgb, cropped.width, cropped.height, WIDTH, HEIGHT);
}

// --- AI model → RGB → crop → resize (FLUX.2) ---

export async function generateAndDecodeColorFlux(
  env: Env,
  prompt: string,
): Promise<Uint8Array> {
  const jpegBytes = await generateFluxImage(env, prompt);

  const pngResponse = (await env.IMAGES.input(jpegBytes).output({ format: "image/png" })).response();
  const pngBytes = new Uint8Array(await pngResponse.arrayBuffer());
  const decoded = await decodePNG(pngBytes);

  if (!decoded.rgb) {
    throw new Error("Expected color PNG but got grayscale");
  }

  const cropped = centerCropRGB(decoded.rgb, decoded.width, decoded.height, WIDTH, HEIGHT);
  return (cropped.width === WIDTH && cropped.height === HEIGHT)
    ? cropped.rgb
    : resizeRGB(cropped.rgb, cropped.width, cropped.height, WIDTH, HEIGHT);
}
