# Architecture & Design Decisions

This document records the key decisions made during development of the "Moment Before" e-ink dashboard, including what we tried, what failed, and why we landed where we did.

---

## 1. Image Generation Model

### Decision: SDXL (Stable Diffusion XL)

**Tried:**
| Model | Result |
|-------|--------|
| `flux-1-schnell` (4 steps) | Fast but low quality, washed-out details |
| `flux-2-dev` (20 steps) | Stunning ink illustrations, rich detail — but requires multipart FormData API |
| `stable-diffusion-xl-base-1.0` (20 steps) | Great woodcut/linocut style, simpler JSON API |

**Why SDXL:**
- Produces excellent woodcut/linocut illustrations with strong contrast
- Uses standard JSON API (not multipart FormData like FLUX-2 models)
- `@cf/stabilityai/stable-diffusion-xl-base-1.0` on Workers AI
- 20 steps is the Workers AI maximum (steps > 20 causes error 5006)
- ~4-6 seconds for image generation — acceptable for a daily image

**Note:** SDXL does NOT support `negative_prompt` — all style constraints must be embedded in the positive prompt (e.g., "AVOID: stippling, halftone dots, fine crosshatching").

---

## 2. Art Style: Woodcut / Linocut Relief Print

### Decision: "Hand-carved woodcut print, linocut relief print, vintage newspaper woodcut illustration"

**Tried:**
| Style | Result on e-ink |
|-------|-----------------|
| Graphite pencil with soft shading | Beautiful raw image, but terrible after any 1-bit conversion — "dot soup" |
| Black ink pen editorial illustration | Good cross-hatching, but lighter prompts looked too faint on the display |
| Lighter ink ("plenty of white space, avoid solid black") | Too faint on e-ink — bold style reads much better |
| Etch-A-Sketch / minimalist cityscape | Style keywords hijacked the scene — model generated generic cityscapes regardless of historical event |
| **Woodcut / linocut with gouge strokes** | **Perfect — bold, high-contrast, dramatic, reads beautifully on e-ink** |

**Why woodcut/linocut:**
- Inherently high-contrast: solid black ink areas with carved white channels
- "Sweeping curved gouge strokes" creates organic texture (not mechanical hatching)
- "Large solid black ink areas with minimal midtones" translates perfectly to e-ink
- Works for both 4-level grayscale (quantized tonal regions) and 1-bit dithered (dot texture)
- Consistent dramatic aesthetic across all historical subjects

**Prompt engineering:**
- Must include "no pens, no pencils, no drawing tools, no art supplies, no hands" — SDXL sometimes draws art tools in the scene
- "Visible U-gouge and V-gouge carving marks" produces authentic woodcut texture
- "Two to three tonal regions only" prevents muddy midtones
- "AVOID: stippling, halftone dots, fine crosshatching, pencil shading, airbrush gradients" keeps the style on-target
- Bold style with solid blacks looks BETTER on e-ink than lighter/delicate alternatives

---

## 3. Two Output Pipelines

### Decision: Dual pipeline — 4-level grayscale + 1-bit Bayer dithered

The project produces two versions of each day's image:

| Endpoint | Pipeline | Output | Use case |
|----------|----------|--------|----------|
| `/fact.png` | Pipeline A | 4-level grayscale (8-bit PNG) | Displays with grayscale support |
| `/fact1.png` | Pipeline B | 1-bit Bayer dithered (1-bit PNG) | Mono e-ink displays |

Both pipelines share the same LLM event selection and SDXL image generation, but each makes its own LLM + AI call (different events are possible). They diverge at post-processing:

**Pipeline A (4-level):**
1. Grayscale → caption (24px black bar, white text) → tone curve (1.2, 0.95) → quantize to 4 levels (0, 85, 170, 255) → 8-bit PNG

**Pipeline B (1-bit):**
1. Grayscale → tone curve (1.20, 0.92) → 8×8 Bayer ordered dithering → caption (16px white strip, black text) → 1-bit PNG

**Why two pipelines:**
- Some e-ink displays are mono-only and handle their own grayscale-to-mono conversion poorly (muddy results)
- Pre-dithering with Bayer produces a clean, deterministic dot pattern optimized for e-ink
- The 4-level version preserves more tonal information for displays that can use it

---

## 4. 1-Bit Conversion: 8×8 Bayer Ordered Dithering

### Decision: Bayer 8×8 matrix (deterministic ordered dithering)

This was the hardest technical challenge. We tried 7 different approaches before finding one that worked well.

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

**Implementation:**
```
Classic 8×8 Bayer threshold matrix (64 unique values, 0–63)
Normalized to 0–255 range
For each pixel: output = gray[x,y] > bayer_threshold[x%8, y%8] ? white : black
Tone curve applied BEFORE dithering (contrast=1.20, gamma=0.92) to preserve midtones
Caption drawn AFTER dithering so text stays crisp (not dithered)
```

**Key technical bugs encountered:**
- **Auto-threshold direction inversion**: `gray[i] < thresh` = black, so LOWER threshold = fewer black pixels. Initial implementation raised threshold when image was too dark — made it worse.
- **Caption overlap**: Title centered across full 800px width collided with long location text. Fixed by centering title in the gap between location-end and date-start.

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

**Single prompt design:**
- One `SYSTEM_PROMPT` constant with woodcut style guidance baked in
- The LLM writes both the scene description and the SDXL image prompt
- Both pipelines use the same LLM output (each makes its own call, so different events are possible)

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
- 4-level: `fact4:v2:YYYY-MM-DD`
- 1-bit: `fact1:v5:YYYY-MM-DD`

**Why versioned keys:**
- During development, changing the pipeline (model, style, dithering algorithm) required invalidating old cached images
- Bumping the version forces regeneration without manually deleting KV keys
- In production, the version stays fixed

**Timezone:** Cache keys use America/Chicago date (the target location). This avoids serving yesterday's image when it's past midnight UTC but still the same day in Chicago.

**Pre-warming:** A daily cron at 10:00 UTC (4:00 AM Chicago) generates and caches both the 4-level and 1-bit images so the first viewer gets a fast response.

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

## 12. Weather Dashboard v2 (`/weather2`)

### Decision: Improved dashboard as a separate endpoint for safe comparison

**New features in v2:**
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
- `/weather` (old) kept untouched as rollback
- `/weather2` (new) served from separate `src/pages/weather2.ts`
- `v2.0.0` git tag marks the pre-improvement state
- Data layer changes (types, weather.ts) are additive — no fields removed
- Test params: `?test-alert=tornado|winter|flood` and `?test-rain` inject fake data for visual testing

**NWS alerts integration (`src/alerts.ts`):**
- Endpoint: `https://api.weather.gov/alerts/active?point=LAT,LON`
- Requires `User-Agent` header (NWS policy)
- Retries once on failure, returns stale cache or `[]` on error
- No API key needed — free US government API

---

## 13. What We Didn't Do (and why)

| Consideration | Decision | Reason |
|---------------|----------|--------|
| External APIs (DALL-E, Google) | Stayed with Workers AI | No API keys needed, lower latency, simpler architecture |
| Client-side rendering | Server-side PNG | E-ink devices have limited processing power |
| Color output | Grayscale only | Target display is grayscale e-ink |
| Floyd-Steinberg dithering for 1-bit | 8×8 Bayer ordered dithering | Floyd-Steinberg creates random-looking noise on e-ink; Bayer is deterministic and stable |
| AI-generated line art for 1-bit | Dither the same tonal image | SDXL cannot generate true line art; style keywords corrupt scene content |
| User-configurable location | Hardcoded Naperville, IL | Single-user deployment; easy to change in code |
| Separate LLM prompts per pipeline | Single SYSTEM_PROMPT | Both pipelines benefit from the same rich woodcut scene descriptions |
