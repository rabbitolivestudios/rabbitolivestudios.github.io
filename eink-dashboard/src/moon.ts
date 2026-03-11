/**
 * Pure moon phase calculator — no API, no cache.
 *
 * Uses the synodic period (29.53059 days) from a known new moon
 * reference to compute the current phase for any date.
 */

/** Known new moon reference: January 6, 2000 18:14 UTC */
const REF_NEW_MOON_MS = Date.UTC(2000, 0, 6, 18, 14, 0);
const SYNODIC_PERIOD = 29.53059;

const PHASE_NAMES = [
  "New Moon",
  "Waxing Crescent",
  "First Quarter",
  "Waxing Gibbous",
  "Full Moon",
  "Waning Gibbous",
  "Last Quarter",
  "Waning Crescent",
] as const;

export interface MoonPhase {
  /** Phase index 0-7 */
  index: number;
  /** Human-readable phase name */
  name: string;
  /** Approximate illumination percentage 0-100 */
  illumination: number;
}

/** Compute moon phase for a given date (Chicago timezone). */
export function getMoonPhase(date: Date): MoonPhase {
  // Use Chicago noon to avoid boundary issues
  const chicago = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(date);
  const pv = (t: string) => chicago.find(x => x.type === t)!.value;
  const noonUTC = Date.UTC(
    parseInt(pv("year")), parseInt(pv("month")) - 1, parseInt(pv("day")),
    18, 0, 0, // ~noon Chicago in UTC
  );

  const elapsed = (noonUTC - REF_NEW_MOON_MS) / 86400000;
  const daysIntoCycle = ((elapsed % SYNODIC_PERIOD) + SYNODIC_PERIOD) % SYNODIC_PERIOD;
  const index = Math.floor((daysIntoCycle / SYNODIC_PERIOD) * 8) % 8;
  const illumination = Math.round(
    (1 - Math.cos(2 * Math.PI * daysIntoCycle / SYNODIC_PERIOD)) / 2 * 100,
  );

  return { index, name: PHASE_NAMES[index], illumination };
}

/**
 * Generate an inline SVG moon icon for a given phase index.
 *
 * @param index Phase index 0-7
 * @param litColor Fill color for the illuminated surface
 * @param shadowColor Fill color for the shadow
 */
export function moonSVG(index: number, litColor: string, shadowColor: string): string {
  // Circle center and radius
  const cx = 16, cy = 16, r = 12;

  if (index === 0) {
    // New Moon — all shadow
    return `<svg viewBox="0 0 32 32"><circle cx="${cx}" cy="${cy}" r="${r}" fill="${shadowColor}"/></svg>`;
  }
  if (index === 4) {
    // Full Moon — all lit
    return `<svg viewBox="0 0 32 32"><circle cx="${cx}" cy="${cy}" r="${r}" fill="${litColor}" stroke="${shadowColor}" stroke-width="1.5"/></svg>`;
  }

  // For other phases, draw a lit circle + shadow half using two arcs.
  // The terminator is an ellipse with varying rx.
  // Waxing: right side lit (shadow on left)
  // Waning: left side lit (shadow on right)

  const isWaxing = index < 4;
  // How far into the half-cycle (0 = new, 1 = full)
  const t = index < 4 ? index / 4 : (8 - index) / 4;
  // rx of the terminator ellipse: 0 = half, r = full/new
  const rx = Math.abs(2 * t - 1) * r;
  // Sweep direction for the terminator arc
  const bulge = t > 0.5; // terminator bulges toward lit side

  // Build the shadow path:
  // Arc from top to bottom on one side, terminator arc back
  let shadowPath: string;
  if (isWaxing) {
    // Shadow on left side
    const leftArc = `M${cx} ${cy - r} A${r} ${r} 0 0 0 ${cx} ${cy + r}`;
    const termArc = `A${rx} ${r} 0 0 ${bulge ? 0 : 1} ${cx} ${cy - r}`;
    shadowPath = `${leftArc} ${termArc} Z`;
  } else {
    // Shadow on right side
    const rightArc = `M${cx} ${cy - r} A${r} ${r} 0 0 1 ${cx} ${cy + r}`;
    const termArc = `A${rx} ${r} 0 0 ${bulge ? 1 : 0} ${cx} ${cy - r}`;
    shadowPath = `${rightArc} ${termArc} Z`;
  }

  return `<svg viewBox="0 0 32 32"><circle cx="${cx}" cy="${cy}" r="${r}" fill="${litColor}" stroke="${shadowColor}" stroke-width="1"/><path d="${shadowPath}" fill="${shadowColor}"/></svg>`;
}
