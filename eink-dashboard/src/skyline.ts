/**
 * World Skyline Series — city/style selection and prompt building.
 *
 * Three modes:
 *   rotate  (default) — city+style change every `rotateMin` minutes via bucket-based hash
 *   daily   — one city+style per calendar day (seeded shuffle)
 *   random  — crypto-random each request (no cache)
 *
 * June 1 (>= 2025) always forces Chicago, USA (style still rotates normally).
 */

export const SKYLINE_SERIES_NAME = "World Skyline Series";

// --- Modes ---
export type SkylineMode = "rotate" | "daily" | "random";
export const DEFAULT_MODE: SkylineMode = "rotate";
export const DEFAULT_ROTATE_MIN = 15;

// --- djb2 hash (match existing project hash style) ---
export function djb2(s: string): number {
  let hash = 5381;
  for (let i = 0; i < s.length; i++) {
    hash = ((hash << 5) + hash + s.charCodeAt(i)) >>> 0;
  }
  return hash;
}

// --- Mulberry32 PRNG (deterministic, seeded) ---
function mulberry32(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// --- Fisher-Yates shuffle with seeded PRNG ---
function shuffleSeeded<T>(arr: readonly T[], seed: number): T[] {
  const result = [...arr];
  const rng = mulberry32(seed);
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

// --- Date helpers (NO Date() usage; deterministic; treats dateStr as local calendar day) ---
export interface SkylineDateParts {
  year: number;
  month: number; // 1-12
  day: number;   // 1-31
  dayOfYear: number; // 1-365/366
  dateStr: string;   // YYYY-MM-DD
  displayDate: string; // "Feb 24, 2026"
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || (year % 400 === 0);
}

function dayOfYearFromYMD(year: number, month: number, day: number): number {
  const monthDays = [31, isLeapYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  let doy = 0;
  for (let m = 1; m < month; m++) doy += monthDays[m - 1];
  doy += day;
  return doy;
}

export function parseDateParts(dateStr: string): SkylineDateParts {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
  if (!m) throw new Error(`Invalid dateStr (expected YYYY-MM-DD): ${dateStr}`);

  const year = parseInt(m[1], 10);
  const month = parseInt(m[2], 10);
  const day = parseInt(m[3], 10);

  const dayOfYear = dayOfYearFromYMD(year, month, day);
  const displayDate = `${MONTHS[month - 1]} ${day}, ${year}`;

  return { year, month, day, dayOfYear, dateStr, displayDate };
}

// --- City list (expand freely; shuffle-per-year prevents "repeat-y" feel) ---
export const SKYLINE_CITIES: readonly string[] = [
  "New York, USA",
  "Chicago, USA",
  "San Francisco, USA",
  "London, UK",
  "Paris, France",
  "Tokyo, Japan",
  "Sydney, Australia",
  "Hong Kong, China",
  "Singapore",
  "Dubai, UAE",
  "Shanghai, China",
  "Seoul, South Korea",
  "Toronto, Canada",
  "Berlin, Germany",
  "Rome, Italy",
  "Barcelona, Spain",
  "Istanbul, Türkiye",
  "Moscow, Russia",
  "Mumbai, India",
  "Bangkok, Thailand",
  "Rio de Janeiro, Brazil",
  "Buenos Aires, Argentina",
  "Cairo, Egypt",
  "Cape Town, South Africa",
  "Mexico City, Mexico",
  "Amsterdam, Netherlands",
  "Vienna, Austria",
  "Prague, Czech Republic",
  "Budapest, Hungary",
  "Lisbon, Portugal",
  "Stockholm, Sweden",
  "Copenhagen, Denmark",
  "Oslo, Norway",
  "Helsinki, Finland",
  "Athens, Greece",
  "Venice, Italy",
  "Florence, Italy",
  "Edinburgh, UK",
  "Dublin, Ireland",
  "Montreal, Canada",
  "Vancouver, Canada",
  "Havana, Cuba",
  "Lima, Peru",
  "Bogotá, Colombia",
  "Santiago, Chile",
  "Marrakech, Morocco",
  "Nairobi, Kenya",
  "Lagos, Nigeria",
  "Taipei, Taiwan",
  "Kuala Lumpur, Malaysia",
  "Jakarta, Indonesia",
  "Hanoi, Vietnam",
  "Manila, Philippines",
  "Delhi, India",
  "Jaipur, India",
  "Kyoto, Japan",
  "Osaka, Japan",
  "Beijing, China",
  "Chongqing, China",
  "Ho Chi Minh City, Vietnam",
  "Melbourne, Australia",
  "Auckland, New Zealand",
  "Zurich, Switzerland",
  "Munich, Germany",
  "Hamburg, Germany",
  "Milan, Italy",
  "Madrid, Spain",
  "Seville, Spain",
  "Marseille, France",
  "Lyon, France",
  "Brussels, Belgium",
  "Warsaw, Poland",
  "Krakow, Poland",
  "Bucharest, Romania",
  "Doha, Qatar",
  "Abu Dhabi, UAE",
  "Tel Aviv, Israel",
  "Johannesburg, South Africa",
  "Casablanca, Morocco",
  "Accra, Ghana",
  "Addis Ababa, Ethiopia",
  "Dar es Salaam, Tanzania",
  "Panama City, Panama",
  "Cartagena, Colombia",
  "Quito, Ecuador",
  "Montevideo, Uruguay",
  "San Juan, Puerto Rico",
  "Reykjavik, Iceland",
  "Tallinn, Estonia",
  "Riga, Latvia",
  "Dubrovnik, Croatia",
  "Porto, Portugal",
  "Bruges, Belgium",
  "Valletta, Malta",
  "Muscat, Oman",
  "Baku, Azerbaijan",
  "Tbilisi, Georgia",
  "Samarkand, Uzbekistan",
  "Kathmandu, Nepal",
  "Colombo, Sri Lanka",
];

// --- Style definitions ---
export type SkylineColorMode = "bw" | "color";

export interface SkylineStyle {
  key: string;
  label: string;
  promptPrefix: string;
  colorMode: SkylineColorMode;
}

export const SKYLINE_STYLES: readonly SkylineStyle[] = [
  // --- BW styles (9) ---
  {
    key: "woodcut_hero_bw",
    label: "Woodcut",
    promptPrefix:
      "hand-carved woodcut print, bold U-gouge marks, high contrast black and white, large solid black ink areas, sweeping curved gouge strokes",
    colorMode: "bw",
  },
  {
    key: "noir_silhouette_bw",
    label: "Noir Silhouette",
    promptPrefix:
      "dramatic film noir silhouette, stark black and white, bold shadow shapes, cinematic contrast, no halftones",
    colorMode: "bw",
  },
  {
    key: "pen_ink_bw",
    label: "Pen & Ink",
    promptPrefix:
      "pen and ink illustration, controlled crosshatching, crisp linework, architectural drawing, high contrast black and white, avoid noisy stipple",
    colorMode: "bw",
  },
  {
    key: "pencil_bw",
    label: "Pencil Sketch",
    promptPrefix:
      "architectural graphite pencil sketch, clean outlines, gentle shading blocks, minimal grain, on white paper",
    colorMode: "bw",
  },
  {
    key: "charcoal_bw",
    label: "Charcoal",
    promptPrefix:
      "dramatic charcoal drawing, expressive strokes, deep shadows, large tonal masses, textured paper, avoid speckled noise",
    colorMode: "bw",
  },
  {
    key: "linocut_bw",
    label: "Linocut",
    promptPrefix:
      "linocut print, bold carved lines, high contrast black and white, simplified forms, chunky strokes, handmade texture",
    colorMode: "bw",
  },
  {
    key: "etching_bw",
    label: "Etching",
    promptPrefix:
      "fine etching engraving, parallel hatching lines, copper plate style, architectural precision, high contrast black and white",
    colorMode: "bw",
  },
  {
    key: "scratchboard_bw",
    label: "Scratchboard",
    promptPrefix:
      "scratchboard illustration, white lines scratched on black surface, dramatic negative space, bold architectural forms",
    colorMode: "bw",
  },
  {
    key: "comic_ink_bw",
    label: "Comic Ink",
    promptPrefix:
      "bold comic book ink illustration, thick outlines, large solid black areas, dynamic composition, high contrast, no halftone dots",
    colorMode: "bw",
  },
  // --- Color styles (9) ---
  {
    key: "travel_poster_color",
    label: "Travel Poster",
    promptPrefix:
      "vintage travel poster illustration, bold flat color fields, simplified geometric shapes, retro graphic design, warm sunset palette, clean edges",
    colorMode: "color",
  },
  {
    key: "wpa_poster_color",
    label: "WPA Poster",
    promptPrefix:
      "WPA poster style, flat screenprint colors, bold simplified shapes, limited palette, minimal texture, high readability",
    colorMode: "color",
  },
  {
    key: "minimal_flat_color",
    label: "Minimal Flat",
    promptPrefix:
      "minimal flat color illustration, clean geometric shapes, large flat color blocks, modern graphic design, simple bold palette, very clean sky",
    colorMode: "color",
  },
  {
    key: "art_deco_poster_color",
    label: "Art Deco",
    promptPrefix:
      "art deco poster, geometric symmetry, gold and bold color accents, streamlined forms, 1920s graphic elegance, flat decorative shapes",
    colorMode: "color",
  },
  {
    key: "screenprint_color",
    label: "Screenprint",
    promptPrefix:
      "screenprint poster, limited color separation, bold overlapping flat shapes, slight registration offset, graphic texture, Andy Warhol inspired",
    colorMode: "color",
  },
  {
    key: "ukiyoe_evening_color",
    label: "Ukiyo-e",
    promptPrefix:
      "ukiyo-e woodblock print, Japanese style, flat color areas, bold outlines, evening sky gradients, Hiroshige inspired landscape",
    colorMode: "color",
  },
  {
    key: "synthwave_sunset_color",
    label: "Synthwave",
    promptPrefix:
      "synthwave retro-futuristic sunset, neon grid horizon, bold magenta and cyan, simplified geometric buildings, 80s aesthetic, flat color bands",
    colorMode: "color",
  },
  {
    key: "mediterranean_travel_color",
    label: "Mediterranean",
    promptPrefix:
      "Mediterranean travel illustration, warm terracotta and blue palette, whitewashed buildings, flat gouache shapes, sun-drenched colors, clean edges",
    colorMode: "color",
  },
];

export function findSkylineStyleByKey(key: string): SkylineStyle | undefined {
  return SKYLINE_STYLES.find((s) => s.key === key);
}

// --- Picker options ---
export interface SkylinePickerOpts {
  mode: SkylineMode;
  rotateMin: number;
  bucket: number; // pre-computed bucket for rotate mode
}

/** Compute the current rotation bucket (minutes since epoch / rotateMin). */
export function computeBucket(rotateMin: number): number {
  return Math.floor(Date.now() / 60000 / rotateMin);
}

// --- City picker ---
export function pickSkylineCity(parts: SkylineDateParts, opts: SkylinePickerOpts): string {
  // June 1 override (>= 2025): Chicago only; STYLE STILL ROTATES NORMALLY
  if (parts.month === 6 && parts.day === 1 && parts.year >= 2025) {
    return "Chicago, USA";
  }

  if (opts.mode === "random") {
    const buf = new Uint32Array(1);
    crypto.getRandomValues(buf);
    return SKYLINE_CITIES[buf[0] % SKYLINE_CITIES.length];
  }

  if (opts.mode === "rotate") {
    // Seed incorporates bucket so city changes every rotateMin minutes
    const seed = djb2(`${parts.dateStr}|city|${opts.bucket}`);
    const shuffled = shuffleSeeded(SKYLINE_CITIES, seed);
    return shuffled[0];
  }

  // mode === "daily"
  const seed = djb2(`${parts.year}|skyline`);
  const shuffled = shuffleSeeded(SKYLINE_CITIES, seed);
  const idx = (parts.dayOfYear - 1) % shuffled.length;
  return shuffled[idx];
}

// --- Style picker (style rotation still applies on June 1) ---
export function pickSkylineStyle(parts: SkylineDateParts, opts: SkylinePickerOpts): SkylineStyle {
  if (opts.mode === "random") {
    const buf = new Uint32Array(1);
    crypto.getRandomValues(buf);
    return SKYLINE_STYLES[buf[0] % SKYLINE_STYLES.length];
  }

  if (opts.mode === "rotate") {
    // Independent seed from city ("|style|" vs "|city|")
    const seed = djb2(`${parts.dateStr}|style|${opts.bucket}`);
    const shuffled = shuffleSeeded(SKYLINE_STYLES, seed);
    return shuffled[0];
  }

  // mode === "daily"
  const seed = djb2(`${parts.year}|skyline-styles`);
  const shuffled = shuffleSeeded(SKYLINE_STYLES, seed);
  const idx = (parts.dayOfYear - 1) % shuffled.length;
  return shuffled[idx];
}

// --- Prompt builder ---
const ANTI_TEXT_SUFFIX =
  "no text, no words, no letters, no writing, no signage, no captions, no watermark";

export function buildSkylinePrompt(city: string, style: SkylineStyle): string {
  const sceneBase =
    `iconic skyline of ${city} viewed from a classic overlook (waterfront or park), ` +
    "strong horizon line, distinct building outlines, large negative space sky occupying upper half, minimal foreground clutter";

  const lighting =
    style.colorMode === "color"
      ? "golden-hour sunset or late afternoon daylight, soft warm sky, clean flat color bands, no gradients"
      : "clear daylight with high readability, no busy sky texture";

  const atmosphere =
    "include ONE simple sun disc or moon disc as a solid shape, 2 to 4 birds as tiny silhouettes, and 1 to 3 large soft cloud shapes; avoid starfields; avoid detailed cloud texture";

  const constraints =
    "avoid tiny window grids, avoid dense micro-detail, avoid noisy textures, avoid photographic realism";

  const paletteHint =
    style.colorMode === "color"
      ? "limited palette, large flat color regions, poster-like, high contrast, avoid tiny details"
      : "";

  const parts: string[] = [style.promptPrefix, sceneBase, lighting, atmosphere, constraints];
  if (paletteHint) parts.push(paletteHint);
  parts.push(ANTI_TEXT_SUFFIX);

  return parts.join(", ");
}

// --- Caption formatter (must match: City | World Skyline Series | Mon DD, YYYY) ---
export function formatSkylineCaption(city: string, displayDate: string): {
  left: string;
  center: string;
  right: string;
} {
  return {
    left: city,
    center: SKYLINE_SERIES_NAME,
    right: displayDate,
  };
}
