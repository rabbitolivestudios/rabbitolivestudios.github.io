# E-Ink "Moment Before" Dashboard

A Cloudflare Workers backend for the **reTerminal E1001** (ESP32-S3, 7.5" ePaper, 800x480).
Every day it generates an AI ink illustration depicting the **moment just before** a famous historical event — the viewer sees the scene, the location, and the date, but must guess what's about to happen.

Also serves weather data for Naperville, IL and a daily "On This Day" historical fact — all free, no API keys required.

## The Concept

**"Moment Before"** — each day, the system:
1. Fetches all historical events for today's date from Wikipedia
2. An LLM (Llama 3.3 70B) picks the most visually dramatic event
3. FLUX-2-dev generates a black ink pen editorial illustration of the scene *just before* the event
4. The image is served as an 8-bit grayscale PNG with text overlay

Example: For the sinking of the Titanic, the image would show a grand ocean liner sailing calmly through dark waters, with a faint iceberg on the horizon. The text reads: **"Sinking of the Titanic"** / **"North Atlantic Ocean"** / **"Apr 14, 1912"**

## Endpoints

| Endpoint | Description | Cache |
|----------|-------------|-------|
| `GET /fact.png` | 800x480 grayscale "Moment Before" illustration | 24 hours |
| `GET /fact.json` | "On This Day" historical event (JSON) | 24 hours |
| `GET /fact-raw.jpg` | Raw AI-generated JPEG (before processing) | none |
| `GET /test.png?m=MM&d=DD` | Generate image for any date (e.g. `?m=10&d=20`) | none |
| `GET /weather.json` | Current + 12h hourly + 5-day forecast (metric) | 30 min |
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

Your worker URL will be printed. The daily cron runs at 10:00 UTC (4:00 AM Chicago).

### Step 5: Test

```bash
curl -o fact.png https://YOUR-URL.workers.dev/fact.png
open fact.png
```

---

## Image Pipeline

```
Wikipedia "On This Day" API
        │
        ▼
Llama 3.3 70B (picks event, writes scene + image prompt)
        │
        ▼
FLUX-2-dev (20 steps, multipart API) → JPEG
        │
        ▼
Cloudflare Images (JPEG → PNG conversion)
        │
        ▼
PNG decode → grayscale → resize to 800x480
        │
        ▼
Text overlay (title centered, location left, date right)
        │
        ▼
8-bit grayscale PNG encoder → KV cache (24h)
```

### Key Technical Details

- **Image model**: `@cf/black-forest-labs/flux-2-dev` via multipart FormData
- **LLM**: `@cf/meta/llama-3.3-70b-instruct-fp8-fast`
- **Output**: 8-bit grayscale PNG (no dithering — e-ink display handles conversion)
- **Art style**: Black ink pen editorial illustration with cross-hatching
- **PNG encoder/decoder**: Pure JavaScript using Web API `CompressionStream`/`DecompressionStream`
- **Text rendering**: Custom 8x8 bitmap font (CP437), scalable, white-on-black backing

---

## Architecture

```
┌─────────────┐     ┌──────────────────────┐     ┌──────────────┐
│  reTerminal  │────▶│  Cloudflare Worker    │────▶│  Wikipedia    │
│  E1001       │     │                      │     │  (events)     │
│  (ePaper)    │◀────│  ┌────────────────┐  │     └──────────────┘
└─────────────┘     │  │ Workers AI     │  │     ┌──────────────┐
                     │  │ • Llama 3.3   │  │────▶│  Open-Meteo   │
                     │  │ • FLUX-2-dev  │  │     │  (weather)    │
                     │  ├────────────────┤  │     └──────────────┘
                     │  │ Images API     │  │
                     │  │ (JPEG→PNG)     │  │
                     │  ├────────────────┤  │
                     │  │ KV Cache       │  │
                     │  │ (24h TTL)      │  │
                     │  └────────────────┘  │
                     └──────────────────────┘
```

### Cloudflare Bindings

| Binding | Service | Purpose |
|---------|---------|---------|
| `env.AI` | Workers AI | LLM + image generation |
| `env.IMAGES` | Cloudflare Images | JPEG → PNG conversion |
| `env.CACHE` | KV Namespace | Response caching (24h) |

---

## SenseCraft HMI Setup

### Page 1: Weather

1. Add a Data Source: URL (JSON) → `https://YOUR-URL.workers.dev/weather.json`, refresh every 60 min
2. Bind text components to `current.temp_c`, `current.condition.label`, `current.feels_like_c`, etc.
3. Bind 5-day forecast to `daily_5d[0..4]`

### Page 2: Moment Before

1. Add an Image component: `https://YOUR-URL.workers.dev/fact.png`, size 800x480, refresh every 24h
2. The image includes all text (title, location, date) — no additional components needed

---

## Troubleshooting

| Problem | Solution |
|---------|----------|
| 503 on `/fact.png` | Check `npx wrangler tail` for errors. Common: KV namespace ID mismatch |
| Stale image | Cache key uses Chicago timezone. Delete old keys: `npx wrangler kv key list --namespace-id=ID` |
| Pen/pencil artifacts | The prompt includes "no pens, no drawing tools" but FLUX occasionally adds them. Regenerate. |
| Image too large for KV | KV values max 25MB. Current images are ~150-230KB (well within limits) |
| Wrong location weather | Edit `src/weather.ts` — coordinates are hardcoded for Naperville, IL (60540) |

---

## License

MIT
