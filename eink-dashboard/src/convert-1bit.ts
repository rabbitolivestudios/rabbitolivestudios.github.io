/**
 * 1-bit conversion engine for Pipeline B (/fact1.png).
 *
 * Provides tone curve, histogram-based threshold, 8x8 Bayer dithering,
 * black ratio measurement, and a stabilization+guardrail conversion pipeline.
 *
 * Also exports applyToneCurve for Pipeline A usage.
 */

import type { OneBitStyleSpec } from "./styles-1bit";

// --- Tone curve (shared by both pipelines) ---

export function applyToneCurve(gray: Uint8Array, contrast: number, gamma: number): void {
  for (let i = 0; i < gray.length; i++) {
    let x = (gray[i] - 128) * contrast + 128;
    if (x < 0) x = 0;
    if (x > 255) x = 255;
    x = 255 * Math.pow(x / 255, gamma);
    gray[i] = Math.round(x < 0 ? 0 : x > 255 ? 255 : x);
  }
}

// --- Histogram-based threshold ---

/**
 * Compute a binarization threshold from the grayscale histogram.
 * Walk from 0 (black/darkest) upward, accumulating pixel count.
 * When accumulated >= targetCount, that gray value = threshold T.
 * Pixels with gray <= T become black.
 * Clamp T to [100, 220] to avoid extreme results.
 */
export function thresholdFromHistogram(gray: Uint8Array, targetBlackPct: number): number {
  const total = gray.length;
  const targetCount = Math.floor(total * targetBlackPct);

  // Build histogram
  const hist = new Uint32Array(256);
  for (let i = 0; i < total; i++) {
    hist[gray[i]]++;
  }

  // Walk from 0 (black) upward
  let accumulated = 0;
  let T = 0;
  for (let g = 0; g < 256; g++) {
    accumulated += hist[g];
    if (accumulated >= targetCount) {
      T = g;
      break;
    }
  }

  // Clamp to safe range (floor 100 allows darker SDXL output to reduce black coverage)
  if (T < 100) T = 100;
  if (T > 220) T = 220;

  // Sanity check: verify a synthetic ramp binarized with T produces ~targetBlackPct (+-0.02)
  const expectedBlack = (T + 1) / 256; // fraction of [0..255] values <= T
  if (Math.abs(expectedBlack - targetBlackPct) > 0.02) {
    console.warn(`thresholdFromHistogram: synthetic ramp check — expected ~${targetBlackPct.toFixed(3)} black, got ${expectedBlack.toFixed(3)} (T=${T})`);
  }

  return T;
}

// --- 8x8 Bayer ordered dithering ---

// Classic 8x8 Bayer threshold matrix (values 0-63)
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

// Pre-compute normalized thresholds (0-255 range)
const BAYER8_NORM = BAYER8.map(v => (v / 64) * 255);

/** 8x8 Bayer ordered dithering. Returns bits array: 0=black, 1=white. */
export function bayer8Dither(gray: Uint8Array, w: number, h: number): Uint8Array {
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

// --- Hard threshold ---

/** Binarize grayscale with a fixed threshold. 0=black, 1=white. */
export function applyThreshold(gray: Uint8Array, threshold: number): Uint8Array {
  const bits = new Uint8Array(gray.length);
  for (let i = 0; i < gray.length; i++) {
    bits[i] = gray[i] <= threshold ? 0 : 1;
  }
  return bits;
}

// --- Black ratio measurement ---

/** Count black pixels (0) and return ratio. */
export function measureBlackRatio(bits: Uint8Array): number {
  let black = 0;
  for (let i = 0; i < bits.length; i++) {
    if (bits[i] === 0) black++;
  }
  return black / bits.length;
}

// --- Main 1-bit conversion pipeline ---

export interface Convert1BitResult {
  bits: Uint8Array;
  blackRatio: number;
  styleName: string;
}

/**
 * Convert grayscale to 1-bit using a style spec.
 * Includes one stabilization retry and a guardrail fallback.
 * Never mutates the original gray buffer.
 */
export function convert1Bit(
  gray: Uint8Array,
  w: number,
  h: number,
  spec: OneBitStyleSpec,
): Convert1BitResult {
  const gray0 = gray.slice(); // preserve original

  // --- Attempt 1 ---
  let workGray = gray0.slice();
  applyToneCurve(workGray, spec.contrast, spec.gamma);
  let bits = convertWithMode(workGray, w, h, spec);
  let ratio = measureBlackRatio(bits);

  if (ratio >= spec.blackMin && ratio <= spec.blackMax) {
    return { bits, blackRatio: ratio, styleName: spec.name };
  }

  console.log(`Pipeline B: ${spec.name} attempt 1 blackRatio=${ratio.toFixed(3)} outside [${spec.blackMin}, ${spec.blackMax}], retrying`);

  // --- Retry (one attempt) ---
  workGray = gray0.slice();
  let adjustedSpec = { ...spec };

  if (spec.mode === "threshold" && spec.targetBlackPct !== undefined) {
    // Adjust targetBlackPct +-0.04 toward center of [blackMin, blackMax]
    const center = (spec.blackMin + spec.blackMax) / 2;
    const direction = ratio < spec.blackMin ? 1 : -1; // too white → increase, too black → decrease
    let newPct = spec.targetBlackPct + direction * 0.04;
    newPct = Math.max(0.06, Math.min(0.40, newPct));
    adjustedSpec = { ...spec, targetBlackPct: newPct };
  } else {
    // Bayer mode: adjust gamma +-0.06
    // Too black → increase gamma (lighten), too white → decrease gamma (darken)
    const direction = ratio > spec.blackMax ? 1 : -1;
    adjustedSpec = { ...spec, gamma: spec.gamma + direction * 0.06 };
  }

  applyToneCurve(workGray, adjustedSpec.contrast, adjustedSpec.gamma);
  let bits2 = convertWithMode(workGray, w, h, adjustedSpec);
  let ratio2 = measureBlackRatio(bits2);

  if (ratio2 >= spec.blackMin && ratio2 <= spec.blackMax) {
    return { bits: bits2, blackRatio: ratio2, styleName: spec.name };
  }

  console.log(`Pipeline B: ${spec.name} retry blackRatio=${ratio2.toFixed(3)} still outside range`);

  // --- Guardrail fallback (if >0.10 outside range) ---
  const bestRatio = closerToRange(ratio, ratio2, spec.blackMin, spec.blackMax) === ratio ? ratio : ratio2;
  const bestBits = bestRatio === ratio ? bits : bits2;

  const distFromRange = Math.max(0, spec.blackMin - bestRatio, bestRatio - spec.blackMax);
  if (distFromRange > 0.10) {
    console.warn(`Pipeline B guardrail: ${spec.name} ratio ${bestRatio.toFixed(3)} is ${distFromRange.toFixed(3)} outside range, falling back to safe style`);

    workGray = gray0.slice();
    // Pick safe style: threshold→woodcut (index 0, bayer8), bayer8→woodcut (index 0)
    const safeSpec = spec.mode === "threshold"
      ? { name: "woodcut", mode: "bayer8" as const, contrast: 1.20, gamma: 0.92, blackMin: 0.15, blackMax: 0.55, prompt: "" }
      : { name: "woodcut", mode: "bayer8" as const, contrast: 1.20, gamma: 0.92, blackMin: 0.15, blackMax: 0.55, prompt: "" };

    applyToneCurve(workGray, safeSpec.contrast, safeSpec.gamma);
    const safeBits = bayer8Dither(workGray, w, h);
    const safeRatio = measureBlackRatio(safeBits);
    console.warn(`Pipeline B guardrail: fell back to ${safeSpec.name}, blackRatio=${safeRatio.toFixed(3)}`);
    return { bits: safeBits, blackRatio: safeRatio, styleName: `${spec.name}→${safeSpec.name}` };
  }

  // Return best attempt
  return { bits: bestBits, blackRatio: bestRatio, styleName: spec.name };
}

/** Convert grayscale to bits using the spec's mode. */
function convertWithMode(gray: Uint8Array, w: number, h: number, spec: OneBitStyleSpec): Uint8Array {
  if (spec.mode === "bayer8") {
    return bayer8Dither(gray, w, h);
  }
  const T = thresholdFromHistogram(gray, spec.targetBlackPct ?? 0.30);
  return applyThreshold(gray, T);
}

/** Return whichever ratio is closer to the [min, max] range. */
function closerToRange(a: number, b: number, min: number, max: number): number {
  const distA = Math.max(0, min - a, a - max);
  const distB = Math.max(0, min - b, b - max);
  return distA <= distB ? a : b;
}
