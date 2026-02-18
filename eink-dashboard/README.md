# E-Ink "Moment Before" Dashboard

A Cloudflare Workers backend for the **reTerminal E1001** (ESP32-S3, 7.5" ePaper, 800x480, monochrome) and **reTerminal E1002** (ESP32-S3, 7.3" E Ink Spectra 6, 800x480, 6-color).

Every day it generates an AI illustration depicting a famous historical event at its most iconic, dramatic moment — the viewer sees the scene, the location, and the date.

Also serves weather data for Naperville, IL, NASA APOD (Astronomy Picture of the Day), steel/trade headlines, and a daily "On This Day" historical fact.

## The Concept

**"Moment Before"** — each day, the system:
1. Fetches all historical events for today's date from Wikipedia
2. An LLM (Llama 3.3 70B) picks the most visually dramatic event
3. An image model generates an illustration of the event at its defining moment of action, with a daily rotating art style
4. Two versions are produced: a 4-level grayscale PNG (FLUX.2, rotating styles) and a 1-bit PNG (SDXL, 6 rotating styles with style-aware conversion)

Example: For the sinking of the Titanic, the image would show the ocean liner tilting steeply into dark water, lifeboats scattered on the sea below. The text reads: **"Sinking of the Titanic"** / **"North Atlantic Ocean"** / **"Apr 14, 1912"**

## Endpoints

| Endpoint | Description | Cache |
|----------|-------------|-------|
| `GET /weather` | 800x480 HTML weather dashboard (night icons, wind direction, sunrise/sunset, NWS alerts, rain warnings, indoor temp/humidity, battery level) | 15 min |
| `GET /fact` | 800x480 HTML page displaying the Moment Before image | 24 hours |
| `GET /fact.png` | 800x480 4-level grayscale "Moment Before" illustration (or birthday portrait on family birthdays) | 24 hours |
| `GET /fact1.png` | 800x480 1-bit "Moment Before" illustration (6 rotating styles) | 24 hours |
| `GET /fact.json` | "On This Day" historical event (JSON) | 24 hours |
| `GET /fact-raw.jpg` | Raw AI-generated JPEG (before processing) | none |
| `GET /test.png?m=MM&d=DD&key=KEY` | Generate 4-level image for any date (requires `TEST_AUTH_KEY` in production) | none |
| `GET /test1.png?m=MM&d=DD&style=NAME&key=KEY` | Generate 1-bit image for any date + optional style override (requires `TEST_AUTH_KEY`) | none |
| `GET /test-birthday.png?name=KEY&key=KEY` | Generate birthday portrait for a person (requires `TEST_AUTH_KEY`) | none |
| `GET /weather.json` | Current + 12h hourly + 5-day forecast + alerts (metric) | 15 min |
| `GET /weather?test-device` | Weather dashboard with fake device data (22°C, 45%, battery 73%) | none |
| **E1002 Color Endpoints** | | |
| `GET /color/weather` | 800x480 color HTML weather dashboard (Spectra 6 palette accents) | 30 min |
| `GET /color/moment` | 800x480 color "Moment Before" (Floyd-Steinberg dithered to 6 colors) | 24 hours |
| `GET /color/apod` | 800x480 color NASA APOD image (dithered to 6 colors) | 24 hours |
| `GET /color/headlines` | 800x480 color steel & trade headlines page | 6 hours |
| `GET /color/test-moment?m=MM&d=DD&style=ID&key=KEY` | Generate color moment for any date + optional style override (requires `TEST_AUTH_KEY`) | none |
| `GET /color/headlines?test-headlines` | Headlines page with fake test data | none |
| `GET /health` | Status check | none |

## Live URL

```
https://eink-dashboard.thiago-oliveira77.workers.dev
```

---

## Deploy to Cloudflare (Step by Step)

### Prerequisites

- **Node.js** — download from [nodejs.org](https://nodejs.org) (LTS version)
- A free [Cloudflare account](https://cloudflare.com)

### Step 1: Install Dependencies

```bash
cd eink-dashboard
npm install
```

### Step 2: Log in to Cloudflare

```bash
npx wrangler login
```

### Step 3: Create the Cache Storage

```bash
npx wrangler kv namespace create CACHE
```

Copy the `id` value from the output and paste it into `wrangler.toml`:

```toml
id = "your-namespace-id-here"
```

### Step 4: Deploy

```bash
npx wrangler deploy
```

Your worker URL will be printed. The cron runs daily at 06:05 UTC (images) and every 6 hours (headlines/weather).

### Step 5: Set Secrets (Optional)

```bash
npx wrangler secret put APOD_API_KEY
npx wrangler secret put TEST_AUTH_KEY
```

- **APOD_API_KEY**: Get a free key from [api.nasa.gov](https://api.nasa.gov). Falls back to `DEMO_KEY` (rate limited).
- **TEST_AUTH_KEY**: Protects expensive test endpoints (`/test.png`, `/test1.png`, `/test-birthday.png`, `/color/test-moment`, `/color/test-birthday`) from public abuse. When set, these routes require `?key=YOUR_KEY`. When not set (local dev), test routes work without auth.

### Step 5: Test

```bash
curl -o fact.png https://YOUR-URL.workers.dev/fact.png
curl -o fact1.png https://YOUR-URL.workers.dev/fact1.png
open fact.png fact1.png
```

---

## Image Pipelines

Two pipelines share the same LLM event selection (scene-only prompt), then each prepends its own art style and uses its own image model.

### Pipeline A: 4-level grayscale (`/fact.png`)

Uses **FLUX.2 klein-9b** with daily rotating art styles: Woodcut → Pencil Sketch → Charcoal (cycles by `dayOfYear % 3`). Falls back to SDXL with woodcut style if FLUX.2 fails.

```
Wikipedia "On This Day" API
        │
        ▼
Llama 3.3 70B (picks event, writes scene-only image prompt)
        │
        ▼
Prepend daily style (Woodcut / Pencil Sketch / Charcoal) + anti-text suffix
        │
        ▼
FLUX.2 klein-9b (4 steps, guidance 7.0) → JPEG  [fallback: SDXL 20 steps]
        │
        ▼
Cloudflare Images (JPEG → PNG conversion)
        │
        ▼
PNG decode → grayscale → center-crop → resize to 800x480
        │
        ▼
Caption bar (24px black bar: location left, title center, date right)
        │
        ▼
Tone curve (contrast 1.2, gamma 0.95) → quantize to 4 levels
        │
        ▼
8-bit grayscale PNG → KV cache (24h)
```

### Pipeline B: Style-aware 1-bit (`/fact1.png`)

Uses **SDXL** with 6 rotating styles, each with style-appropriate 1-bit conversion (Bayer dithering or histogram threshold).

**Styles**: woodcut (bayer8), silhouette_poster, linocut, bold_ink_noir, pen_and_ink, charcoal_block (all threshold). Style is picked deterministically by `djb2(date|title|location) % 6`. Test override: `/test1.png?style=NAME`.

```
Wikipedia "On This Day" API
        │
        ▼
Llama 3.3 70B (picks event, writes scene-only image prompt)
        │
        ▼
Pick style (djb2 hash of date+title+location % 6)
        │
        ▼
Prepend style prompt + anti-text suffix
        │
        ▼
SDXL (20 steps, guidance 6.5) → JPEG
        │
        ▼
Cloudflare Images (JPEG → PNG conversion)
        │
        ▼
PNG decode → grayscale → center-crop → resize to 800x480
        │
        ▼
Style-aware 1-bit conversion:
  • Bayer mode: tone curve → 8×8 ordered dithering
  • Threshold mode: tone curve → histogram-percentile threshold
  • Stabilization retry + guardrail fallback if black ratio outside range
        │
        ▼
Caption strip (16px white strip: location left, title center, date right)
        │
        ▼
1-bit PNG encoder → KV cache (24h)
```

### Pipeline C: Birthday Portrait (`/fact.png` on family birthdays)

On family birthday dates, `/fact.png` generates an artistic portrait instead of the regular Moment Before illustration. `/fact1.png` is not affected and always shows regular content.

```
Chicago date → birthday check (9 family members)
        │
        ├─ No birthday → regular Pipeline A (unchanged)
        │
        └─ Birthday found:
                │
                ▼
        Fetch up to 4 reference photos from R2 ("portraits/{key}_0.jpg" .. "{key}_3.jpg")
                │
                ▼
        Pick art style (currentYear % 10 → 10 rotating styles)
                │
                ▼
        FLUX.2 klein-9b (multipart FormData, guidance 7.0, reference images)
                │
                ▼
        base64 decode → JPEG→PNG → grayscale → center-crop → resize to 800×480
                │
                ▼
        Birthday caption (24px black bar: "Happy Birthday!" | "Name - age years" | style name)
                │
                ▼
        Tone curve → quantize 4 levels → 8-bit PNG → KV cache (24h)
```

**Art styles** rotate yearly: Woodcut, Watercolor, Art Nouveau, Pop Art, Impressionist, Ukiyo-e, Art Deco, Pointillist, Pencil Sketch, Charcoal.

**Reference photos** are stored in R2 (`eink-birthday-photos` bucket). Upload with:
```bash
npm run upload-photos
```

Photos go in `photos/portraits/` with naming: `{key}_0.jpg`, `{key}_1.jpg`, etc. (max 4 per person, pre-resized to <512x512).

### Pipeline D: Color Spectra 6 (`/color/moment`)

Uses **FLUX.2 klein-9b** (fallback SDXL) with 5 daily-rotating art styles optimized for 6-color dithering, then Floyd-Steinberg dithers to the Spectra palette.

**Styles** (rotate daily by `(dayOfYear - 1) % 5`): Gouache, Oil Painting, Graphic Novel, Ink + Wash, Color Woodblock. Test override: `/color/test-moment?m=7&d=20&style=ink_wash`.

```
Shared Moment (from KV cache or LLM)
        │
        ▼
Pick daily style (Gouache / Oil Painting / Graphic Novel / Ink+Wash / Woodblock)
        │
        ▼
Prepend style prompt + color palette suffix + anti-text suffix
        │
        ▼
FLUX.2 klein-9b → JPEG  [fallback: SDXL]
        │
        ▼
Cloudflare Images (JPEG → PNG) → decode RGB
        │
        ▼
Center-crop → resize to 800x480 (RGB)
        │
        ▼
Floyd-Steinberg dithering → 6-color Spectra palette indices
        │
        ▼
Palette-indexed PNG → base64 → inline in HTML page
        │
        ▼
KV cache (24h)
```

**Spectra 6 palette**: Black (0,0,0), White (255,255,255), Red (178,19,24), Yellow (239,222,68), Green (18,95,32), Blue (33,87,186).

### Key Technical Details

- **Image models**: FLUX.2 klein-9b (Pipeline A), SDXL (Pipeline B + fallback)
- **LLM**: `@cf/meta/llama-3.3-70b-instruct-fp8-fast` (scene-only prompts, no style baked in)
- **Art styles**: Daily rotation for Pipeline A (Woodcut / Pencil Sketch / Charcoal); 6-style rotation for Pipeline B (Woodcut / Silhouette / Linocut / Noir / Pen & Ink / Charcoal Block); 5-style rotation for Pipeline D (Gouache / Oil Painting / Graphic Novel / Ink+Wash / Color Woodblock)
- **4-level output**: 8-bit grayscale PNG quantized to 4 levels (0, 85, 170, 255)
- **1-bit output**: True 1-bit PNG with style-aware conversion (Bayer dithering or histogram threshold)
- **PNG encoder/decoder**: Pure JavaScript using Web API `CompressionStream`/`DecompressionStream`
- **Text rendering**: Custom 8x8 bitmap font (CP437), white-on-black (4-level) or black-on-white (1-bit)

---

## Architecture

```
┌─────────────┐     ┌──────────────────────┐     ┌──────────────┐
│  reTerminal  │────▶│  Cloudflare Worker    │────▶│  Wikipedia    │
│  E1001       │     │                      │     │  (events)     │
│  (mono ePaper│◀────│  ┌────────────────┐  │     └──────────────┘
└─────────────┘     │  │ Workers AI     │  │     ┌──────────────┐
┌─────────────┐     │  │ • Llama 3.3   │  │────▶│  Open-Meteo   │
│  reTerminal  │────▶│  │ • FLUX.2/SDXL │  │     │  (weather)    │
│  E1002       │     │  ├────────────────┤  │     └──────────────┘
│  (Spectra 6) │◀────│  │ Images API     │  │     ┌──────────────┐
└─────────────┘     │  │ (JPEG→PNG)     │  │────▶│  NWS API      │
                     │  ├────────────────┤  │     │  (alerts)     │
                     │  │ KV Cache       │  │     └──────────────┘
                     │  │ (24h/6h TTL)   │  │     ┌──────────────┐
                     │  ├────────────────┤  │────▶│  NASA APOD    │
                     │  │ R2 Bucket      │  │     │  (astronomy)  │
                     │  │ (photos)       │  │     └──────────────┘
                     │  └────────────────┘  │     ┌──────────────┐
                     └──────────────────────┘────▶│  Google News  │
                                                  │  + Fed Register│
                                                  │  (headlines)  │
                                                  └──────────────┘
```

### Cloudflare Bindings

| Binding | Service | Purpose |
|---------|---------|---------|
| `env.AI` | Workers AI | LLM + image generation (SDXL + FLUX.2) |
| `env.IMAGES` | Cloudflare Images | JPEG → PNG conversion |
| `env.CACHE` | KV Namespace | Response caching (24h/6h) |
| `env.PHOTOS` | R2 Bucket | Birthday reference photos |
| `env.APOD_API_KEY` | Secret | NASA APOD API key (optional, falls back to DEMO_KEY) |
| `env.TEST_AUTH_KEY` | Secret | Auth key for expensive test endpoints (optional, open in dev) |

### SenseCraft API-Key Note

`src/device.ts` uses the SenseCraft HMI `API-Key` header for the device data endpoint:
`https://sensecraft-hmi-api.seeed.cc/api/v1/user/device/iot_data/{DEVICE_ID}`.

**Device IDs:** E1001 = `20225290` (home, Naperville), E1002 = `20225358` (office, Chicago). Each weather page passes its own device ID so telemetry (battery, indoor temp/humidity) matches the physical device.

This key is treated as a **public/shared platform key** (not a private project secret). As of **February 16, 2026**, Seeed publishes the same key in official examples and notes it can be obtained from frontend source code:

- https://wiki.seeedstudio.com/reTerminal_E1002_Sensecraft_AI_dashboard/#query-device-information-from-sensecraft-api

Operationally, this means:
- It is suitable for accessing non-sensitive SenseCraft device telemetry for this project.
- It should not be treated as a strong authentication secret for sensitive data.

---

## SenseCraft HMI Setup (reTerminal E1001)

The reTerminal's SenseCraft HMI has a "Web Function" that screenshots a URL onto the e-ink display. No firmware coding needed.

### Initial Setup

1. Power on the reTerminal (flip switch on back to ON)
2. Connect to the device's WiFi AP (`reTerminal E1001-xxxx`) to configure your home WiFi
3. Go to [sensecraft.seeed.cc/hmi](https://sensecraft.seeed.cc/hmi) and create an account
4. In the **Workspace** tab, click **Add Device** and enter the pair code shown on the display

### Create Pages

**Page 1: Moment Before**
1. Click **Add Page** → choose **Web Function**
2. URL: `https://YOUR-URL.workers.dev/fact`
3. Click **Save**

**Page 2: Weather Dashboard**
1. Click **Add Page** → choose **Web Function**
2. URL: `https://YOUR-URL.workers.dev/weather`
3. Click **Save**

### Create Pagelist & Deploy

1. Select both pages and organize them into a **Pagelist**
2. Set the **Interval (min)** to **15** in the Device Status Bar at the top of the workspace
3. Click **Preview** to check how it looks
4. Click **Deploy** to send it to the device
5. If the device is asleep, press the button on the reTerminal to wake it

The display will automatically cycle between pages every 15 minutes. Each page effectively refreshes every 30 minutes (every other cycle). The fact image is cached for 24h in KV, so frequent fetches cost nothing.

### Firmware Update

1. Connect the reTerminal to your computer via **USB cable**
2. In SenseCraft HMI, go to **Workspace** → click **Device Flasher**
3. Select **reTerminal E1001** and choose the latest firmware version
4. Click **Flash** — do NOT disconnect USB or close the browser until complete
5. After flashing, re-do WiFi setup and re-pair the device

---

## Troubleshooting

| Problem | Solution |
|---------|----------|
| 503 on `/fact.png` or `/fact1.png` | Check `npx wrangler tail` for errors. Common: KV namespace ID mismatch |
| Stale image | Cache key uses Chicago timezone. Bump cache key version or delete old keys: `npx wrangler kv key list --namespace-id=ID` |
| Stale image in browser | Browser caches for 24h. Hard refresh with Cmd+Shift+R |
| Weather not updating on device | Check the Interval setting in SenseCraft HMI and that the device is online |
| Image too large for KV | KV values max 25MB. Current images are ~20-230KB (well within limits) |
| Wrong location weather | Edit `src/weather.ts` — coordinates are hardcoded for Naperville, IL (60540) |
| No weather alerts showing | NWS alerts only cover active US warnings. Check `api.weather.gov` for your area. Alerts cache for 5 min in KV. |
| Emoji not showing on display | ESP32-S3 renderer doesn't support emoji. Use inline SVG or text labels. |
| Faint text on display | All text must be pure black (#000). Grays are invisible on e-ink. |

---

## License

MIT
