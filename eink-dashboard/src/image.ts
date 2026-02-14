/**
 * Generates an 800x480 1-bit "woodcut/engraving" style PNG card
 * for the daily "On This Day" fact, optimized for e-ink display.
 */

import { encodePNG1Bit } from "./png";
import { drawText, drawTextCentered, drawTextWrapped, measureText } from "./font";
import type { FactResponse } from "./types";

const WIDTH = 800;
const HEIGHT = 480;

/**
 * Simple seeded PRNG (mulberry32) for deterministic noise per date.
 */
function mulberry32(seed: number): () => number {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashDate(dateStr: string): number {
  let h = 0;
  for (let i = 0; i < dateStr.length; i++) {
    h = ((h << 5) - h + dateStr.charCodeAt(i)) | 0;
  }
  return h;
}

/**
 * Draw stipple noise on the background for a "paper texture" effect.
 * Density is ~1.5% of pixels flipped to black.
 */
function drawStippleNoise(buf: Uint8Array, dateStr: string): void {
  const rng = mulberry32(hashDate(dateStr));
  const innerMargin = 20;
  for (let y = innerMargin; y < HEIGHT - innerMargin; y++) {
    for (let x = innerMargin; x < WIDTH - innerMargin; x++) {
      if (rng() < 0.015) {
        buf[y * WIDTH + x] = 0; // black dot
      }
    }
  }
}

/**
 * Draw a hatched border frame (cross-hatch pattern).
 * Creates an engraved border effect.
 */
function drawBorder(buf: Uint8Array): void {
  const outerMargin = 8;
  const borderWidth = 12;
  const innerEdge = outerMargin + borderWidth;

  for (let y = outerMargin; y < HEIGHT - outerMargin; y++) {
    for (let x = outerMargin; x < WIDTH - outerMargin; x++) {
      const inBorder =
        y < innerEdge ||
        y >= HEIGHT - innerEdge ||
        x < innerEdge ||
        x >= WIDTH - innerEdge;

      if (inBorder) {
        // Cross-hatch pattern: diagonal lines every 3 pixels
        const diag1 = (x + y) % 3 === 0;
        const diag2 = (x - y + 300) % 3 === 0;
        if (diag1 || diag2) {
          buf[y * WIDTH + x] = 0; // black
        }
      }
    }
  }

  // Solid inner border line (1px)
  const lineY1 = innerEdge;
  const lineY2 = HEIGHT - innerEdge - 1;
  const lineX1 = innerEdge;
  const lineX2 = WIDTH - innerEdge - 1;

  for (let x = outerMargin; x < WIDTH - outerMargin; x++) {
    buf[lineY1 * WIDTH + x] = 0;
    buf[lineY2 * WIDTH + x] = 0;
  }
  for (let y = outerMargin; y < HEIGHT - outerMargin; y++) {
    buf[y * WIDTH + lineX1] = 0;
    buf[y * WIDTH + lineX2] = 0;
  }
}

/**
 * Draw a decorative horizontal rule with engraved line pattern.
 */
function drawRule(buf: Uint8Array, y: number, xStart: number, xEnd: number): void {
  // Three lines: thin, thick, thin
  for (let x = xStart; x < xEnd; x++) {
    // Top thin line
    if ((x + y) % 2 === 0) buf[y * WIDTH + x] = 0;
    // Middle solid line
    buf[(y + 2) * WIDTH + x] = 0;
    buf[(y + 3) * WIDTH + x] = 0;
    // Bottom thin line
    if ((x + y) % 2 === 0) buf[(y + 5) * WIDTH + x] = 0;
  }
}

/**
 * Draw corner ornaments — small decorative flourishes.
 */
function drawCornerOrnaments(buf: Uint8Array): void {
  const margin = 26;
  const size = 20;

  // Positions: four corners inside the border
  const corners = [
    { x: margin, y: margin, dx: 1, dy: 1 },
    { x: WIDTH - margin - size, y: margin, dx: -1, dy: 1 },
    { x: margin, y: HEIGHT - margin - size, dx: 1, dy: -1 },
    { x: WIDTH - margin - size, y: HEIGHT - margin - size, dx: -1, dy: -1 },
  ];

  for (const c of corners) {
    // Draw a small diamond/cross pattern
    for (let i = 0; i < size; i++) {
      const px1 = c.x + i;
      const py1 = c.y + i;
      const px2 = c.x + i;
      const py2 = c.y + size - 1 - i;
      if (px1 < WIDTH && py1 < HEIGHT) buf[py1 * WIDTH + px1] = 0;
      if (px2 < WIDTH && py2 >= 0 && py2 < HEIGHT) buf[py2 * WIDTH + px2] = 0;
    }
  }
}

export async function generateFactImage(fact: FactResponse): Promise<Uint8Array> {
  // Create buffer: all white (1)
  const buf = new Uint8Array(WIDTH * HEIGHT);
  buf.fill(1);

  const contentLeft = 40;
  const contentRight = WIDTH - 40;
  const contentWidth = contentRight - contentLeft;

  // 1. Stipple noise background (deterministic per date)
  drawStippleNoise(buf, fact.date);

  // 2. Hatched border frame
  drawBorder(buf);

  // 3. Corner ornaments
  drawCornerOrnaments(buf);

  // 4. Title: "ON THIS DAY" — scale 3 (24px tall)
  let cursorY = 50;
  drawTextCentered(buf, WIDTH, HEIGHT, cursorY, "ON THIS DAY", 3, contentLeft, contentRight);
  cursorY += 30; // 24px text + 6px spacing

  // 5. Decorative rule under title
  const ruleLeft = contentLeft + 60;
  const ruleRight = contentRight - 60;
  drawRule(buf, cursorY, ruleLeft, ruleRight);
  cursorY += 20;

  // 6. Date line — scale 3 (24px tall)
  drawTextCentered(buf, WIDTH, HEIGHT, cursorY, fact.display_date, 3, contentLeft, contentRight);
  cursorY += 40;

  // 7. Second decorative rule
  drawRule(buf, cursorY, ruleLeft, ruleRight);
  cursorY += 24;

  // 8. Main event text: "YEAR — text" — scale 2 (16px tall)
  const eventText = `${fact.event.year} -- ${fact.event.text}`;
  cursorY = drawTextWrapped(
    buf, WIDTH, HEIGHT,
    contentLeft + 20, cursorY,
    eventText,
    2,                          // scale 2 = 16px tall
    contentWidth - 40,          // max width with inner padding
    3                           // line spacing
  );

  // 9. Footer: source — scale 1 (8px tall), bottom-aligned
  const footerY = HEIGHT - 42;
  drawTextCentered(buf, WIDTH, HEIGHT, footerY, "Source: Wikipedia", 1, contentLeft, contentRight);

  // 10. Small separator above footer
  const sepLeft = contentLeft + 200;
  const sepRight = contentRight - 200;
  for (let x = sepLeft; x < sepRight; x++) {
    if (x % 3 !== 0) {
      buf[(footerY - 8) * WIDTH + x] = 0;
    }
  }

  // Encode to PNG
  return encodePNG1Bit(buf, WIDTH, HEIGHT);
}
