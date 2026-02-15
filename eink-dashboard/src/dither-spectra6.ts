/**
 * Floyd-Steinberg dithering engine for Spectra 6 palette.
 *
 * Converts an RGB image to palette indices using error diffusion.
 * Designed for the E Ink Spectra 6 display (6 native pigment colors).
 */

/**
 * Find the nearest palette color by Euclidean RGB distance.
 * Returns the palette index (0-5).
 */
export function findNearestColor(
  r: number,
  g: number,
  b: number,
  palette: [number, number, number][]
): number {
  let bestIdx = 0;
  let bestDist = Infinity;

  for (let i = 0; i < palette.length; i++) {
    const dr = r - palette[i][0];
    const dg = g - palette[i][1];
    const db = b - palette[i][2];
    const dist = dr * dr + dg * dg + db * db;
    if (dist < bestDist) {
      bestDist = dist;
      bestIdx = i;
    }
  }

  return bestIdx;
}

/**
 * Floyd-Steinberg dithering to a fixed palette.
 *
 * @param rgb - RGB pixel data, 3 bytes per pixel, row-major
 * @param w - image width
 * @param h - image height
 * @param palette - array of [R, G, B] palette colors
 * @returns Uint8Array of palette indices (0 to palette.length-1), one per pixel
 */
export function ditherFloydSteinberg(
  rgb: Uint8Array,
  w: number,
  h: number,
  palette: [number, number, number][]
): Uint8Array {
  // Work on a float copy to accumulate error diffusion
  const buf = new Float32Array(w * h * 3);
  for (let i = 0; i < rgb.length; i++) {
    buf[i] = rgb[i];
  }

  const indices = new Uint8Array(w * h);

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = (y * w + x) * 3;
      const oldR = buf[idx];
      const oldG = buf[idx + 1];
      const oldB = buf[idx + 2];

      // Find nearest palette color
      const palIdx = findNearestColor(oldR, oldG, oldB, palette);
      indices[y * w + x] = palIdx;

      // Compute quantization error
      const newR = palette[palIdx][0];
      const newG = palette[palIdx][1];
      const newB = palette[palIdx][2];
      const errR = oldR - newR;
      const errG = oldG - newG;
      const errB = oldB - newB;

      // Distribute error to neighbors
      // Right: 7/16
      if (x + 1 < w) {
        const ri = idx + 3;
        buf[ri] += errR * 7 / 16;
        buf[ri + 1] += errG * 7 / 16;
        buf[ri + 2] += errB * 7 / 16;
      }
      // Below-left: 3/16
      if (y + 1 < h && x - 1 >= 0) {
        const ri = ((y + 1) * w + (x - 1)) * 3;
        buf[ri] += errR * 3 / 16;
        buf[ri + 1] += errG * 3 / 16;
        buf[ri + 2] += errB * 3 / 16;
      }
      // Below: 5/16
      if (y + 1 < h) {
        const ri = ((y + 1) * w + x) * 3;
        buf[ri] += errR * 5 / 16;
        buf[ri + 1] += errG * 5 / 16;
        buf[ri + 2] += errB * 5 / 16;
      }
      // Below-right: 1/16
      if (y + 1 < h && x + 1 < w) {
        const ri = ((y + 1) * w + (x + 1)) * 3;
        buf[ri] += errR / 16;
        buf[ri + 1] += errG / 16;
        buf[ri + 2] += errB / 16;
      }
    }
  }

  return indices;
}

/**
 * Posterize RGB: reduce per-channel levels before dithering.
 * Useful for birthday portraits to simplify tonal range.
 *
 * @param rgb - RGB pixel data (modified in place)
 * @param levels - number of levels per channel (e.g., 6)
 */
export function posterizeRGB(rgb: Uint8Array, levels: number): void {
  const step = 255 / (levels - 1);
  for (let i = 0; i < rgb.length; i++) {
    rgb[i] = Math.round(Math.round(rgb[i] / step) * step);
  }
}
