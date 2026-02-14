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

import { encodePNGGray8 } from "./png";
import { decodePNG } from "./png-decode";
import { measureText } from "./font";
import { FONT_8X8 as FONT_DATA } from "./font";
import type { Env, MomentBeforeData } from "./types";

const WIDTH = 800;
const HEIGHT = 480;
const IMAGE_MODEL = "@cf/black-forest-labs/flux-2-dev" as const;

// --- AI image generation ---

async function generateAIImage(env: Env, prompt: string): Promise<Uint8Array> {
  // FLUX-2 models require multipart form data
  const form = new FormData();
  form.append("prompt", prompt);
  form.append("width", String(WIDTH));
  form.append("height", String(HEIGHT));
  form.append("steps", "20");

  const formResponse = new Response(form);
  const formStream = formResponse.body!;
  const formContentType = formResponse.headers.get("content-type")!;

  const result: any = await env.AI.run(IMAGE_MODEL, {
    multipart: {
      body: formStream,
      contentType: formContentType,
    },
  });

  // Result is { image: base64_string }
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

// --- Text overlay ---

const TEXT_SCALE = 2;       // 16px tall text
const TEXT_MARGIN = 12;     // margin from edges
const TEXT_PAD_X = 4;       // horizontal padding around text
const TEXT_PAD_Y = 2;       // vertical padding around text
const TEXT_HEIGHT = 8 * TEXT_SCALE; // 16px

/**
 * Draw white text with a black backing rectangle for readability.
 */
function drawTextWithBacking(
  buf: Uint8Array,
  x: number,
  y: number,
  text: string,
  scale: number
): void {
  const textW = measureText(text, scale);
  const textH = 8 * scale;

  // Draw black backing rectangle
  for (let py = y - TEXT_PAD_Y; py < y + textH + TEXT_PAD_Y; py++) {
    for (let px = x - TEXT_PAD_X; px < x + textW + TEXT_PAD_X; px++) {
      if (px >= 0 && px < WIDTH && py >= 0 && py < HEIGHT) {
        buf[py * WIDTH + px] = 0;
      }
    }
  }

  // Draw white text using font glyphs
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
                buf[py * WIDTH + px] = 255;
              }
            }
          }
        }
      }
    }
  }
}

/**
 * Overlay text on the image bottom in two lines:
 *   Line 1 (upper): Title centered
 *   Line 2 (lower): Location left, Date right
 */
function drawOverlayText(
  buf: Uint8Array,
  moment: MomentBeforeData,
  displayDate: string
): void {
  const location = moment.location.length > 30
    ? moment.location.slice(0, 27) + "..."
    : moment.location;
  const title = moment.title.length > 35
    ? moment.title.slice(0, 32) + "..."
    : moment.title;
  const dateLine = `${displayDate}, ${moment.year}`;

  const LINE_GAP = 4;
  const bottomLineY = HEIGHT - TEXT_MARGIN - TEXT_HEIGHT;
  const topLineY = bottomLineY - TEXT_HEIGHT - LINE_GAP - TEXT_PAD_Y * 2;

  // Upper line: Title centered
  if (title.length > 0) {
    const titleW = measureText(title, TEXT_SCALE);
    const titleX = Math.round((WIDTH - titleW) / 2);
    drawTextWithBacking(buf, titleX, topLineY, title, TEXT_SCALE);
  }

  // Lower line: Location left, Date right
  drawTextWithBacking(buf, TEXT_MARGIN, bottomLineY, location, TEXT_SCALE);
  const dateW = measureText(dateLine, TEXT_SCALE);
  drawTextWithBacking(buf, WIDTH - TEXT_MARGIN - dateW, bottomLineY, dateLine, TEXT_SCALE);
}

// --- Debug: return raw AI image before processing ---

export async function generateMomentImageRaw(
  env: Env,
  moment: MomentBeforeData,
): Promise<Uint8Array> {
  return generateAIImage(env, moment.imagePrompt);
}

// --- Main entry point ---

export async function generateMomentImage(
  env: Env,
  moment: MomentBeforeData,
  displayDate: string
): Promise<Uint8Array> {
  // 1. Generate image via AI (returns JPEG)
  const jpegBytes = await generateAIImage(env, moment.imagePrompt);

  // 2. Convert JPEG → PNG via Cloudflare Images binding
  const pngResponse = (await env.IMAGES.input(jpegBytes).output({ format: "image/png" })).response();
  const pngBytes = new Uint8Array(await pngResponse.arrayBuffer());

  // 3. Decode PNG to grayscale
  const decoded = await decodePNG(pngBytes);

  // 4. Resize to 800 × 480 if needed
  let gray: Uint8Array;
  if (decoded.width === WIDTH && decoded.height === HEIGHT) {
    gray = decoded.gray;
  } else {
    gray = resizeGray(decoded.gray, decoded.width, decoded.height, WIDTH, HEIGHT);
  }

  // 5. Overlay location and date
  drawOverlayText(gray, moment, displayDate);

  // 6. Encode as 8-bit grayscale PNG
  return encodePNGGray8(gray, WIDTH, HEIGHT);
}
