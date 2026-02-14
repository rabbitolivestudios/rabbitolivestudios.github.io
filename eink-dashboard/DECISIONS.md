# Architecture & Design Decisions

This document records the key decisions made during development of the "Moment Before" e-ink dashboard, including what we tried, what failed, and why we landed where we did.

---

## 1. Image Generation Model

### Decision: FLUX-2-dev (20 steps)

**Tried:**
| Model | Result |
|-------|--------|
| `flux-1-schnell` (4 steps) | Fast but low quality, washed-out details |
| `flux-2-dev` (20 steps) | Stunning ink illustrations, rich detail |

**Why FLUX-2-dev:**
- Produces dramatically better line work and cross-hatching detail
- 20 inference steps is the sweet spot (default is 25, but 20 is sufficient and faster)
- ~6 seconds for image generation (vs ~2s for schnell) — acceptable for a daily image

**API note:** All FLUX-2 models require **multipart FormData** (not JSON like schnell). The Workers AI binding needs a workaround: serialize FormData via `new Response(form)` to get the body stream and content-type with boundary, then pass to `env.AI.run()` as `{ multipart: { body, contentType } }`.

---

## 2. Art Style: Ink Illustration (not pencil sketch)

### Decision: "Black ink pen editorial illustration with cross-hatching"

**Tried:**
| Style | Result on e-ink |
|-------|-----------------|
| Woodcut / wood-carving | Decent but too rough, lacked detail |
| Graphite pencil with soft shading | Beautiful raw image, but terrible after dithering — "dot soup" |
| Black ink pen editorial illustration | Perfect — inherently high-contrast, clean lines, cross-hatching works naturally on e-ink |

**Why ink illustration:**
- The style is *inherently binary* — black ink on white paper
- Cross-hatching creates shading through line density, not gray tones
- This means the image converts cleanly to the limited grayscale of e-ink displays
- Matches the aesthetic of classic newspaper editorial illustrations

**Prompt engineering:**
- Must include "no pens, no pencils, no drawing tools, no art supplies, no hands" — FLUX-2 sometimes draws the drawing tools in the scene
- "Plenty of white space, airy composition, avoid large solid black areas" — without this, FLUX-2-dev produces overly dense images that look muddy on e-ink
- "Delicate cross-hatching" and "thin precise lines" — lighter than "fine line work" alone
- "Filling the entire frame edge to edge" — prevents wasted white margins around the subject
- Earlier version used "no gray wash, no shading gradients" which pushed toward heavy black fills — removed in favor of the lighter approach

---

## 3. Output Format: 8-bit Grayscale (not 1-bit)

### Decision: Output full 8-bit grayscale PNG, no dithering

**Tried:**
| Approach | Result |
|----------|--------|
| Floyd-Steinberg dithering → 1-bit PNG | Ugly dot patterns everywhere, destroyed the illustration quality |
| Simple threshold → 1-bit PNG | Lost all mid-tone detail, harsh black/white transitions |
| Sigmoid contrast + Floyd-Steinberg | Still too many dots, just more aggressive |
| **8-bit grayscale PNG (no processing)** | **Beautiful — preserves the full illustration quality** |

**Why grayscale:**
- The "dots" problem was fundamental to 1-bit conversion — no algorithm could fix it
- Most e-ink displays support 16 gray levels and handle their own optimal dithering
- The display's hardware dithering is tuned for its specific panel and is always better than generic software dithering
- File size is larger (~150-230KB vs ~20-30KB for 1-bit) but well within KV limits and acceptable for daily refresh

**Key insight:** We discovered the raw JPEG from FLUX-2-dev looked spectacular. Every processing step (contrast enhancement, dithering) only made it worse. The best approach was to do as little as possible — just convert to grayscale and add text.

---

## 4. JPEG to PNG Conversion

### Decision: Cloudflare Images binding for JPEG → PNG transcoding

**Why:**
- FLUX models return JPEG (base64-encoded), but our PNG decoder only handles PNG
- Cloudflare Images provides a server-side `input().output()` API for format conversion
- API pattern: `(await env.IMAGES.input(jpegBytes).output({ format: "image/png" })).response()`
- Requires the Images paid subscription but is very cheap for our volume

**Gotcha:** The `.output()` call returns a Promise — you must `await` it before calling `.response()`. Wrong: `env.IMAGES.input(bytes).output({format}).response()`. Right: `(await env.IMAGES.input(bytes).output({format})).response()`.

---

## 5. Text Overlay Layout

### Decision: Two-line overlay at the bottom of the image

**Layout:**
```
                    Event Title (centered)
Location (left)                    Date, Year (right)
```

**Tried:**
| Layout | Result |
|--------|--------|
| White info strip at bottom (64px) | Wasted space, broke the full-bleed aesthetic |
| Single line: location + title + date | Text overlapped — too much for 800px at readable font size |
| **Two lines: title above, location/date below** | **Clean, no overlap, all info visible** |

**Implementation:**
- White text (255) on black backing rectangle (0) for readability on any background
- 8x8 bitmap font scaled 2x (16px tall)
- Custom glyph renderer writes directly to the grayscale buffer
- Location and title are truncated with "..." if too long

---

## 6. LLM for Event Selection

### Decision: Llama 3.3 70B with structured JSON output

**Why Llama 3.3 70B:**
- Available on Workers AI as `@cf/meta/llama-3.3-70b-instruct-fp8-fast`
- Good at following structured output instructions (JSON)
- Creative enough to pick visually interesting events and write compelling scene descriptions

**Response handling:**
- The LLM `.response` field may not be a string — always coerce: `typeof raw === "string" ? raw : JSON.stringify(raw)`
- The model sometimes wraps JSON in markdown fences — extraction tries direct parse, then regex, then first-`{`-to-last-`}`
- Temperature 0.7 gives good variety without being too random

**Event filtering:**
- Pre-filter to 1800–2000 era events (more visually recognizable)
- Cap at 20 events to stay within context window
- Fallback to first event with generic prompt if LLM fails

---

## 7. Caching Strategy

### Decision: KV cache with versioned keys and 24h TTL

**Cache key format:** `factpng:v9:YYYY-MM-DD`

**Why versioned keys:**
- During development, changing the pipeline (model, style, output format) required invalidating old cached images
- Bumping the version (`v3` → `v4` → ... → `v9`) forces regeneration without manually deleting KV keys
- In production, the version stays fixed

**Timezone:** Cache keys use America/Chicago date (the target location). This avoids serving yesterday's image when it's past midnight UTC but still the same day in Chicago.

**Pre-warming:** A daily cron at 10:00 UTC (4:00 AM Chicago) generates and caches the day's image so the first viewer gets a fast response.

---

## 8. PNG Encoder: Pure JavaScript

### Decision: Custom PNG encoder using Web APIs

**Why custom:**
- Cloudflare Workers don't support native Node.js image libraries (sharp, canvas, etc.)
- We needed both 1-bit (initially) and 8-bit grayscale PNG encoding
- The PNG format is simple enough to implement: IHDR + IDAT (zlib-compressed scanlines) + IEND

**Implementation:**
- CRC32 lookup table for chunk checksums
- Adler32 for zlib wrapper
- `CompressionStream("deflate-raw")` Web API for compression (available in Workers)
- Zlib header wrapping (CMF=0x78, FLG=0x01) around the raw deflate output

**PNG decoder** handles 8-bit RGB, RGBA, Grayscale, and GrayAlpha color types, with sub/up/average/paeth filter reconstruction.

---

## 9. btoa Stack Overflow Fix

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

## 10. HTML Endpoints for SenseCraft HMI

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

## 11. What We Didn't Do (and why)

| Consideration | Decision | Reason |
|---------------|----------|--------|
| External APIs (DALL-E, Google) | Stayed with Workers AI | No API keys needed, lower latency, simpler architecture |
| Client-side rendering | Server-side PNG | E-ink devices have limited processing power |
| Color output | Grayscale only | Target display is grayscale e-ink |
| Multiple image styles | Single ink illustration style | Consistent aesthetic, proven to work well on e-ink |
| User-configurable location | Hardcoded Naperville, IL | Single-user deployment; easy to change in code |
