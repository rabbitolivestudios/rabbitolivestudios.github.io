/**
 * Style-aware 1-bit conversion styles for Pipeline B (/fact1.png).
 *
 * 6 styles rotating deterministically by date + event.
 * Each style defines its own conversion mode (Bayer dithering or hard threshold)
 * and tone curve parameters tuned for that visual treatment.
 */

import type { MomentBeforeData } from "./types";

export interface OneBitStyleSpec {
  name: string;
  prompt: string;          // purely stylistic — no subject words
  mode: "bayer8" | "threshold";
  contrast: number;
  gamma: number;
  blackMin: number;        // acceptable black ratio range
  blackMax: number;
  targetBlackPct?: number; // threshold mode only — starting percentile
}

export const STYLES_1BIT: OneBitStyleSpec[] = [
  {
    name: "woodcut",
    prompt: "hand-carved woodcut print, linocut relief print, visible U-gouge and V-gouge carving marks, sweeping curved gouge strokes, large solid black ink areas with minimal midtones",
    mode: "bayer8",
    contrast: 1.20,
    gamma: 0.92,
    blackMin: 0.15,
    blackMax: 0.65,
  },
  {
    name: "silhouette_poster",
    prompt: "bold silhouette poster art, stark black shapes on white background, dramatic cutout forms, high contrast with no midtones, paper-cut shadow puppet style",
    mode: "threshold",
    contrast: 1.30,
    gamma: 0.88,
    blackMin: 0.20,
    blackMax: 0.60,
    targetBlackPct: 0.35,
  },
  {
    name: "linocut",
    prompt: "linocut block print, bold carved relief lines, thick black outlines, white gouged areas, hand-printed texture with visible ink coverage",
    mode: "threshold",
    contrast: 1.25,
    gamma: 0.90,
    blackMin: 0.15,
    blackMax: 0.58,
    targetBlackPct: 0.30,
  },
  {
    name: "bold_ink_noir",
    prompt: "bold ink noir illustration, heavy black ink pools, dramatic chiaroscuro, film noir shadows, stark contrast with deep blacks and bright highlights",
    mode: "threshold",
    contrast: 1.35,
    gamma: 0.85,
    blackMin: 0.20,
    blackMax: 0.65,
    targetBlackPct: 0.38,
  },
  {
    name: "pen_and_ink",
    prompt: "detailed pen and ink drawing, fine crosshatching, stipple shading, clean precise line work, black ink on white paper",
    mode: "threshold",
    contrast: 1.15,
    gamma: 0.95,
    blackMin: 0.10,
    blackMax: 0.55,
    targetBlackPct: 0.25,
  },
  {
    name: "charcoal_block",
    prompt: "bold charcoal illustration, strong expressive charcoal strokes, compressed tonal range, large shadow masses, minimal soft gradients, simplified background, dramatic but graphic, designed for high contrast black and white, no fine texture, no grain, no stippling, no halftone dots",
    mode: "threshold",
    contrast: 1.10,
    gamma: 0.97,
    blackMin: 0.18,
    blackMax: 0.55,
    targetBlackPct: 0.24,
  },
];

/** Anti-text suffix appended to all 1-bit prompts. */
export const ANTI_TEXT_SUFFIX = "no text, no words, no letters, no writing, no signage, no captions, no watermark";

/** djb2 string hash → unsigned 32-bit integer. */
export function simpleHash(s: string): number {
  let hash = 5381;
  for (let i = 0; i < s.length; i++) {
    hash = ((hash << 5) + hash + s.charCodeAt(i)) >>> 0;
  }
  return hash;
}

/** Deterministic style pick based on date + event identity. */
export function pick1BitStyle(dateStr: string, moment: MomentBeforeData): OneBitStyleSpec {
  const seed = `${dateStr}|${moment.title}|${moment.location}`;
  const hash = simpleHash(seed);
  return STYLES_1BIT[hash % STYLES_1BIT.length];
}

/** Find a style by name (for test override). Returns first style if not found. */
export function findStyleByName(name: string): OneBitStyleSpec {
  return STYLES_1BIT.find(s => s.name === name) ?? STYLES_1BIT[0];
}
