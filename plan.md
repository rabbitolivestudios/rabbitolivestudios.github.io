# E-Ink Weather + Fact Dashboard — Implementation Plan

## Overview

Build a Cloudflare Workers backend that serves weather data and "On This Day" facts
optimized for the reTerminal E1001 (ESP32-S3, 7.5" e-ink, 800x480). All free, no API
keys required, with stable public URLs the user pastes into SenseCraft HMI.

---

## Repository Structure

```
eink-dashboard/
├── src/
│   ├── index.ts              # Main Worker: routing + scheduled handler
│   ├── weather.ts            # Open-Meteo fetch + normalize
│   ├── fact.ts               # Wikipedia "On This Day" fetch + normalize
│   ├── image.ts              # 800x480 1-bit PNG generator (woodcut card)
│   ├── png.ts                # Pure-JS minimal PNG encoder (1-bit)
│   ├── font.ts               # Bitmap font data (embedded pixel font)
│   ├── weather-codes.ts      # WMO weather_code → icon/label mapping
│   └── types.ts              # TypeScript interfaces
├── wrangler.toml             # Cloudflare Workers config
├── package.json
├── tsconfig.json
└── README.md                 # Step-by-step deploy guide + SenseCraft HMI setup
```

This lives inside a `eink-dashboard/` subdirectory of the existing GitHub Pages repo,
keeping the main site untouched.

---

## Step-by-Step Build Plan

### Step 1: Project Scaffold

- Create `eink-dashboard/` directory with `package.json`, `tsconfig.json`, `wrangler.toml`
- Dependencies: only `wrangler` (dev dependency) — everything else is pure JS/TS
- `wrangler.toml` configures:
  - Worker name: `eink-dashboard`
  - KV namespace binding: `CACHE` (user creates via CLI command in README)
  - Cron trigger: `0 12 * * *` (06:00 CST = 12:00 UTC)
  - Compatibility date: `2024-01-01`

### Step 2: Weather Module (`weather.ts`)

- **No geocoding call needed** — hardcode Naperville, IL coordinates:
  - Latitude: `41.7508`, Longitude: `-88.1535`
  - This avoids an extra API call and potential failures
- Fetch from Open-Meteo forecast API with imperial units:
  ```
  https://api.open-meteo.com/v1/forecast
    ?latitude=41.7508&longitude=-88.1535
    &current=temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m,wind_direction_10m
    &hourly=temperature_2m,precipitation_probability,precipitation,weather_code,wind_speed_10m
    &daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max,weather_code,sunrise,sunset
    &temperature_unit=fahrenheit
    &wind_speed_unit=mph
    &precipitation_unit=inch
    &timezone=America/Chicago
    &forecast_days=5
    &forecast_hours=12
  ```
- Normalize response into the specified JSON schema
- Cache in KV key `weather:60540` for 30 minutes
- On cache miss or expiry: fetch upstream, store, return
- On upstream failure with valid cache: return stale cache with `"stale": true`

### Step 3: Weather Code Mapping (`weather-codes.ts`)

- Map WMO weather codes to icon tokens + labels:
  - 0 → clear / "Clear sky"
  - 1,2,3 → partly_cloudy, cloudy / "Partly cloudy", "Overcast"
  - 45,48 → fog / "Fog"
  - 51,53,55 → drizzle / "Drizzle"
  - 61,63,65,80,81,82 → rain / "Rain"
  - 71,73,75,77,85,86 → snow / "Snow"
  - 95,96,99 → thunder / "Thunderstorm"
  - default → unknown / "Unknown"

### Step 4: Fact Module (`fact.ts`)

- Determine "today" in America/Chicago timezone
- Fetch from Wikipedia REST API (NO auth required):
  ```
  https://en.wikipedia.org/api/rest_v1/feed/onthisday/events/{MM}/{DD}
  ```
  - Just needs a `User-Agent` header (polite practice, not enforced)
- Event selection logic:
  1. Filter events with year between 1900–2005
  2. Sort by text length ascending (prefer short, clean summaries)
  3. Pick first one with text under 160 characters
  4. If none match criteria, take any event with shortest text
- Normalize into specified JSON schema
- Cache in KV key `fact:YYYY-MM-DD` for 24 hours
- Fallback on failure: `{ "text": "Did you know? The first website went live in 1991.", "year": 1991 }`

### Step 5: PNG Encoder (`png.ts`)

- Pure JavaScript PNG encoder for 1-bit (monochrome) images
- No external dependencies — works in Cloudflare Workers runtime
- Implementation:
  - Build raw PNG file bytes: signature + IHDR + IDAT + IEND
  - IHDR: width=800, height=480, bit depth=1, color type=0 (grayscale)
  - IDAT: filter each row (filter type 0 = None), compress with DeflateRaw
    via the `CompressionStream` API (available in Workers)
  - CRC32 for each chunk computed via lookup table
- Input: `Uint8Array` of packed 1-bit pixel data (100 bytes per row × 480 rows)
- Output: complete PNG file as `Uint8Array`

### Step 6: Bitmap Font (`font.ts`)

- Embed a simple bitmap font for text rendering at e-ink scale
- Two sizes:
  - Large: ~24px height for title ("ON THIS DAY") and date
  - Medium: ~16px height for body text and footer
- Approach: hardcode pixel data for ASCII printable characters (32–126)
  using compact binary arrays
- Provides function: `drawText(buffer, x, y, text, width, size)`
- Word-wrapping function for body text within max width

### Step 7: Image Generator (`image.ts`)

- Creates the 800×480 1-bit "woodcut/engraving" card
- Layout (all coordinates in pixels):
  ```
  ┌─────────────────────────────────────────────┐
  │  ╔═══════════════════════════════════════╗   │  Border: 8px hatched frame
  │  ║                                       ║   │
  │  ║        ON THIS DAY                    ║   │  Title: large font, centered
  │  ║        ─────────────                  ║   │  Decorative rule
  │  ║        February 14                    ║   │  Date: large font
  │  ║                                       ║   │
  │  ║   1929 — The Saint Valentine's Day    ║   │  Body: medium font, wrapped
  │  ║   Massacre takes place in Chicago.    ║   │
  │  ║                                       ║   │
  │  ║                                       ║   │
  │  ║   Source: Wikipedia                   ║   │  Footer: small text
  │  ╚═══════════════════════════════════════╝   │
  └─────────────────────────────────────────────┘
  ```
- "Woodcut" effects:
  - Hatched border: alternating diagonal lines (45° cross-hatch pattern)
  - Background: sparse stipple noise pattern (random dots ~2% density)
  - Decorative horizontal rules with engraved line pattern
  - Text rendered as solid black pixels on the stippled background
- Steps:
  1. Create 800×480 pixel buffer (all white = 1)
  2. Draw stipple noise on background
  3. Draw hatched border frame
  4. Render title, date, body text, footer using bitmap font
  5. Draw decorative rules
  6. Pack into 1-bit format and encode as PNG

### Step 8: Main Router (`index.ts`)

- Routes:
  - `GET /weather.json` → weather handler (check KV cache → fetch if miss)
  - `GET /fact.json` → fact handler (check KV cache → fetch if miss)
  - `GET /fact.png` → serve cached PNG from KV (or generate on-demand if miss)
  - `GET /health` → `{ "status": "ok", "version": "1.0.0", "worker": "eink-dashboard" }`
  - Everything else → 404
- Response headers:
  - `Content-Type: application/json` for JSON endpoints
  - `Content-Type: image/png` for fact.png
  - `Cache-Control: public, max-age=1800` for weather (30 min)
  - `Cache-Control: public, max-age=86400` for fact endpoints (24h)
  - `Access-Control-Allow-Origin: *` (CORS for SenseCraft)
- Basic rate limiting: use CF headers (`CF-Connecting-IP`) to track requests
  in a simple in-memory map (reset per isolate lifecycle); return 429 if >60 req/min

### Step 9: Scheduled Handler (Cron)

- Trigger: `0 12 * * *` (12:00 UTC = 06:00 CST)
- Actions:
  1. Determine today's date in America/Chicago
  2. Fetch and cache fact.json
  3. Generate and cache fact.png in KV (store as binary ArrayBuffer)
  4. Optionally warm weather cache

### Step 10: README

- **Deploy Guide** (copy-paste terminal commands):
  1. Install Node.js (link to nodejs.org)
  2. `cd eink-dashboard && npm install`
  3. `npx wrangler login` (opens browser)
  4. `npx wrangler kv namespace create CACHE` (copy the ID)
  5. Paste namespace ID into `wrangler.toml`
  6. `npx wrangler deploy`
  7. Note the worker URL: `https://eink-dashboard.<account>.workers.dev`
  8. Test: `curl https://eink-dashboard.<account>.workers.dev/health`
- **Endpoints** section with sample JSON
- **SenseCraft HMI Setup** with screenshots-style instructions:
  - Weather page: data source URL, field bindings, refresh 60min
  - Fact page: image component URL, refresh 24h
- **Troubleshooting** section

---

## Key Technical Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Geocoding | Hardcoded lat/lon | ZIP 60540 is fixed; avoids extra API call |
| Wikipedia endpoint | `en.wikipedia.org/api/rest_v1` | No auth required (vs api.wikimedia.org which wants a token) |
| PNG generation | Hand-rolled 1-bit encoder | No npm deps, works in Workers, tiny output |
| Font rendering | Embedded bitmap font | No Canvas API in Workers; bitmap is deterministic |
| Image style | Stipple + hatch patterns | Achieves "woodcut" look with pure math, no image assets |
| Rate limiting | In-memory per-isolate | Simple, sufficient for free tier protection |

## External API Calls (All Free, No Keys)

1. **Open-Meteo Forecast**: `https://api.open-meteo.com/v1/forecast` — unlimited free
2. **Wikipedia On This Day**: `https://en.wikipedia.org/api/rest_v1/feed/onthisday/events/{MM}/{DD}` — free, no auth

## File Creation Order

1. `package.json` + `tsconfig.json` + `wrangler.toml` (scaffold)
2. `src/types.ts` (interfaces)
3. `src/weather-codes.ts` (static mapping)
4. `src/weather.ts` (weather fetcher)
5. `src/fact.ts` (fact fetcher)
6. `src/png.ts` (PNG encoder)
7. `src/font.ts` (bitmap font)
8. `src/image.ts` (card generator)
9. `src/index.ts` (router + cron)
10. `README.md` (deploy guide)

## What the User Needs to Do After I Build This

1. Have Node.js installed (or install it — link provided)
2. Run 5 terminal commands (copy-paste from README)
3. Copy their worker URL
4. Paste URLs into SenseCraft HMI app
5. Deploy to device

No coding required.
