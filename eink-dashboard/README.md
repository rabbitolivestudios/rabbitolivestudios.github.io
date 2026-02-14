# E-Ink Weather + Fact Dashboard

A Cloudflare Workers backend for the **reTerminal E1001** (ESP32-S3, 7.5" ePaper, 800x480).
Serves weather data for Naperville, IL and a daily "On This Day" historical fact with a
woodcut-style image card — all free, no API keys required.

## Endpoints

| Endpoint | Description | Cache |
|----------|-------------|-------|
| `GET /weather.json` | Current + 12h hourly + 5-day forecast (metric) | 30 min |
| `GET /fact.json` | "On This Day" historical event | 24 hours |
| `GET /fact.png` | 800×480 monochrome woodcut card | 24 hours |
| `GET /health` | Status check | none |

---

## Deploy to Cloudflare (Step by Step)

### Prerequisites

You need **Node.js** installed on your computer. If you don't have it:
- Go to [https://nodejs.org](https://nodejs.org)
- Download the **LTS** version
- Run the installer (just click Next/Continue through everything)

### Step 1: Open a Terminal

- **Windows**: Press `Win + R`, type `cmd`, press Enter
- **Mac**: Press `Cmd + Space`, type `Terminal`, press Enter

### Step 2: Navigate to the Project Folder

```bash
cd path/to/eink-dashboard
```

Replace `path/to/eink-dashboard` with the actual path where this folder is on your computer.

### Step 3: Install Dependencies

```bash
npm install
```

This downloads the Cloudflare tools. Wait for it to finish.

### Step 4: Log in to Cloudflare

```bash
npx wrangler login
```

This opens your browser. Sign up or log in at [cloudflare.com](https://cloudflare.com) (free account). Click "Allow" when asked.

### Step 5: Create the Cache Storage

```bash
npx wrangler kv namespace create CACHE
```

This prints something like:

```
🌀 Creating namespace with title "eink-dashboard-CACHE"
✨ Success!
Add the following to your configuration file in your kv_namespaces array:
{ binding = "CACHE", id = "abc123def456..." }
```

**Copy the `id` value** (the long string like `abc123def456...`).

### Step 6: Paste the ID into the Config

Open the file `wrangler.toml` in any text editor (Notepad, TextEdit, etc.)
and find this line:

```toml
id = "YOUR_NAMESPACE_ID"
```

Replace `YOUR_NAMESPACE_ID` with the ID you copied. Save the file.

### Step 7: Deploy

```bash
npx wrangler deploy
```

This uploads your worker to Cloudflare's global network. It will print your URL:

```
Published eink-dashboard (1.2s)
  https://eink-dashboard.YOUR-ACCOUNT.workers.dev
```

**That URL is your base URL.** Save it — you'll use it in SenseCraft HMI.

### Step 8: Test It

Open these URLs in your browser (replace with your actual URL):

```
https://eink-dashboard.YOUR-ACCOUNT.workers.dev/health
https://eink-dashboard.YOUR-ACCOUNT.workers.dev/weather.json
https://eink-dashboard.YOUR-ACCOUNT.workers.dev/fact.json
https://eink-dashboard.YOUR-ACCOUNT.workers.dev/fact.png
```

Or test from terminal:

```bash
curl https://eink-dashboard.YOUR-ACCOUNT.workers.dev/health
curl https://eink-dashboard.YOUR-ACCOUNT.workers.dev/weather.json
curl https://eink-dashboard.YOUR-ACCOUNT.workers.dev/fact.json
curl -o fact.png https://eink-dashboard.YOUR-ACCOUNT.workers.dev/fact.png
```

Then open `fact.png` to see the woodcut-style card.

---

## Sample Responses

### /health

```json
{
  "status": "ok",
  "version": "1.0.0",
  "worker": "eink-dashboard",
  "timestamp": "2026-02-14T12:00:00.000Z"
}
```

### /weather.json

```json
{
  "location": {
    "zip": "60540",
    "name": "Naperville, IL",
    "lat": 41.7508,
    "lon": -88.1535,
    "tz": "America/Chicago"
  },
  "updated_at": "2026-02-14T08:00",
  "current": {
    "temp_c": 0,
    "feels_like_c": -4,
    "humidity_pct": 61,
    "wind_kmh": 19,
    "wind_dir_deg": 250,
    "precip_mm_hr": 0.00,
    "condition": {
      "code": 3,
      "label": "Overcast",
      "icon": "cloudy"
    }
  },
  "hourly_12h": [
    {
      "time": "2026-02-14T08:00",
      "temp_c": 0,
      "precip_prob_pct": 10,
      "precip_mm": 0.0,
      "code": 3,
      "icon": "cloudy"
    }
  ],
  "daily_5d": [
    {
      "date": "2026-02-14",
      "high_c": 3,
      "low_c": -5,
      "precip_prob_pct": 20,
      "code": 3,
      "icon": "cloudy",
      "sunrise": "2026-02-14T06:45",
      "sunset": "2026-02-14T17:22"
    }
  ]
}
```

### /fact.json

```json
{
  "date": "2026-02-14",
  "display_date": "Feb 14",
  "event": {
    "year": 1946,
    "text": "ENIAC, the first general-purpose electronic computer, is unveiled at the University of Pennsylvania.",
    "pages": [
      {
        "title": "ENIAC",
        "url": "https://en.wikipedia.org/wiki/ENIAC"
      }
    ]
  },
  "source": "Wikimedia On this day"
}
```

### /fact.png

An 800×480 monochrome PNG that looks like a woodcut engraving:

```
┌─╲╱╲╱╲╱╲╱╲╱╲╱╲╱╲╱╲╱╲╱╲╱╲╱╲╱╲╱╲╱╲╱╲─┐
│                                       │
│          ON THIS DAY                  │
│       ════════════════                │
│            Feb 14                     │
│       ════════════════                │
│                                       │
│   1946 -- ENIAC, the first            │
│   general-purpose electronic          │
│   computer, is unveiled at the        │
│   University of Pennsylvania.         │
│                                       │
│         Source: Wikipedia             │
└─╲╱╲╱╲╱╲╱╲╱╲╱╲╱╲╱╲╱╲╱╲╱╲╱╲╱╲╱╲╱╲╱╲─┘
```

---

## SenseCraft HMI Setup

Use the SenseCraft HMI tool to create screens for your reTerminal E1001.

### Page 1: Weather

1. Create a new page called **"Weather"**
2. Add a **Data Source**:
   - Type: URL (JSON)
   - URL: `https://eink-dashboard.YOUR-ACCOUNT.workers.dev/weather.json`
   - Refresh interval: **60 minutes**
3. Add **Text** components and bind them:

| Component | Bind to JSON path | Example display |
|-----------|-------------------|-----------------|
| Big temperature | `current.temp_c` | `0` |
| "°C" label | (static text) | `°C` |
| Condition | `current.condition.label` | `Overcast` |
| Feels like | `current.feels_like_c` | `-4` |
| Wind | `current.wind_kmh` | `19` |
| Humidity | `current.humidity_pct` | `61` |

4. For the **5-day forecast strip**, add 5 groups and bind:
   - Day 1 high: `daily_5d[0].high_c`
   - Day 1 low: `daily_5d[0].low_c`
   - Day 1 icon: `daily_5d[0].icon`
   - Day 2 high: `daily_5d[1].high_c`
   - ... and so on through `daily_5d[4]`

### Page 2: Fact of the Day

1. Create a new page called **"Fact"**
2. Add an **Image** component:
   - URL: `https://eink-dashboard.YOUR-ACCOUNT.workers.dev/fact.png`
   - Size: 800 × 480 (full screen)
   - Refresh interval: **24 hours**
3. Optionally, add text fields from `/fact.json`:
   - Date: `display_date`
   - Year: `event.year`
   - Fact text: `event.text`

### Refresh Intervals

| Page | Interval | Why |
|------|----------|-----|
| Weather | 60 minutes | Weather updates frequently; saves battery vs. shorter intervals |
| Fact | 24 hours | Changes once per day at 6:00 AM CST |

---

## How It Works

### Data Sources (All Free, No API Keys)

- **Weather**: [Open-Meteo](https://open-meteo.com) — open-source weather API
- **Facts**: [Wikipedia REST API](https://en.wikipedia.org/api/rest_v1/) — "On This Day" feed

### Caching

- Weather data is cached for **30 minutes** in Cloudflare KV
- Fact text and image are cached for **24 hours**
- A daily cron job at **6:00 AM CST** pre-renders the fact image
- If upstream APIs are down, stale cached data is served

### Image Generation

The fact card is generated entirely in pure JavaScript:
- No external image libraries or native dependencies
- 1-bit monochrome PNG (optimal for e-ink)
- "Woodcut" style: stipple noise background, hatched border, bitmap font text
- Exactly 800×480 pixels to match the display

---

## Troubleshooting

### "YOUR_NAMESPACE_ID" error on deploy

You forgot to paste the KV namespace ID. Run `npx wrangler kv namespace create CACHE` again and update `wrangler.toml`.

### Weather shows wrong location

The coordinates are hardcoded for Naperville, IL (ZIP 60540). If you need a different location, edit `src/weather.ts` and change `LAT` and `LON`.

### Fact image is blank or broken

Try visiting `/fact.json` first to check if the text data loads. If it does, the image generator should work. Clear the cache by redeploying: `npx wrangler deploy`.

### Rate limited (429 error)

The worker has a basic rate limit of 60 requests per minute per IP. Normal usage (device refreshing every 60 min) will never hit this.

---

## Architecture

```
┌─────────────┐     ┌──────────────────┐     ┌──────────────┐
│  reTerminal  │────▶│  Cloudflare      │────▶│  Open-Meteo   │
│  E1001       │     │  Worker          │     │  (weather)    │
│  (SenseCraft │◀────│                  │     └──────────────┘
│   HMI)       │     │  ┌──────────┐   │     ┌──────────────┐
└─────────────┘     │  │ KV Cache  │   │────▶│  Wikipedia    │
                     │  └──────────┘   │     │  (facts)      │
                     └──────────────────┘     └──────────────┘
```

## License

MIT
