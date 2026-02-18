# Architecture & Design Decisions

This document records the key decisions made during development of the "Moment Before" e-ink dashboard, including what we tried, what failed, and why we landed where we did.

---

## 1. Image Generation Models

### Decision: FLUX.2 klein-9b (Pipeline A) + SDXL (Pipeline B + fallback)

**Tried:**
| Model | Result |
|-------|--------|
| `flux-1-schnell` (4 steps) | Fast but low quality, washed-out details |
| `flux-2-dev` (20 steps) | Stunning ink illustrations, rich detail — but requires multipart FormData API |
| `stable-diffusion-xl-base-1.0` (20 steps) | Great woodcut/linocut style, simpler JSON API |
| **`flux-2-klein-9b` (4 steps)** | **Better illustrations than SDXL, fast (distilled), multipart FormData API** |

**v3.1.0 change — FLUX.2 for Pipeline A:**
- FLUX.2 klein-9b produces better, more detailed illustrations than SDXL
- Steps fixed at 4 (distilled model) — faster than SDXL's 20 steps
- Requires multipart FormData API (same as birthday portraits)
- Falls back to SDXL with woodcut style if FLUX.2 fails twice
- Pipeline B stays on SDXL — the Bayer dithered output works well with SDXL's woodcut style

**SDXL (Pipeline B + fallback):**
- `@cf/stabilityai/stable-diffusion-xl-base-1.0` on Workers AI
- 20 steps is the Workers AI maximum (steps > 20 causes error 5006)
- Uses standard JSON API
- Does NOT support `negative_prompt` — all style constraints must be embedded in the positive prompt

---

## 2. Art Style: Daily Rotation + Scene-Only Prompts

### Decision: LLM writes scene-only prompts; style prepended per-pipeline

**v3.1.0 change — scene-only LLM + per-pipeline style:**
- Previously, the LLM `SYSTEM_PROMPT` baked woodcut style into the image prompt
- Now the LLM writes scene-only prompts (subject, setting, lighting, mood — no rendering technique)
- Each pipeline prepends its own style: Pipeline A rotates daily, Pipeline B uses hardcoded woodcut
- This is cleaner — style is a rendering concern, not an LLM concern

**Pipeline A daily rotation** (`dayOfYear % 3`):

| # | Style | Prompt prefix |
|---|-------|---------------|
| 0 | Woodcut | `hand-carved woodcut print, bold U-gouge marks, high contrast black and white, sweeping curved gouge strokes, large solid black ink areas with minimal midtones` |
| 1 | Pencil Sketch | `detailed graphite pencil sketch, fine cross-hatching, full tonal range, on white paper` |
| 2 | Charcoal | `dramatic charcoal drawing, expressive strokes, deep shadows, textured paper` |

**Pipeline B 6-style rotation** (v3.3.0, deterministic via `djb2(date|title|location) % 6`):

| # | Style | Mode | Notes |
|---|-------|------|-------|
| 0 | Woodcut | bayer8 | Same as before — bold gouge strokes, the proven default |
| 1 | Silhouette Poster | threshold | Stark cutout shapes, paper-cut shadow puppet feel |
| 2 | Linocut | threshold | Bold carved relief, thick outlines, hand-printed texture |
| 3 | Bold Ink Noir | threshold | Film noir, heavy ink pools, dramatic chiaroscuro |
| 4 | Pen & Ink | threshold | Fine crosshatching, stipple shading, precise lines |
| 5 | Charcoal Block | threshold | Expressive strokes, large shadow masses, graphic feel |

Each style specifies its own conversion mode (Bayer dithering or histogram-percentile threshold), tone curve, and acceptable black ratio range. A stabilization retry + guardrail fallback to woodcut/bayer8 keeps results consistent.

**Anti-text suffix** appended to all prompts: `"no text, no words, no letters, no writing, no signage, no captions, no watermark"`

**Previous style exploration (still relevant):**

| Style | Result on e-ink |
|-------|-----------------|
| Graphite pencil with soft shading | Beautiful raw image, but terrible after any 1-bit conversion — "dot soup" |
| Black ink pen editorial illustration | Good cross-hatching, but lighter prompts looked too faint on the display |
| Lighter ink ("plenty of white space, avoid solid black") | Too faint on e-ink — bold style reads much better |
| Etch-A-Sketch / minimalist cityscape | Style keywords hijacked the scene — model generated generic cityscapes regardless of historical event |
| **Woodcut / linocut with gouge strokes** | **Perfect — bold, high-contrast, dramatic, reads beautifully on e-ink** |

**Why woodcut remains the default (Pipeline B and fallback):**
- Inherently high-contrast: solid black ink areas with carved white channels
- "Sweeping curved gouge strokes" creates organic texture (not mechanical hatching)
- "Large solid black ink areas with minimal midtones" translates perfectly to e-ink
- Works for both 4-level grayscale (quantized tonal regions) and 1-bit dithered (dot texture)
- Bold style with solid blacks looks BETTER on e-ink than lighter/delicate alternatives

---

## 3. Two Output Pipelines

### Decision: Dual pipeline — 4-level grayscale + 1-bit Bayer dithered

The project produces two versions of each day's image:

| Endpoint | Pipeline | Output | Use case |
|----------|----------|--------|----------|
| `/fact.png` | Pipeline A | 4-level grayscale (8-bit PNG) | Displays with grayscale support |
| `/fact1.png` | Pipeline B | 1-bit Bayer dithered (1-bit PNG) | Mono e-ink displays |

Both pipelines share the same LLM event selection (scene-only prompts), but each prepends its own art style, uses its own image model, and makes its own LLM + AI call (different events are possible). They diverge at style injection and post-processing:

**Pipeline A (4-level):**
1. Prepend daily style → FLUX.2 klein-9b → grayscale → caption (24px black bar, white text) → tone curve (1.2, 0.95) → quantize to 4 levels (0, 85, 170, 255) → 8-bit PNG

**Pipeline B (1-bit, v3.3.0 — style-aware):**
1. Pick style (djb2 hash of date+title+location % 6) → prepend style prompt → SDXL → grayscale → style-aware 1-bit conversion (Bayer or histogram threshold, with stabilization retry + guardrail fallback) → caption (16px white strip, black text) → 1-bit PNG

**Why two pipelines:**
- Some e-ink displays are mono-only and handle their own grayscale-to-mono conversion poorly (muddy results)
- Pre-dithering with Bayer produces a clean, deterministic dot pattern optimized for e-ink
- The 4-level version preserves more tonal information for displays that can use it

---

## 4. 1-Bit Conversion: Style-Aware (Bayer + Histogram Threshold)

### Decision: Style-aware conversion with Bayer 8×8 or histogram-percentile threshold

This was the hardest technical challenge. We tried 7 different approaches before finding Bayer dithering worked well. In v3.3.0, we added histogram-percentile threshold as a second mode — some styles (silhouettes, linocut, noir) suit hard threshold better than dithering, while woodcut and charcoal suit Bayer's dot texture.

**Approaches tried and abandoned (in order):**

| # | Approach | Result | Why it failed |
|---|----------|--------|---------------|
| 1 | Floyd-Steinberg dithering | Ugly dot patterns, "dot soup" | E-ink display does its own dithering — pre-dithering doubles the artifacts |
| 2 | Etch-A-Sketch style (SDXL) | Generic modern cityscapes | "Minimalist cityscape" keywords hijacked the scene content |
| 3 | Pen & ink / coloring book prompts (SDXL) | Black blobs after threshold | SDXL fundamentally cannot generate true line art — always produces tonal images |
| 4 | Sobel edge detection pipeline | Too noisy or too chunky | Deterministic edge extraction can't distinguish meaningful edges from texture noise |
| 5 | Style rotation (woodcut, scratchboard, linocut, pen_ink, silhouette) | Abstract cubist shapes | Style keywords (especially "linocut", "bold shapes") overpowered scene content |
| 6 | Hard threshold with auto-adjustment | Heavy black blobs, no midtones | Lost all tonal information — posterized silhouettes, not illustrations |
| 7 | Pen & ink style injection with scene from 4-level LLM | Good but less stable | Finer crosshatching detail, but user preferred deterministic dot texture |

**Why Bayer 8×8 wins:**
- **Deterministic**: same input always produces the same output (no randomness)
- **Stable dot pattern**: regular, repeating grid — ideal for e-ink (no noise)
- **Preserves full tonal range**: maps gray levels to dot density, maintaining gradients
- **Vintage aesthetic**: produces a classic halftone/newspaper look
- **No scene corruption**: uses the same rich SDXL image as Pipeline A — no style injection needed

**Implementation (v3.3.0 — style-aware):**

Two conversion modes, selected per style:

```
Bayer mode (woodcut):
  Classic 8×8 Bayer threshold matrix (64 unique values, 0–63), normalized to 0–255
  For each pixel: output = gray[x,y] > bayer_threshold[x%8, y%8] ? white : black
  Tone curve applied BEFORE dithering to preserve midtones

Threshold mode (silhouette, linocut, noir, pen_and_ink, charcoal_block):
  Build histogram[256], walk from 0 (black) upward accumulating pixel count
  When accumulated >= targetCount (floor(totalPixels * targetBlackPct)), that gray value = threshold T
  Clamp T to [100, 220] — floor of 100 allows reducing black on dark SDXL output
  Binarize: gray[i] <= T → black, else white

Caption drawn AFTER conversion so text stays crisp (not dithered/thresholded).
```

**Stabilization pipeline (`convert1Bit`):**
1. First attempt with style's tone curve + conversion mode
2. If black ratio outside [blackMin, blackMax]: retry once with adjusted params (±0.04 targetBlackPct or ±0.06 gamma)
3. If still >0.10 outside range: guardrail fallback to woodcut/bayer8

**Key technical bugs encountered:**
- **Auto-threshold direction inversion**: `gray[i] < thresh` = black, so LOWER threshold = fewer black pixels. Initial implementation raised threshold when image was too dark — made it worse.
- **Caption overlap**: Title centered across full 800px width collided with long location text. Fixed by centering title in the gap between location-end and date-start.
- **Threshold clamp too high (v3.3.0)**: Initial clamp floor of 140 prevented histogram threshold from going low enough for dark SDXL output. Lowered to 100.

---

## 5. JPEG to PNG Conversion

### Decision: Cloudflare Images binding for JPEG → PNG transcoding

**Why:**
- SDXL returns JPEG (base64-encoded), but our PNG decoder only handles PNG
- Cloudflare Images provides a server-side `input().output()` API for format conversion
- API pattern: `(await env.IMAGES.input(jpegBytes).output({ format: "image/png" })).response()`
- Requires the Images paid subscription but is very cheap for our volume

**Gotcha:** The `.output()` call returns a Promise — you must `await` it before calling `.response()`. Wrong: `env.IMAGES.input(bytes).output({format}).response()`. Right: `(await env.IMAGES.input(bytes).output({format})).response()`.

---

## 6. Text Overlay Layout

### Decision: Thin bottom bar with three-part layout

**Layout (both pipelines):**
```
Location (left)     Event Title (centered in gap)     Date, Year (right)
```

**Pipeline A (4-level):** 24px black bar, white text (8px font, scale 1)
**Pipeline B (1-bit):** 16px white strip, black text (8px font, scale 1)

**Key design choices:**
- Title is centered between location-end and date-start (not centered on the full width)
- Location truncated at 35 characters with "..." if too long
- Title truncated to fit available gap
- 8x8 bitmap font (CP437), written directly to pixel buffer
- For 1-bit: caption drawn AFTER dithering so text stays crisp

**What we tried and fixed:**
- Single line with title centered on full width → text overlap with long locations
- 25-character location limit → too aggressive truncation. Increased to 35.

---

## 7. LLM for Event Selection

### Decision: Llama 3.3 70B with structured JSON output

**Why Llama 3.3 70B:**
- Available on Workers AI as `@cf/meta/llama-3.3-70b-instruct-fp8-fast`
- Good at following structured output instructions (JSON)
- Creative enough to pick visually interesting events and write compelling scene descriptions

**Scene direction — "event itself" (v3.3.0+):**
- Originally the LLM described the "moment before" the event (calm, pre-event scene)
- Switched to depicting the event itself at its defining moment of action
- Reason: pre-event scenes were often too calm and ambiguous on e-ink — a ship sailing calmly looks like any ship. The event in action (Titanic tilting, bombers over Dresden) is instantly recognizable.
- Guard rails: "avoid graphic injury, bodies, blood, or close-up suffering; focus on the iconic scene and scale"
- Historical accuracy constraint: architecture, vehicles, clothing must match the era (e.g., 1945 Dresden = baroque churches, not modern skyscrapers)
- The "Moment Before" brand name is kept (function names, types) but the prompt semantics are "event itself"

**Scene-only prompt design:**
- One `SYSTEM_PROMPT` constant that instructs the LLM to write scene-only prompts (no art style)
- The LLM writes scene descriptions covering subject, setting, composition, lighting, and mood
- Each pipeline prepends its own style before image generation
- Both pipelines use the same LLM output format (each makes its own call, so different events are possible)

**Response handling:**
- The LLM `.response` field may not be a string — always coerce: `typeof raw === "string" ? raw : JSON.stringify(raw)`
- The model sometimes wraps JSON in markdown fences — extraction tries direct parse, then regex, then first-`{`-to-last-`}`
- Temperature 0.7 gives good variety without being too random

**Event filtering:**
- Pre-filter to 1800–2000 era events (more visually recognizable)
- Cap at 20 events to stay within context window
- Fallback to first event with generic prompt if LLM fails

---

## 8. Caching Strategy

### Decision: KV cache with versioned keys and 24h TTL

**Cache key formats:**
- 4-level: `fact4:v4:YYYY-MM-DD`
- 1-bit: `fact1:v7:YYYY-MM-DD`

**Why versioned keys:**
- During development, changing the pipeline (model, style, dithering algorithm) required invalidating old cached images
- Bumping the version forces regeneration without manually deleting KV keys
- In production, the version stays fixed

**Timezone:** Cache keys use America/Chicago date (the target location). This avoids serving yesterday's image when it's past midnight UTC but still the same day in Chicago.

**Pre-warming:** A daily cron at 06:05 UTC (12:05 AM Chicago) generates and caches both the 4-level and 1-bit images so the first viewer gets a fast response. A separate every-6-hour cron refreshes headlines and weather.

---

## 9. PNG Encoder: Pure JavaScript

### Decision: Custom PNG encoder using Web APIs

**Why custom:**
- Cloudflare Workers don't support native Node.js image libraries (sharp, canvas, etc.)
- We needed both 1-bit and 8-bit grayscale PNG encoding
- The PNG format is simple enough to implement: IHDR + IDAT (zlib-compressed scanlines) + IEND

**Implementation:**
- CRC32 lookup table for chunk checksums
- Adler32 for zlib wrapper
- `CompressionStream("deflate-raw")` Web API for compression (available in Workers)
- Zlib header wrapping (CMF=0x78, FLG=0x01) around the raw deflate output
- `encodePNGGray8()` for 8-bit grayscale, `encodePNG1Bit()` for 1-bit

**PNG decoder** handles 8-bit RGB, RGBA, Grayscale, and GrayAlpha color types, with sub/up/average/paeth filter reconstruction.

---

## 10. btoa Stack Overflow Fix

### Decision: Chunk `String.fromCharCode` into 8192-byte slices

**Problem:** `String.fromCharCode(...largeArray)` passes all bytes as individual arguments. For a 150KB+ image, this exceeds the JavaScript call stack limit.

**Solution:**
```typescript
let binary = "";
const CHUNK = 8192;
for (let i = 0; i < png.length; i += CHUNK) {
  binary += String.fromCharCode(...png.subarray(i, i + CHUNK));
}
const b64 = btoa(binary);
```

---

## 11. HTML Endpoints for SenseCraft HMI

### Decision: Server-rendered HTML pages with inline SVG icons

The reTerminal E1001's SenseCraft HMI has a "Web Function" that screenshots a URL onto the e-ink display. We added `/weather` and `/fact` HTML endpoints optimized for this.

**Tried:**
| Approach | Result |
|----------|--------|
| Emoji weather icons | ESP32-S3's renderer doesn't support emoji — blank spaces |
| Gray text (#333, #444) for secondary info | Too faint on e-ink — nearly invisible |
| `new Date()` to parse Open-Meteo times | Open-Meteo returns Chicago-local times; `new Date()` treats them as UTC, shifting hours by -6 |

**Lessons learned:**
- **No emoji** — the ESP32-S3 screenshot renderer lacks emoji font support. Use inline SVG or plain text.
- **Pure black only** — all text and borders must be `#000`. Any gray lighter than ~#222 disappears on e-ink.
- **Parse local times as strings** — Open-Meteo returns times in the requested timezone (Chicago). Parsing with `new Date("2026-02-14T02:00")` interprets it as UTC, causing a 6-hour offset. Instead, extract the hour directly from the ISO string.
- **Request 24h of hourly data** — `forecast_hours=12` returns 12 hours from start of day, not from "now". With only 12 hours, late-night requests have no future hours to show.

---

## 12. Weather Dashboard v2

### Decision: Improved dashboard replacing the original `/weather`

**New features (now live on `/weather`):**
- **Day/night icons**: Crescent moon (clear_night) and moon-behind-cloud (partly_cloudy_night) for nighttime hours
- **Wind direction**: Cardinal labels (N, NE, E, etc.) computed from degrees, plus gust speed when significant (gusts > wind + 10)
- **Sunrise/sunset**: Displayed below current conditions, formatted in 12h time
- **Smart precipitation**: Daily cards show snowfall (cm), rain amount (mm), or probability — whichever is most informative
- **NWS weather alerts**: Fetched from `api.weather.gov`, cached 5 min in KV, sorted by severity (Extreme > Severe > Moderate > Minor)
- **Alert banner**: Black bar with white text between daily and hourly sections, comma-separated alert names
- **Rain warning**: When no alerts, checks 15-min precipitation data and hourly probability for imminent rain
- **15-min precipitation**: Open-Meteo `minutely_15` data (8 values = 2 hours ahead)
- **Dynamic location**: Uses `w.location.name` instead of hardcoded "NAPERVILLE, IL"
- **15-min cache**: Reduced from 30 min to match device refresh interval

**Development approach:**
- Developed as `/weather2` alongside old `/weather` for side-by-side comparison
- After validation, replaced `/weather` and deleted old `src/pages/weather.ts`
- `v2.0.0` git tag marks the pre-improvement state for rollback
- Data layer changes (types, weather.ts) are additive — no fields removed
- Test params: `?test-alert=tornado|winter|flood`, `?test-rain`, `?test-temp=N` inject fake data for visual testing

**v2.2 tweaks:**
- Sunrise/sunset icons enlarged from 22px to 28px, font from 16px to 18px for better e-ink readability

**v3.2 — SenseCraft device data + layout optimization:**
- Added indoor temp/humidity (from SenseCraft HMI API) and battery level to the weather page
- `src/device.ts` fetches device data server-side, KV cached 5 min — no URL change needed on device
- Battery icon + percentage displayed top-right in header, below date/time
- Indoor temp/humidity displayed in header center (house + droplet icons)
- Wind merged onto the feels-like line to save vertical space; gusts shown as range (e.g. "SW 15-25 km/h")
- These changes reclaim ~42px, ensuring NWS alert banners fit within 480px without cutting off hourly cards
- Alert and rain warning are mutually exclusive (if/else) — never both rendered
- Test param: `?test-device` injects fake device data (22°C, 45%, battery 73%)

**NWS alerts integration (`src/alerts.ts`):**
- Endpoint: `https://api.weather.gov/alerts/active?point=LAT,LON`
- Requires `User-Agent` header (NWS policy)
- Retries once on failure, returns stale cache or `[]` on error
- No API key needed — free US government API

---

## 13. Birthday Portrait Generation (v3.0.0)

### Decision: FLUX.2 klein-9b with reference photos from R2

On family birthday dates, `/fact.png` generates an artistic portrait using FLUX.2 with up to 4 reference photos stored in R2. Each year uses a different art style (10 styles rotating by `year % 10`). `/fact1.png` always shows regular Moment Before content.

**Model choice:**

| Model | Result |
|-------|--------|
| `flux-2-klein-4b` | Fast (4 steps) but poor likeness, generic faces |
| **`flux-2-klein-9b`** | **Much better likeness with reference photos, still 4 steps** |

FLUX.2 klein models have steps fixed at 4 (cannot be adjusted). The 9b model produces significantly better results with reference images despite the same step count.

**API:** FLUX.2 requires multipart FormData (not JSON like SDXL). Reference images are sent as `input_image_0` through `input_image_3`. The FormData is serialized via `new Response(form)` to extract body stream and content-type for Workers AI.

**Art styles (10, rotating yearly):**

| # | Style | Notes |
|---|-------|-------|
| 0 | Woodcut | Same style as Moment Before — bold, high contrast |
| 1 | Watercolor | Must be "bold, rich saturated washes" — delicate/soft washes are too faint after quantization |
| 2 | Art Nouveau | Mucha-inspired, flows well |
| 3 | Pop Art | Warhol-inspired, flat vivid colors |
| 4 | Impressionist | Visible brushstrokes, Monet-inspired |
| 5 | Ukiyo-e | Japanese woodblock style |
| 6 | Art Deco | Geometric patterns, elegant |
| 7 | Pointillist | Seurat-inspired, tiny dots |
| 8 | Pencil Sketch | Originally Renaissance — replaced because chiaroscuro was too dark after 4-level quantization |
| 9 | Charcoal | Expressive strokes, deep shadows |

**Prompt engineering lessons:**
- **"no text, no words, no letters, no writing"** — FLUX.2 aggressively bakes text into images. Names like "LUCAS" or "ALVARO" appeared in the generated portraits without this.
- **Age descriptions matter**: "elderly person" caused the model to exaggerate wrinkles and age features. Changed to neutral `"a {age}-year-old person"` for adults.
- **"head and shoulders, centered composition, looking at viewer, smiling"** — this framing produces the best e-ink portraits
- **Accent stripping**: Names like "Sônia" must be stripped to ASCII for the 8x8 bitmap font via NFD normalization

**Content safety filter (error 3030):** FLUX.2 occasionally flags outputs. The portrait prompt ("head and shoulders, looking at viewer, smiling") is safer than broader portrait prompts. Retry once on failure.

**Fallbacks:**
1. R2 photo missing → text-only portrait prompt (no reference image)
2. FLUX.2 fails after retry → fall back to regular Moment Before pipeline

**Cache key:** `birthday:v1:YYYY-MM-DD` (separate from Moment Before cache keys)

---

## 14. E1002 Color E-Ink Support (v3.5.0)

### Decision: Floyd-Steinberg dithering to 6-color Spectra palette

The reTerminal E1002 has a 7.3" E Ink Spectra 6 display with 6 native pigment colors (black, white, red, yellow, green, blue). Unlike the E1001's monochrome display, this one can show actual colors.

**Why Floyd-Steinberg for color (but not for mono):**
- For the E1001 mono display, Floyd-Steinberg produced "dot soup" — the display's own dithering doubled the artifacts
- For the E1002 Spectra 6, the display renders pixels exactly as sent (no additional dithering)
- Floyd-Steinberg error diffusion produces excellent results when mapping to a fixed 6-color palette
- The visual quality is significantly better than nearest-color mapping alone

**Measured palette values (sRGB):**
| Color | RGB |
|-------|-----|
| Black | (0, 0, 0) |
| White | (255, 255, 255) |
| Red | (178, 19, 24) |
| Yellow | (239, 222, 68) |
| Green | (18, 95, 32) |
| Blue | (33, 87, 186) |

**Palette-indexed PNG (color type 3):**
- Added `encodePNGIndexed()` to png.ts — IHDR (bit depth 8, color type 3) + PLTE chunk + IDAT
- One index byte per pixel (palette indices 0-5)
- Images served as inline base64 in HTML pages (SenseCraft HMI screenshots HTML)

**Shared moment cache:**
- All pipelines (A, B, color) now share the same LLM-selected event per day
- `getOrGenerateMoment()` in moment.ts checks KV (`moment:v1:{dateStr}`) before calling LLM
- Previously each pipeline made its own LLM call — could pick different events

**Color style prompt evolution:**
- v3.5.0: Used `"screen print poster, flat inks, bold shapes..."` — produced overly blocky/posterized results when dithered to 6 colors
- v3.5.x: Switched to **natural style (no prefix)** — scene-only `imagePrompt` + anti-text suffix. Floyd-Steinberg handled natural photos OK but quality was inconsistent
- v3.6.0: **5-style daily rotation** (gouache, oil painting, graphic novel, ink+wash, color woodblock) + palette suffix. Best balance: curated styles produce flat color areas that dither cleanly while adding variety

**APOD integration:**
- NASA APOD API key stored as Cloudflare secret (`wrangler secret put APOD_API_KEY`)
- Falls back to `DEMO_KEY` (rate limited but works)
- HD image URL preferred for better dither quality

**Headlines RSS + LLM summarization:**
- Google News RSS + Federal Register API
- LLM summarizes to 2 lines per headline (temperature 0.3 for factual output)
- Cached 6h per period (0/6/12/18 hours, Chicago time)
- Categorized by keywords: tariffs, markets, company, regulatory

**Cron schedule change:**
- Was: daily at 10:00 UTC
- Now: `"5 6 * * *"` (daily images at 06:05 UTC) + `"5 0,6,12,18 * * *"` (headlines/weather every 6h)

---

## 15. Color Moment Style Rotation (v3.6.0)

### Decision: 5-style daily rotation optimized for Floyd-Steinberg dithering

The color moment pipeline (`/color/moment`) previously sent the LLM's scene-only `imagePrompt` to FLUX.2 with no art style prefix. This produced decent results but lacked variety. Adding a 5-style rotation optimized for 6-color Floyd-Steinberg dithering brings visual variety to the E1002 Spectra 6 display.

**Styles** (rotate daily by `(dayOfYear - 1) % 5`):

| # | Style | Prompt summary | Why it works for Spectra 6 |
|---|-------|----------------|---------------------------|
| 0 | Gouache | Opaque matte pigment, bold flat fields | Flat color areas dither cleanly |
| 1 | Oil Painting | Rich saturated colors, impasto strokes | High saturation maps well to 6-color palette |
| 2 | Graphic Novel | Bold ink outlines, flat color fills | Cel-shaded look minimizes gradient artifacts |
| 3 | Ink + Wash | Black ink outlines with color washes | High contrast outlines survive dithering |
| 4 | Color Woodblock | Ukiyo-e flat color areas, key block | Traditional limited palette maps naturally |

**Color palette suffix**: All prompts get `"limited palette, large flat color regions, bold saturated reds blues yellows greens, no gradients, avoid tiny details, high contrast"` appended to guide the model toward Spectra 6-friendly output.

**Why not the same "no style" approach as before:**
- The previous "natural style" approach (scene-only prompt, no prefix) produced results that varied wildly in dither quality
- These 5 styles were chosen specifically because they produce large flat color regions that map well to the 6-color Spectra palette
- The palette suffix further constrains the model to avoid gradients and fine details

**Cache key change**: `color-moment:v1:YYYY-MM-DD` → `color-moment:v2:YYYY-MM-DD:STYLE_ID` (includes style ID to support cache invalidation per style).

**Cron warm-up**: The daily cron now generates and caches the color moment directly (previously was a no-op that relied on first request).

**Test support**: `/color/test-moment?m=MM&d=DD&style=STYLE_ID` allows forcing a specific style.

---

## 16. What We Didn't Do (and why)

| Consideration | Decision | Reason |
|---------------|----------|--------|
| External APIs (DALL-E, Google) | Stayed with Workers AI | No API keys needed, lower latency, simpler architecture |
| Client-side rendering | Server-side PNG | E-ink devices have limited processing power |
| Color output for E1001 | Grayscale only for mono display | E1001 is monochrome — color would be downconverted |
| Floyd-Steinberg dithering for 1-bit mono | 8×8 Bayer ordered dithering | Floyd-Steinberg creates random-looking noise on mono e-ink; Bayer is deterministic and stable |
| Floyd-Steinberg for Spectra 6 color | Used Floyd-Steinberg | Spectra 6 renders pixels exactly — no double-dithering issue; FS gives best 6-color results |
| AI-generated line art for 1-bit | Dither the same tonal image | SDXL cannot generate true line art; style keywords corrupt scene content |
| Server-side color page rendering as PNG | HTML with inline base64 PNG | SenseCraft screenshots HTML; HTML caption is crisper than bitmap font on indexed image |
| User-configurable location | Hardcoded per-device (Naperville E1001, Chicago E1002) | Single-user; E1001 at home (60540), E1002 at office (60606) |
| Separate LLM prompts per pipeline | Single scene-only SYSTEM_PROMPT | Style is a rendering concern — prepended per-pipeline, not baked into LLM |
| "Moment before" scene direction | "Event itself" scene direction | Pre-event scenes were too calm/ambiguous on e-ink; the event in action is instantly recognizable |
| Single art style for Pipeline A | Daily rotation (3 styles) | Variety keeps the daily image fresh; Woodcut, Pencil Sketch, and Charcoal all work well on e-ink |
| Single art style for Pipeline B | 6-style rotation (v3.3.0) | Variety with style-aware conversion; each style picks Bayer or threshold mode for best results |
| Newsprint dots style for Pipeline B | Replaced with charcoal_block | Newsprint ran too dark on SDXL output; charcoal_block produces better 1-bit results with threshold mode |
| Shared FLUX.2 code with Moment Before pipeline | Separate implementations | ~20 lines of FormData logic; birthday has reference images, Moment Before doesn't — not worth abstracting |
| Shared `callFluxPortrait` between mono and color birthday | Shared (exported from birthday-image.ts) | Color birthday previously used `generateBirthdayJPEG` wrapper that duplicated retry logic and age description. Now both pipelines call `callFluxPortrait` directly with explicit retry loops at the call site. |
| Separate wind line in weather details | Merged onto feels-like line | Saves ~22px vertical; gusts shown as compact range format (e.g. "15-25 km/h") |
| Indoor data in weather details section | Moved to header center | Saves ~20px vertical; keeps header row compact with house+droplet icons |
| Reshuffle entire layout for alerts | Targeted 2-line merge | Wholesale layout changes caused inconsistent visual between alert/no-alert states |
| No style for color moment | 5-style daily rotation (v3.6.0) | Previous "no style" produced too-variable dither quality; 5 curated styles produce large flat color areas that dither well to Spectra 6 palette |

---

## 17. SenseCraft API Key Handling

### Decision: Keep SenseCraft `API-Key` in code, documented as public/shared

For device telemetry (`src/device.ts`), the project uses the SenseCraft HMI API endpoint:
`https://sensecraft-hmi-api.seeed.cc/api/v1/user/device/iot_data/{DEVICE_ID}` with an `API-Key` header.

We treat this key as a **public/shared platform key**, not a private credential. As of **February 16, 2026**, Seeed's official documentation publishes the same key and states it can be obtained from frontend source:

- https://wiki.seeedstudio.com/reTerminal_E1002_Sensecraft_AI_dashboard/#query-device-information-from-sensecraft-api

**Why this decision:**
- Matches the upstream platform model and official examples
- Avoids unnecessary secret plumbing for non-sensitive, single-device telemetry
- Keeps deploy/setup simple for this personal dashboard project

**Boundary:**
- This policy applies only to this SenseCraft shared key pattern.
- Real secrets (for example `APOD_API_KEY` and any private tokens) remain in Worker secrets and are never committed.

---

## 18. Security Hardening (v3.7.0)

### Decision: HTML escaping + test endpoint auth

**HTML escaping:**
- External content (LLM output, RSS feeds, NASA APOD, NWS alerts) was interpolated directly into HTML templates without escaping
- Added `src/escape.ts` with `escapeHTML()` utility (escapes `& < > " '`)
- Applied to all dynamic text interpolations across 5 page files: color-headlines, color-apod, color-moment, weather2, color-weather
- Safe base64 image data and numeric values are NOT escaped (no XSS vector)

**Test endpoint auth (`TEST_AUTH_KEY`):**
- 5 expensive test routes (`/test.png`, `/test1.png`, `/test-birthday.png`, `/color/test-moment`, `/color/test-birthday`) trigger AI image generation — publicly accessible = abuse vector
- Added optional `TEST_AUTH_KEY` secret: when set, these routes require `?key=SECRET` parameter
- Returns 404 (not 401/403) when key is wrong — hides endpoint existence
- When no secret is configured (local dev), all test routes work without auth
- Cheap test params (`?test-device`, `?test-alert`, `?test-headlines`) remain open — no AI cost
- Set after deploy: `npx wrangler secret put TEST_AUTH_KEY`

---

## 19. Per-Device Telemetry (v3.6.1)

### Decision: Parameterize `fetchDeviceData` with device ID

**Problem:**
`fetchDeviceData` hardcoded device ID `20225290` (E1001, home Naperville). The `/color/weather` endpoint for E1002 (office Chicago) was displaying E1001's indoor sensor data (temperature, humidity, battery) instead of its own.

**Fix:**
- Exported `E1001_DEVICE_ID` and `E1002_DEVICE_ID` from `device.ts`
- Added `deviceId` parameter to `fetchDeviceData` with E1001 default (backward-compatible)
- Each weather page now passes its own device ID explicitly
- Cron warms both devices

**Cache keys:** `device:20225290:v1` (E1001), `device:20225358:v1` (E1002) — same version, different device ID in key.

---

## 20. Hourly Card Fallback (v3.6.1)

### Decision: Fall back to full hourly data when all future hours are past

**Problem:**
Both weather pages filter `hourly_12h` to `futureHours` (hours >= current Chicago time). If all 12 hours are in the past (e.g. stale weather data or late-day edge case), the "Next Hours" section renders empty.

**Fix:** `const hourlyCards = futureHours.length > 0 ? futureHours : w.hourly_12h;`

Shows stale hours (still useful for temperature trends) rather than nothing.

---

## 21. Color Weather Precipitation Text Readability (v3.6.1)

### Decision: Remove blue text styling from precipitation in color-weather

**Problem:**
Precipitation text (`X% rain`, `Xmm rain`, rain warnings) used `style="color:var(--s6-blue)"` on the Spectra 6 color weather page. Blue text on white background has lower contrast than black on white for small text on e-ink.

**Fix:** Removed `style="color:var(--s6-blue)"` from 3 locations:
- Daily forecast precipitation (line 231)
- Rain warning banner (line 246)
- Hourly card precipitation (line 267)

**Kept:** Weather icon fills (droplets, rain) still use blue — they're larger visual elements where color adds value without hurting readability. Temperature coloring (`tempColor()`) also kept.

---

## 22. Operational Reliability (v3.8.0)

### Decision: Fetch timeouts, KV TTL, cache logging

**Fetch timeouts (`fetchWithTimeout`):**
- All external `fetch()` calls now use `fetchWithTimeout()` from `src/fetch-timeout.ts`
- Uses `AbortController` + `setTimeout` — standard Web API pattern
- Default timeout: 10s for most APIs; 8s for SenseCraft device API; 15s for APOD image download
- On timeout, the `AbortError` propagates to existing try/catch blocks, which already handle errors via stale-cache fallback or graceful degradation
- No behavior change for fast responses — only protects against hung connections

**KV TTL policy:**
- Ephemeral data (weather, alerts, device): `expirationTtl: 3600` (1 hour) — refreshed every 5-15 min, TTL is generous buffer
- Daily data (images, facts, moments, APOD, headlines, birthdays): `expirationTtl: 604800` (7 days) — generous buffer for daily rotation
- Previously most `.put()` calls had no TTL, so stale entries accumulated forever
- APOD color and color-moment TTL increased from 86400 (1 day) to 604800 (7 days) for consistency

**Cache hit/miss logging:**
- Added `console.log("Component: cache hit")` at every cache-check-and-return-early point
- Also logs stale fallback usage: `"Component: using stale cache"` / `"Component: stale fallback"`
- Visible in `wrangler tail` for diagnosing cache behavior in production
- No performance impact — just string interpolation on the hot path

---

## 23. Codex Environment Limitations (lesson learned)

### Context: GitHub Codex attempted these fixes but could not deliver them

Codex correctly identified all three bugs above and wrote correct code. However:
- **No remote push**: Codex sandbox had no configured git remote — commits were local-only
- **No deploy**: `CLOUDFLARE_API_TOKEN` not available in sandbox — `wrangler deploy` failed
- **No visual testing**: `wrangler dev` returned empty responses in sandbox — no browser testing possible
- **Fabricated claims**: Codex reported successful commits, PR creation, and "production verification" that never happened

**Lesson:** Codex is useful for code generation and type-checking (`tsc --noEmit`, `--dry-run`), but cannot push, deploy, or visually test. Always verify Codex claims against actual git/GitHub state before trusting them. See MEMORY.md for operational guidelines.

---

## 24. Weather Crash Root Cause: KV TTL Regression (v3.8.1)

### Incident: E1001 `/weather` returning Error 1101, then "Weather data temporarily unavailable"

After deploying v3.8.0 and v3.8.1, the E1001 weather page crashed. E1002's `/color/weather` continued working. Investigation revealed this was NOT rate-limiting — it was a **KV TTL regression** introduced in v3.8.0.

### Root cause: v3.8.0 introduced `expirationTtl: 3600` where there was none before

| Version | KV `expirationTtl` | KV hard-deletes after | Stale fallback window |
|---------|---------------------|----------------------|-----------------------|
| **Pre-v3.8.0** | **None** (never expires) | **Never** | **Infinite** |
| v3.8.0 | `3600` (1 hour) | 1 hour | ~45 min (weather) |
| v3.8.1 | `86400` (24 hours) | 24 hours | ~23.75 hours |

**Before v3.8.0**, KV entries never expired. The code used a **two-tier cache** pattern:
- **Soft TTL** (read-side): `Date.now() - cached.timestamp < CACHE_TTL_MS` (15 min for weather, 5 min for alerts/device). After this, re-fetch from API.
- **Stale fallback**: If the API fetch fails, return stale cached data. Since KV entries never expired, stale data was always available.

**v3.8.0 added `expirationTtl: 3600`**, meaning Cloudflare KV itself hard-deleted entries after 1 hour. This destroyed the stale fallback:
- 0–15 min: serve from cache (fresh)
- 15–60 min: re-fetch from API. If API fails, stale fallback works (entry still in KV)
- **After 60 min: KV entry is gone.** If the API also fails, `cached` is `null`, stale fallback has nothing to return, function throws.

### Why E1001 died but E1002 survived

This was a **timing coincidence**, not a code difference. Both caches had the same 1-hour TTL. E1001's `weather:60540:v2` was last written >1 hour before the API had a transient failure, so KV had already hard-deleted it. E1002's `weather:60606:v2` happened to be refreshed more recently by device polling.

### Secondary finding: cron only warmed E1001 weather

The cron handler called `getWeather(env)` (Naperville 60540) but never `getWeatherForLocation()` (Chicago 60606). E1002's weather cache relied entirely on device polling — no cron backup. If the device went offline for >24h, its weather cache would expire with no recovery path.

### Fix (three parts):

1. **KV TTL 3600 → 86400** for weather, alerts, and device data. The soft TTL (15 min for weather, 5 min for alerts/device) controls freshness; the KV TTL only controls how long stale fallback data survives. 24 hours gives ample margin for API outages.

2. **try/catch in weather page handlers** (`handleWeatherPageV2`, `handleColorWeatherPage`). Returns a plain-text 503 with `Retry-After: 300` instead of crashing. Defense-in-depth for when KV is truly empty (new deployment, new namespace).

3. **Cron now warms both weather locations.** Added `getWeatherForLocation(env, 41.8781, -87.6298, "60606", "Chicago, IL")` to `handleScheduled()` so both E1001 and E1002 have cron backup.

### Lesson: KV `expirationTtl` and soft TTL serve different purposes

The soft TTL controls data **freshness** (when to re-fetch). The KV `expirationTtl` controls data **availability** (when the stale fallback disappears). Setting them close together (1h hard vs 15min soft = 45min margin) is dangerous. The hard TTL should be orders of magnitude larger than the soft TTL. Rule of thumb: `expirationTtl` should be at least 10× the soft TTL for ephemeral data.

### Emergency KV seeding via Wrangler CLI

When the KV cache is empty and the API is unreachable from the worker, you can seed it manually:
```bash
# Fetch data locally, normalize to KV format, then push:
npx wrangler kv key put --namespace-id=NAMESPACE_ID "weather:60540:v2" --path /tmp/weather-kv.json --ttl 86400 --remote
```
Note: Wrangler v4 uses `--ttl` (not `--expiration-ttl`).

---

## 25. Security Hardening: Input Validation + Headers (v3.8.1)

### Input validation for test endpoints

Test endpoints (`/test.png`, `/test1.png`, `/test-birthday.png`, `/color/test-moment`, `/color/test-birthday`) accepted raw query params passed to `parseInt()` and Wikipedia URLs. Added `parseMonth()`, `parseDay()`, `parseStyleIdx()` in `src/validate.ts` — clamps values to valid ranges with safe defaults.

### Security headers on all HTML responses

Added `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer` via shared `htmlResponse()` helper in `src/response.ts`. Applied to all 9 HTML response sites. Low-risk, defense-in-depth.

### Error message sanitization

Sanitized user-supplied `name` param in birthday test endpoint error responses: `nameParam.slice(0, 50).replace(/[^\w-]/g, "")` prevents XSS in error messages even though they're already JSON or text/plain.

### APOD date escaping

Escaped `date` field in `color-apod.ts` HTML interpolation (2 places). Already safe since APOD dates are YYYY-MM-DD from NASA API, but defense-in-depth.

### DEMO_KEY warning

Added `console.warn` when APOD falls back to DEMO_KEY — makes it visible in `wrangler tail` that the API key isn't configured.
