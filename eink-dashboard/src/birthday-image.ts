/**
 * Birthday portrait generation pipeline.
 *
 * Uses FLUX.2 klein-9b with optional reference photos from R2.
 * Produces a 4-level grayscale 800x480 PNG with birthday caption.
 */

import { encodePNGGray8 } from "./png";
import { decodePNG } from "./png-decode";
import { measureText } from "./font";
import {
  WIDTH, HEIGHT,
  resizeGray, centerCropGray, drawText,
  quantize4Level,
} from "./image";
import { applyToneCurve } from "./convert-1bit";
import { getArtStyle } from "./birthday";
import type { BirthdayPerson } from "./birthday";
import type { Env } from "./types";

const FLUX_MODEL = "@cf/black-forest-labs/flux-2-klein-9b";
const FLUX_WIDTH = 1024;
const FLUX_HEIGHT = 768;

const BAR_H = 24;
const BAR_PAD = 8;

/** Strip accents/diacritics for ASCII-only bitmap font. */
function stripAccents(s: string): string {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

/** Build an age description for the prompt. */
function ageDescription(person: BirthdayPerson, currentYear: number): string {
  const age = currentYear - person.birthYear;
  if (age <= 12) return `a ${age}-year-old child`;
  if (age <= 17) return `a ${age}-year-old teenager`;
  return `a ${age}-year-old person`;
}

/**
 * Generate a birthday portrait image using FLUX.2 with optional R2 reference photos.
 * Returns 800x480 4-level grayscale PNG.
 */
export async function generateBirthdayImage(
  env: Env,
  person: BirthdayPerson,
  currentYear: number,
  styleOverride?: number,
): Promise<Uint8Array> {
  const style = styleOverride !== undefined
    ? getArtStyle(2020 + styleOverride)  // 2020 % 10 === 0, so +N gives style N
    : getArtStyle(currentYear);
  const age = currentYear - person.birthYear;

  // Fetch up to 4 reference photos from R2
  const photos = await fetchReferencePhotos(env, person.key);
  console.log(`Birthday: found ${photos.length} reference photo(s) for ${person.key}`);

  // Generate portrait with FLUX.2 (retry once on failure)
  let jpegBytes: Uint8Array | null = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      jpegBytes = await callFlux(env, person, style.prompt, photos, currentYear);
      break;
    } catch (err) {
      console.error(`Birthday FLUX.2 attempt ${attempt + 1} failed:`, err);
      if (attempt === 0) continue;
    }
  }

  if (!jpegBytes) {
    throw new Error("FLUX.2 portrait generation failed after retries");
  }

  // JPEG → PNG via Cloudflare Images
  const pngResponse = (await env.IMAGES.input(jpegBytes).output({ format: "image/png" })).response();
  const pngBytes = new Uint8Array(await pngResponse.arrayBuffer());
  const decoded = await decodePNG(pngBytes);

  // Grayscale → center-crop → resize to 800x480
  const cropped = centerCropGray(decoded.gray, decoded.width, decoded.height, WIDTH, HEIGHT);
  let gray = (cropped.width === WIDTH && cropped.height === HEIGHT)
    ? cropped.gray
    : resizeGray(cropped.gray, cropped.width, cropped.height, WIDTH, HEIGHT);

  // Birthday caption bar (24px black bar at bottom)
  drawBirthdayCaption(gray, stripAccents(person.name), age, style.name);

  // Tone curve + quantize (same as 4-level pipeline)
  applyToneCurve(gray, 1.2, 0.95);
  quantize4Level(gray);

  return encodePNGGray8(gray, WIDTH, HEIGHT);
}

/** Try to fetch a file from R2 with .jpg or .jpeg extension. */
export async function getPhotoFromR2(env: Env, basePath: string): Promise<Uint8Array | null> {
  for (const ext of [".jpg", ".jpeg"]) {
    try {
      const obj = await env.PHOTOS.get(basePath + ext);
      if (obj) return new Uint8Array(await obj.arrayBuffer());
    } catch { /* skip */ }
  }
  return null;
}

/**
 * Fetch up to 4 reference photos from R2.
 * Tries numbered format first ({key}_0.jpg/jpeg .. {key}_3.jpg/jpeg),
 * falls back to single file ({key}.jpg/jpeg).
 */
export async function fetchReferencePhotos(env: Env, key: string): Promise<Uint8Array[]> {
  const photos: Uint8Array[] = [];

  // Try numbered photos: {key}_0 through {key}_3
  for (let i = 0; i < 4; i++) {
    const photo = await getPhotoFromR2(env, `portraits/${key}_${i}`);
    if (photo) {
      photos.push(photo);
    } else {
      break; // Stop at first missing index
    }
  }

  // Fallback: try single file {key}.jpg/jpeg
  if (photos.length === 0) {
    const photo = await getPhotoFromR2(env, `portraits/${key}`);
    if (photo) photos.push(photo);
  }

  return photos;
}

/**
 * Call FLUX.2 klein-9b via multipart FormData.
 * Steps are fixed at 4 for klein models.
 * Supports up to 4 reference images for better likeness.
 */
async function callFlux(
  env: Env,
  person: BirthdayPerson,
  stylePrompt: string,
  photos: Uint8Array[],
  currentYear: number,
): Promise<Uint8Array> {
  const form = new FormData();
  const ageLine = ageDescription(person, currentYear);

  let prompt: string;
  if (photos.length > 0) {
    for (let i = 0; i < photos.length; i++) {
      form.append(`input_image_${i}`, new Blob([photos[i]], { type: "image/jpeg" }));
    }
    const imageRefs = photos.length === 1
      ? "the person in image 0"
      : `the person shown in images ${photos.map((_, i) => i).join(", ")}`;
    prompt = `artistic portrait of ${imageRefs}, ${ageLine}, ${stylePrompt}, head and shoulders, centered composition, looking at viewer, smiling, no text, no words, no letters, no writing`;
  } else {
    prompt = `artistic portrait of ${ageLine}, ${stylePrompt}, head and shoulders, centered composition, looking at viewer, smiling, no text, no words, no letters, no writing`;
  }

  form.append("prompt", prompt);
  form.append("width", String(FLUX_WIDTH));
  form.append("height", String(FLUX_HEIGHT));
  form.append("guidance", "7.0");

  // Serialize FormData for Workers AI multipart API
  const formResponse = new Response(form);
  const formStream = formResponse.body;
  const formContentType = formResponse.headers.get("content-type")!;

  const result: any = await env.AI.run(FLUX_MODEL as any, {
    multipart: {
      body: formStream,
      contentType: formContentType,
    },
  });

  // FLUX.2 returns base64-encoded image in { image: "..." }
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

/**
 * Generate a birthday portrait JPEG using FLUX.2 with reference photos.
 * Returns raw JPEG bytes (before any grayscale/color processing).
 * Used by both the mono and color birthday pipelines.
 */
export async function generateBirthdayJPEG(
  env: Env,
  person: BirthdayPerson,
  currentYear: number,
  styleOverride?: number,
): Promise<Uint8Array> {
  const style = styleOverride !== undefined
    ? getArtStyle(2020 + styleOverride)
    : getArtStyle(currentYear);

  const photos = await fetchReferencePhotos(env, person.key);
  console.log(`Color birthday: found ${photos.length} reference photo(s) for ${person.key}`);

  let jpegBytes: Uint8Array | null = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      jpegBytes = await callFlux(env, person, style.prompt, photos, currentYear);
      break;
    } catch (err) {
      console.error(`Color birthday FLUX.2 attempt ${attempt + 1} failed:`, err);
      if (attempt === 0) continue;
    }
  }

  if (!jpegBytes) {
    throw new Error("FLUX.2 portrait generation failed after retries");
  }
  return jpegBytes;
}

/**
 * Draw birthday caption bar at the bottom of the image.
 * 24px black bar with white text:
 *   Left: "Happy Birthday!"
 *   Center: "{Name} - {age} years"
 *   Right: "{style name}"
 */
function drawBirthdayCaption(
  buf: Uint8Array,
  name: string,
  age: number,
  styleName: string,
): void {
  const barY = HEIGHT - BAR_H;
  const textH = 8;
  const textY = barY + Math.floor((BAR_H - textH) / 2);

  // Solid black bar
  for (let y = barY; y < HEIGHT; y++) {
    for (let x = 0; x < WIDTH; x++) {
      buf[y * WIDTH + x] = 0;
    }
  }

  // Left: "Happy Birthday!"
  const left = "Happy Birthday!";
  drawText(buf, BAR_PAD, textY, left, 1, 255);

  // Right: style name
  const rightW = measureText(styleName, 1);
  drawText(buf, WIDTH - BAR_PAD - rightW, textY, styleName, 1, 255);

  // Center: "Name - age years"
  const center = `${name} - ${age} years`;
  const locW = measureText(left, 1);
  const locEnd = BAR_PAD + locW;
  const dateStart = WIDTH - BAR_PAD - rightW;
  const gap = 12;
  const availW = dateStart - locEnd - 2 * gap;
  if (availW > 0) {
    let centerText = center;
    while (measureText(centerText, 1) > availW && centerText.length > 3) {
      centerText = centerText.slice(0, -1);
    }
    if (centerText.length < center.length) centerText += "...";
    const centerW = measureText(centerText, 1);
    const centerX = locEnd + gap + Math.floor((availW - centerW) / 2);
    drawText(buf, centerX, textY, centerText, 1, 255);
  }
}
