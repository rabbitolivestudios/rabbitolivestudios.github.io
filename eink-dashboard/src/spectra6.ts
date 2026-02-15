/**
 * Seeed reTerminal E1002 — Spectra 6 color palette.
 *
 * The E Ink Spectra 6 panel has 6 native pigment colors.
 * These are measured sRGB values for the actual ink pigments.
 */

export const BLACK = 0;
export const WHITE = 1;
export const RED = 2;
export const YELLOW = 3;
export const GREEN = 4;
export const BLUE = 5;

export const SPECTRA6_PALETTE: [number, number, number][] = [
  [0, 0, 0],         // black
  [255, 255, 255],   // white
  [178, 19, 24],     // red
  [239, 222, 68],    // yellow
  [18, 95, 32],      // green
  [33, 87, 186],     // blue
];

export const SPECTRA6_NAMES = ["black", "white", "red", "yellow", "green", "blue"] as const;

/** CSS custom properties for color HTML pages. */
export function spectra6CSS(): string {
  return `
    --s6-black: rgb(0, 0, 0);
    --s6-white: rgb(255, 255, 255);
    --s6-red: rgb(178, 19, 24);
    --s6-yellow: rgb(239, 222, 68);
    --s6-green: rgb(18, 95, 32);
    --s6-blue: rgb(33, 87, 186);
  `;
}
