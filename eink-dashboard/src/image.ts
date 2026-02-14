/**
 * "Moment Before" image pipeline.
 *
 * 1. Generate a woodcut-style image via Workers AI (FLUX-schnell) → JPEG
 * 2. Convert JPEG → PNG via Cloudflare Images binding
 * 3. Decode the PNG into grayscale pixels
 * 4. Apply Floyd-Steinberg dithering → 1-bit
 * 5. Overlay date / year / location text at the bottom
 * 6. Encode as 1-bit monochrome PNG for the e-ink display
 *
 * Output: 800 × 480 px, 1-bit (black/white)
 */

import { encodePNG1Bit } from "./png";
import { decodePNG } from "./png-decode";
import { drawTextCentered } from "./font";
import type { Env, MomentBeforeData } from "./types";

const WIDTH = 800;
const HEIGHT = 480;
const IMAGE_MODEL = "@cf/black-forest-labs/flux-1-schnell";

// Info strip at the bottom of the image
const INFO_HEIGHT = 64;
const IMAGE_HEIGHT = HEIGHT - INFO_HEIGHT; // 416px for the AI image

// --- AI image generation ---

async function generateAIImage(env: Env, prompt: string): Promise<Uint8Array> {
  const result: any = await env.AI.run(IMAGE_MODEL, {
    prompt,
    width: 800,
    height: 416,
    num_steps: 4,
  });

  // Workers AI image models return a ReadableStream or Uint8Array
  if (result instanceof ReadableStream) {
    const reader = result.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      total += value.length;
    }
    const bytes = new Uint8Array(total);
    let off = 0;
    for (const c of chunks) {
      bytes.set(c, off);
      off += c.length;
    }
    return bytes;
  }

  // Already a Uint8Array or ArrayBuffer
  if (result instanceof ArrayBuffer) return new Uint8Array(result);
  if (result instanceof Uint8Array) return result;

  // FLUX-schnell returns { image: base64_jpeg_string }
  if (typeof result === "object" && result !== null) {
    const img = result.image ?? result.images?.[0];
    if (img) {
      if (typeof img === "string") {
        return Uint8Array.from(atob(img), (c) => c.charCodeAt(0));
      }
      if (img instanceof Uint8Array) return img;
      if (img instanceof ArrayBuffer) return new Uint8Array(img);
      if (img instanceof ReadableStream) {
        const reader = img.getReader();
        const chunks: Uint8Array[] = [];
        let total = 0;
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          chunks.push(value);
          total += value.length;
        }
        const bytes = new Uint8Array(total);
        let off = 0;
        for (const c of chunks) {
          bytes.set(c, off);
          off += c.length;
        }
        return bytes;
      }
    }
  }

  throw new Error(`Unexpected AI image response type: ${typeof result}`);
}

// --- Floyd-Steinberg dithering ---

/**
 * Convert grayscale (0-255) to 1-bit via Floyd-Steinberg error diffusion.
 * Returns a Uint8Array where 0=black, 1=white — same format as the PNG encoder expects.
 */
function floydSteinberg(
  gray: Uint8Array,
  width: number,
  height: number
): Uint8Array {
  // Work on a copy as Float32 for error accumulation
  const buf = new Float32Array(width * height);
  for (let i = 0; i < gray.length; i++) buf[i] = gray[i];

  const out = new Uint8Array(WIDTH * HEIGHT);
  out.fill(1); // default white (for the info strip area)

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      const oldPixel = buf[idx];
      const newPixel = oldPixel < 128 ? 0 : 255;
      const err = oldPixel - newPixel;

      // Write to output buffer (map 0→0 black, 255→1 white)
      out[y * WIDTH + x] = newPixel === 0 ? 0 : 1;

      // Distribute error to neighbors
      if (x + 1 < width) buf[idx + 1] += err * (7 / 16);
      if (y + 1 < height) {
        if (x > 0) buf[idx + width - 1] += err * (3 / 16);
        buf[idx + width] += err * (5 / 16);
        if (x + 1 < width) buf[idx + width + 1] += err * (1 / 16);
      }
    }
  }

  return out;
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

// --- Decorative elements ---

function drawRule(buf: Uint8Array, y: number, xStart: number, xEnd: number): void {
  for (let x = xStart; x < xEnd; x++) {
    if ((x + y) % 2 === 0) buf[y * WIDTH + x] = 0;
    buf[(y + 1) * WIDTH + x] = 0;
    buf[(y + 2) * WIDTH + x] = 0;
    if ((x + y) % 2 === 0) buf[(y + 3) * WIDTH + x] = 0;
  }
}

// --- Text overlay at the bottom ---

function drawInfoStrip(
  buf: Uint8Array,
  moment: MomentBeforeData,
  displayDate: string
): void {
  const stripTop = IMAGE_HEIGHT;

  // White fill for the info strip
  for (let y = stripTop; y < HEIGHT; y++) {
    for (let x = 0; x < WIDTH; x++) {
      buf[y * WIDTH + x] = 1;
    }
  }

  // Decorative rule at the top of the strip
  drawRule(buf, stripTop + 2, 40, WIDTH - 40);

  // "MOMENT BEFORE" — small centered label
  drawTextCentered(buf, WIDTH, HEIGHT, stripTop + 10, "MOMENT BEFORE", 1, 40, WIDTH - 40);

  // Date + Year — e.g. "February 14, 1912"
  const dateLine = `${displayDate}, ${moment.year}`;
  drawTextCentered(buf, WIDTH, HEIGHT, stripTop + 22, dateLine, 2, 40, WIDTH - 40);

  // Location — e.g. "North Atlantic Ocean"
  const location = moment.location.length > 50
    ? moment.location.slice(0, 47) + "..."
    : moment.location;
  drawTextCentered(buf, WIDTH, HEIGHT, stripTop + 44, location, 2, 40, WIDTH - 40);
}

// --- Main entry point ---

export async function generateMomentImage(
  env: Env,
  moment: MomentBeforeData,
  displayDate: string
): Promise<Uint8Array> {
  // 1. Generate woodcut image via AI (returns JPEG)
  const jpegBytes = await generateAIImage(env, moment.imagePrompt);

  // 2. Convert JPEG → PNG via Cloudflare Images binding
  const pngResponse = (await env.IMAGES.input(jpegBytes).output({ format: "image/png" })).response();
  const pngBytes = new Uint8Array(await pngResponse.arrayBuffer());

  // 3. Decode PNG to grayscale
  const decoded = await decodePNG(pngBytes);

  // 4. Resize to 800 × IMAGE_HEIGHT if needed
  let gray: Uint8Array;
  if (decoded.width === WIDTH && decoded.height === IMAGE_HEIGHT) {
    gray = decoded.gray;
  } else {
    gray = resizeGray(decoded.gray, decoded.width, decoded.height, WIDTH, IMAGE_HEIGHT);
  }

  // 5. Floyd-Steinberg dither → 1-bit (writes into full 800×480 buffer)
  const buf = floydSteinberg(gray, WIDTH, IMAGE_HEIGHT);

  // 6. Draw the info strip (date, year, location) in the bottom 64px
  drawInfoStrip(buf, moment, displayDate);

  // 7. Encode as 1-bit PNG
  return encodePNG1Bit(buf, WIDTH, HEIGHT);
}
