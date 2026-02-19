/**
 * Color image utilities for the Spectra 6 pipeline.
 *
 * RGB center-crop, bilinear resize, and AI-to-RGB decode helpers.
 * Parallel to the grayscale utilities in image.ts but working on 3-channel data.
 */

import { decodePNG } from "./png-decode";
import { generateAIImage, generateFluxImage, WIDTH, HEIGHT } from "./image";
import type { Env } from "./types";

// --- AI model → RGB 800×480 (SDXL) ---

export async function generateAndDecodeColor(
  env: Env,
  prompt: string,
  steps: number = 20,
  guidance: number = 7.0,
): Promise<Uint8Array> {
  const jpegBytes = await generateAIImage(env, prompt, steps, guidance);

  // Resize + center-crop to 800×480 via Cloudflare Images — avoids JS decode of full 1024×768
  const pngResponse = (await env.IMAGES
    .input(jpegBytes)
    .transform({ width: WIDTH, height: HEIGHT, fit: "cover" })
    .output({ format: "image/png" })
  ).response();
  const pngBytes = new Uint8Array(await pngResponse.arrayBuffer());
  const decoded = await decodePNG(pngBytes);

  if (!decoded.rgb) {
    throw new Error("Expected color PNG but got grayscale");
  }

  return decoded.rgb;
}

// --- AI model → RGB 800×480 (FLUX.2) ---

export async function generateAndDecodeColorFlux(
  env: Env,
  prompt: string,
): Promise<Uint8Array> {
  const jpegBytes = await generateFluxImage(env, prompt);

  // Resize + center-crop to 800×480 via Cloudflare Images — avoids JS decode of full 1024×768
  const pngResponse = (await env.IMAGES
    .input(jpegBytes)
    .transform({ width: WIDTH, height: HEIGHT, fit: "cover" })
    .output({ format: "image/png" })
  ).response();
  const pngBytes = new Uint8Array(await pngResponse.arrayBuffer());
  const decoded = await decodePNG(pngBytes);

  if (!decoded.rgb) {
    throw new Error("Expected color PNG but got grayscale");
  }

  return decoded.rgb;
}
