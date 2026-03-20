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

// --- City data (30 iconic cities with landmark metadata for prompt enrichment) ---

export interface SkylineCity {
  name: string;       // display name (e.g. "Paris, France")
  key: string;        // R2 folder key (e.g. "paris") — photos stored at skylines/{key}_0.jpg
  landmarks: string;  // comma-separated landmark names injected into prompts
}

export const SKYLINE_CITIES: readonly SkylineCity[] = [
  { name: "New York, USA",           key: "new_york",      landmarks: "Manhattan skyline, Empire State Building, Statue of Liberty, Brooklyn Bridge" },
  { name: "Paris, France",           key: "paris",         landmarks: "Eiffel Tower, Seine River, Notre-Dame Cathedral, Sacré-Cœur" },
  { name: "London, UK",              key: "london",        landmarks: "Big Ben, Tower Bridge, St Paul's Cathedral, Thames River" },
  { name: "Tokyo, Japan",            key: "tokyo",         landmarks: "Tokyo Tower, Senso-ji Temple, Shinjuku skyline, Mount Fuji backdrop" },
  { name: "Sydney, Australia",       key: "sydney",        landmarks: "Sydney Opera House, Harbour Bridge, Circular Quay" },
  { name: "Dubai, UAE",              key: "dubai",         landmarks: "Burj Khalifa, Dubai Marina, Palm Jumeirah" },
  { name: "Hong Kong, China",        key: "hong_kong",     landmarks: "Victoria Harbour, Bank of China Tower, dense waterfront skyline" },
  { name: "Singapore",               key: "singapore",     landmarks: "Marina Bay Sands, Merlion, Gardens by the Bay supertrees" },
  { name: "Rome, Italy",             key: "rome",          landmarks: "Colosseum, St. Peter's Basilica dome, Roman Forum ruins" },
  { name: "Barcelona, Spain",        key: "barcelona",     landmarks: "Sagrada Familia, Park Güell mosaics, Mediterranean waterfront" },
  { name: "San Francisco, USA",      key: "san_francisco", landmarks: "Golden Gate Bridge, Painted Ladies, Transamerica Pyramid" },
  { name: "Chicago, USA",            key: "chicago",       landmarks: "Willis Tower, Cloud Gate, Lake Michigan lakefront skyline" },
  { name: "Istanbul, Türkiye",       key: "istanbul",      landmarks: "Hagia Sophia, Blue Mosque, Bosphorus strait, minarets" },
  { name: "Rio de Janeiro, Brazil",  key: "rio",           landmarks: "Christ the Redeemer statue, Sugarloaf Mountain, Copacabana beach" },
  { name: "Cairo, Egypt",            key: "cairo",         landmarks: "Great Pyramids of Giza, Sphinx, Nile River" },
  { name: "Shanghai, China",         key: "shanghai",      landmarks: "The Bund waterfront, Oriental Pearl Tower, Pudong skyline" },
  { name: "Moscow, Russia",          key: "moscow",        landmarks: "St. Basil's Cathedral, Red Square, Kremlin walls" },
  { name: "Buenos Aires, Argentina", key: "buenos_aires",  landmarks: "Obelisco, Casa Rosada, La Boca colorful houses" },
  { name: "Bangkok, Thailand",       key: "bangkok",       landmarks: "Grand Palace, Wat Arun temple, Chao Phraya River" },
  { name: "Venice, Italy",           key: "venice",        landmarks: "Grand Canal, Rialto Bridge, St. Mark's Basilica, gondolas" },
  { name: "Prague, Czech Republic",  key: "prague",        landmarks: "Charles Bridge, Prague Castle, Old Town astronomical clock" },
  { name: "Cape Town, South Africa", key: "cape_town",     landmarks: "Table Mountain, V&A Waterfront, Signal Hill" },
  { name: "Kyoto, Japan",            key: "kyoto",         landmarks: "Kinkaku-ji golden temple, Fushimi Inari torii gates, bamboo grove" },
  { name: "Athens, Greece",          key: "athens",        landmarks: "Acropolis, Parthenon, ancient columns against modern city" },
  { name: "Havana, Cuba",            key: "havana",        landmarks: "Malecón seawall, Capitol Building, vintage cars, colonial facades" },
  { name: "Marrakech, Morocco",      key: "marrakech",     landmarks: "Koutoubia Mosque minaret, Djemaa el-Fna square, red clay walls" },
  { name: "Seoul, South Korea",      key: "seoul",         landmarks: "N Seoul Tower, Gyeongbokgung Palace, Bukchon hanok village" },
  { name: "Amsterdam, Netherlands",  key: "amsterdam",     landmarks: "canal houses, Rijksmuseum, narrow gabled facades, houseboats" },
  { name: "Mumbai, India",           key: "mumbai",        landmarks: "Gateway of India arch, Marine Drive, Taj Mahal Palace Hotel" },
  { name: "Mexico City, Mexico",     key: "mexico_city",   landmarks: "Angel of Independence, Palacio de Bellas Artes, Zócalo plaza" },
];

/** Look up a city by name or key (for test endpoint overrides). */
export function findSkylineCity(query: string): SkylineCity | undefined {
  const q = query.toLowerCase();
  return SKYLINE_CITIES.find(
    (c) => c.name.toLowerCase() === q || c.key === q,
  );
}

// --- Style definitions ---
export type SkylineColorMode = "bw" | "color";

export interface SkylineStyle {
  key: string;
  label: string;
  promptPrefix: string;
  colorMode: SkylineColorMode;
}

export const SKYLINE_STYLES: readonly SkylineStyle[] = [
  // --- BW styles (6) — bold, high-contrast only (pencil/etching/pen_ink removed: too many mid-tones for 4-level grayscale) ---
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
    key: "linocut_bw",
    label: "Linocut",
    promptPrefix:
      "linocut print, bold carved lines, high contrast black and white, simplified forms, chunky strokes, handmade texture",
    colorMode: "bw",
  },
  {
    key: "comic_ink_bw",
    label: "Comic Ink",
    promptPrefix:
      "bold comic book ink illustration, thick outlines, large solid black areas, dynamic composition, high contrast, no halftone dots",
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
    key: "charcoal_bw",
    label: "Dark Charcoal",
    promptPrefix:
      "bold charcoal drawing, heavy black strokes, stark contrast, large solid dark masses, minimal mid-tones, dramatic shadows, no subtle gradients, no speckled noise",
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
  colorModeFilter?: "bw" | "color"; // restrict style pool (undefined = all styles)
}

/** Compute the current rotation bucket (minutes since epoch / rotateMin). */
export function computeBucket(rotateMin: number): number {
  return Math.floor(Date.now() / 60000 / rotateMin);
}

// --- City picker ---
const CHICAGO_CITY = SKYLINE_CITIES.find((c) => c.key === "chicago")!;

export function pickSkylineCity(parts: SkylineDateParts, opts: SkylinePickerOpts): SkylineCity {
  // June 1 override (>= 2025): Chicago only; STYLE STILL ROTATES NORMALLY
  if (parts.month === 6 && parts.day === 1 && parts.year >= 2025) {
    return CHICAGO_CITY;
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
  const pool: readonly SkylineStyle[] = opts.colorModeFilter
    ? SKYLINE_STYLES.filter((s) => s.colorMode === opts.colorModeFilter)
    : SKYLINE_STYLES;

  if (opts.mode === "random") {
    const buf = new Uint32Array(1);
    crypto.getRandomValues(buf);
    return pool[buf[0] % pool.length];
  }

  if (opts.mode === "rotate") {
    // Independent seed from city ("|style|" vs "|city|")
    const seed = djb2(`${parts.dateStr}|style|${opts.bucket}`);
    const shuffled = shuffleSeeded(pool, seed);
    return shuffled[0];
  }

  // mode === "daily"
  const seed = djb2(`${parts.year}|skyline-styles`);
  const shuffled = shuffleSeeded(pool, seed);
  const idx = (parts.dayOfYear - 1) % shuffled.length;
  return shuffled[idx];
}

// --- Prompt builder ---
const ANTI_TEXT_SUFFIX =
  "no text, no words, no letters, no writing, no signage, no captions, no watermark";

/**
 * Build prompt for text-only generation (SDXL fallback, no reference photo).
 */
export function buildSkylinePrompt(city: SkylineCity, style: SkylineStyle): string {
  const sceneBase =
    `iconic skyline of ${city.name} featuring ${city.landmarks}, ` +
    "viewed from a classic overlook (waterfront or park), " +
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

/**
 * Build prompt for FLUX.2 generation WITH a reference photo (input_image_0).
 * The reference anchors the composition; the style prompt handles artistic reinterpretation.
 */
export function buildSkylineRefPrompt(city: SkylineCity, style: SkylineStyle): string {
  const scene =
    `artistic reinterpretation of the scene in image 0 as an iconic ${city.name} skyline, ` +
    `featuring ${city.landmarks}, ` +
    "strong horizon line, distinct building outlines, large negative space sky";

  const lighting =
    style.colorMode === "color"
      ? "golden-hour sunset or late afternoon daylight, soft warm sky"
      : "clear daylight with high readability";

  const constraints =
    "avoid tiny window grids, avoid dense micro-detail, avoid photographic realism";

  const paletteHint =
    style.colorMode === "color"
      ? "limited palette, large flat color regions, poster-like, high contrast"
      : "";

  const parts: string[] = [style.promptPrefix, scene, lighting, constraints];
  if (paletteHint) parts.push(paletteHint);
  parts.push(ANTI_TEXT_SUFFIX);

  return parts.join(", ");
}

// --- Caption formatter (must match: City | World Skyline Series | Mon DD, YYYY) ---
export function formatSkylineCaption(city: SkylineCity, displayDate: string): {
  left: string;
  center: string;
  right: string;
} {
  return {
    left: city.name,
    center: SKYLINE_SERIES_NAME,
    right: displayDate,
  };
}
