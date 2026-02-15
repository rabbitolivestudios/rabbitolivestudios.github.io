import type { Env, WeatherResponse, DailyEntry, DeviceData } from "../types";
import { getWeather } from "../weather";
import { fetchDeviceData } from "../device";

// Inline SVG weather icons — black on transparent, designed for e-ink
const ICONS: Record<string, string> = {
  clear: `<svg viewBox="0 0 32 32" fill="none" stroke="#000" stroke-width="2" stroke-linecap="round">
    <circle cx="16" cy="16" r="6" fill="#000" stroke="none"/>
    <line x1="16" y1="2" x2="16" y2="6"/><line x1="16" y1="26" x2="16" y2="30"/>
    <line x1="2" y1="16" x2="6" y2="16"/><line x1="26" y1="16" x2="30" y2="16"/>
    <line x1="6.1" y1="6.1" x2="8.9" y2="8.9"/><line x1="23.1" y1="23.1" x2="25.9" y2="25.9"/>
    <line x1="25.9" y1="6.1" x2="23.1" y2="8.9"/><line x1="8.9" y1="23.1" x2="6.1" y2="25.9"/>
  </svg>`,
  clear_night: `<svg viewBox="0 0 32 32" fill="none">
    <path d="M25 16a11 11 0 0 1-13-13 11 11 0 1 0 13 13z" fill="#000"/>
    <circle cx="22" cy="6" r="1" fill="#000"/><circle cx="26" cy="10" r="1.2" fill="#000"/><circle cx="24" cy="14" r="0.8" fill="#000"/>
  </svg>`,
  partly_cloudy: `<svg viewBox="0 0 32 32" fill="none" stroke="#000" stroke-width="2">
    <circle cx="12" cy="10" r="4" fill="#000" stroke="none"/>
    <line x1="12" y1="2" x2="12" y2="4" stroke-linecap="round"/><line x1="12" y1="16" x2="12" y2="18" stroke-linecap="round"/>
    <line x1="4" y1="10" x2="6" y2="10" stroke-linecap="round"/><line x1="18" y1="10" x2="20" y2="10" stroke-linecap="round"/>
    <line x1="6.3" y1="4.3" x2="7.7" y2="5.7" stroke-linecap="round"/><line x1="16.3" y1="4.3" x2="17.7" y2="5.7" stroke-linecap="round"/>
    <path d="M10 28h16a5 5 0 0 0 0-10h-1a7 7 0 0 0-13.6-1A4 4 0 0 0 10 28z" fill="#000"/>
  </svg>`,
  partly_cloudy_night: `<svg viewBox="0 0 32 32" fill="none">
    <path d="M18 4a6 6 0 0 1-7.5-7.5 6 6 0 1 0 7.5 7.5z" fill="#000" transform="translate(2,6) scale(0.7)"/>
    <path d="M10 28h16a5 5 0 0 0 0-10h-1a7 7 0 0 0-13.6-1A4 4 0 0 0 10 28z" fill="#000"/>
  </svg>`,
  cloudy: `<svg viewBox="0 0 32 32" fill="none">
    <path d="M8 26h18a6 6 0 0 0 0-12h-1a8 8 0 0 0-15.5-1A5 5 0 0 0 8 26z" fill="#000"/>
  </svg>`,
  fog: `<svg viewBox="0 0 32 32" fill="none" stroke="#000" stroke-width="2.5" stroke-linecap="round">
    <line x1="4" y1="10" x2="28" y2="10"/>
    <line x1="6" y1="16" x2="26" y2="16"/>
    <line x1="4" y1="22" x2="28" y2="22"/>
    <line x1="8" y1="28" x2="24" y2="28"/>
  </svg>`,
  drizzle: `<svg viewBox="0 0 32 32" fill="none">
    <path d="M8 18h16a5 5 0 0 0 0-10h-1a7 7 0 0 0-13.6-1A4 4 0 0 0 8 18z" fill="#000"/>
    <line x1="10" y1="22" x2="9" y2="25" stroke="#000" stroke-width="2" stroke-linecap="round"/>
    <line x1="16" y1="22" x2="15" y2="25" stroke="#000" stroke-width="2" stroke-linecap="round"/>
    <line x1="22" y1="22" x2="21" y2="25" stroke="#000" stroke-width="2" stroke-linecap="round"/>
  </svg>`,
  rain: `<svg viewBox="0 0 32 32" fill="none">
    <path d="M8 16h16a5 5 0 0 0 0-10h-1a7 7 0 0 0-13.6-1A4 4 0 0 0 8 16z" fill="#000"/>
    <line x1="10" y1="20" x2="8" y2="26" stroke="#000" stroke-width="2" stroke-linecap="round"/>
    <line x1="16" y1="20" x2="14" y2="26" stroke="#000" stroke-width="2" stroke-linecap="round"/>
    <line x1="22" y1="20" x2="20" y2="26" stroke="#000" stroke-width="2" stroke-linecap="round"/>
    <line x1="13" y1="24" x2="11" y2="30" stroke="#000" stroke-width="2" stroke-linecap="round"/>
    <line x1="19" y1="24" x2="17" y2="30" stroke="#000" stroke-width="2" stroke-linecap="round"/>
  </svg>`,
  snow: `<svg viewBox="0 0 32 32" fill="none" stroke="#000" stroke-width="2" stroke-linecap="round">
    <path d="M8 16h16a5 5 0 0 0 0-10h-1a7 7 0 0 0-13.6-1A4 4 0 0 0 8 16z" fill="#000" stroke="none"/>
    <circle cx="10" cy="22" r="1.5" fill="#000" stroke="none"/>
    <circle cx="16" cy="20" r="1.5" fill="#000" stroke="none"/>
    <circle cx="22" cy="22" r="1.5" fill="#000" stroke="none"/>
    <circle cx="13" cy="26" r="1.5" fill="#000" stroke="none"/>
    <circle cx="19" cy="26" r="1.5" fill="#000" stroke="none"/>
  </svg>`,
  thunder: `<svg viewBox="0 0 32 32" fill="none">
    <path d="M8 14h16a5 5 0 0 0 0-10h-1a7 7 0 0 0-13.6-1A4 4 0 0 0 8 14z" fill="#000"/>
    <polygon points="18,16 13,24 16,24 14,32 21,22 17,22 20,16" fill="#000"/>
  </svg>`,
  sunrise: `<svg viewBox="0 0 32 32" fill="none" stroke="#000" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
    <path d="M16 3v6" /><path d="M13 6l3-3 3 3"/>
    <line x1="5" y1="14" x2="8" y2="11"/><line x1="27" y1="14" x2="24" y2="11"/>
    <path d="M6 22a10 10 0 0 1 20 0" fill="none"/>
    <line x1="2" y1="22" x2="30" y2="22"/>
  </svg>`,
  sunset: `<svg viewBox="0 0 32 32" fill="none" stroke="#000" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
    <path d="M16 9v-6"/><path d="M13 6l3 3 3-3"/>
    <line x1="5" y1="14" x2="8" y2="11"/><line x1="27" y1="14" x2="24" y2="11"/>
    <path d="M6 22a10 10 0 0 1 20 0" fill="none"/>
    <line x1="2" y1="22" x2="30" y2="22"/>
  </svg>`,
  wind: `<svg viewBox="0 0 32 32" fill="none" stroke="#000" stroke-width="2.5" stroke-linecap="round">
    <path d="M3 10h16a3 3 0 1 0-3-3"/>
    <path d="M3 16h20a3 3 0 1 1-3 3"/>
    <path d="M3 22h12a3 3 0 1 0-3-3"/>
  </svg>`,
  house: `<svg viewBox="0 0 32 32" fill="#000">
    <path d="M16 3L2 16h4v13h8v-9h4v9h8V16h4L16 3z"/>
  </svg>`,
  droplet: `<svg viewBox="0 0 32 32" fill="#000">
    <path d="M16 3C16 3 6 16 6 22a10 10 0 0 0 20 0C26 16 16 3 16 3z"/>
  </svg>`,
};

function batteryIcon(level: number, charging: boolean, size: number): string {
  const bodyW = 24;
  const bodyH = 12;
  const bodyX = 2;
  const bodyY = 10;
  const fillW = Math.max(0, Math.min(bodyW, Math.round(bodyW * level / 100)));
  const bolt = charging
    ? `<polygon points="16,8 12,16 15,16 13,24 20,14 16,14 18,8" fill="#fff"/>`
    : "";
  return `<span style="display:inline-block;width:${size}px;height:${size}px;vertical-align:middle"><svg viewBox="0 0 32 32" fill="none">
    <rect x="${bodyX}" y="${bodyY}" width="${bodyW}" height="${bodyH}" rx="2" stroke="#000" stroke-width="2" fill="none"/>
    <rect x="${bodyX + 1}" y="${bodyY + 1}" width="${fillW}" height="${bodyH - 2}" fill="#000"/>
    <rect x="${bodyX + bodyW}" y="${bodyY + 3}" width="3" height="${bodyH - 6}" fill="#000" rx="1"/>
    ${bolt}
  </svg></span>`;
}

function icon(key: string, size: number): string {
  return `<span style="display:inline-block;width:${size}px;height:${size}px;vertical-align:middle">${ICONS[key] ?? ICONS.clear}</span>`;
}

function formatDate(isoDate: string): string {
  const d = new Date(isoDate + "T12:00:00");
  return d.toLocaleDateString("en-US", { weekday: "short", timeZone: "America/Chicago" }).toUpperCase();
}

function formatTime(isoTime: string): string {
  const hour = parseInt(isoTime.slice(11, 13), 10);
  if (hour === 0) return "12 AM";
  if (hour === 12) return "12 PM";
  if (hour < 12) return `${hour} AM`;
  return `${hour - 12} PM`;
}

function formatSunTime(isoTime: string): string {
  // Open-Meteo sunrise/sunset are ISO strings like "2025-02-14T06:42"
  const hour = parseInt(isoTime.slice(11, 13), 10);
  const min = isoTime.slice(14, 16);
  if (hour === 0) return `12:${min} AM`;
  if (hour === 12) return `12:${min} PM`;
  if (hour < 12) return `${hour}:${min} AM`;
  return `${hour - 12}:${min} PM`;
}

function formatDailyPrecip(d: DailyEntry): string {
  if (d.snowfall_sum_cm > 0) {
    const parts: string[] = [`${d.snowfall_sum_cm}cm snow`];
    if (d.precip_prob_pct > 0) parts.unshift(`${d.precip_prob_pct}%`);
    return parts.join(" | ");
  }
  if (d.precipitation_sum_mm > 0) {
    const parts: string[] = [`${d.precipitation_sum_mm}mm rain`];
    if (d.precip_prob_pct > 0) parts.unshift(`${d.precip_prob_pct}%`);
    return parts.join(" | ");
  }
  if (d.precip_prob_pct > 0) {
    return `${d.precip_prob_pct}% rain`;
  }
  return "";
}

function getRainWarning(w: WeatherResponse): string | null {
  // Check 15-min precipitation data for imminent rain
  if (w.precip_next_2h.length > 0) {
    for (let i = 0; i < w.precip_next_2h.length; i++) {
      if (w.precip_next_2h[i] > 0) {
        const minutes = (i + 1) * 15;
        if (minutes <= 30) return "Rain in 30 min";
        if (minutes <= 60) return "Rain in ~1h";
        return "Rain in ~2h";
      }
    }
  }
  // Fallback: check next 3 hourly entries for high probability
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  });
  const p = fmt.formatToParts(new Date());
  const pv = (t: string) => p.find(x => x.type === t)!.value;
  const nowISO = `${pv("year")}-${pv("month")}-${pv("day")}T${pv("hour")}:${pv("minute")}`;
  const futureHours = w.hourly_12h.filter(h => h.time >= nowISO);
  const next3 = futureHours.slice(0, 3);
  if (next3.some(h => h.precip_prob_pct > 70)) {
    return "Rain likely in next 3h";
  }
  return null;
}

function renderHTML(w: WeatherResponse, device: DeviceData | null = null): string {
  const now = new Date();
  const dateStr = now.toLocaleDateString("en-US", {
    weekday: "long",
    month: "short",
    day: "numeric",
    timeZone: "America/Chicago",
  });
  const timeStr = now.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/Chicago",
  });

  const cur = w.current;

  // Wind string (separate line to avoid wrapping)
  let windStr = `${icon("wind", 22)} ${cur.wind_dir_label} ${cur.wind_kmh} km/h`;
  if (cur.wind_gusts_kmh > cur.wind_kmh + 10) {
    windStr += ` | Gusts ${cur.wind_gusts_kmh} km/h`;
  }

  // Sunrise/sunset
  const sunLine = w.sunrise && w.sunset
    ? `<div class="cur-sun">${icon("sunrise", 28)} ${formatSunTime(w.sunrise)} &nbsp; ${icon("sunset", 28)} ${formatSunTime(w.sunset)}</div>`
    : "";

  // Daily forecast
  const dailyHTML = w.daily_5d.map(d => {
    const precipStr = formatDailyPrecip(d);
    return `
      <div class="day">
        <div class="day-name">${formatDate(d.date)}</div>
        <div class="day-icon">${icon(d.icon, 38)}</div>
        <div class="day-temps">${d.high_c}° / ${d.low_c}°</div>
        <div class="day-precip">${precipStr}</div>
      </div>`;
  }).join("");

  // Alert / rain warning banner (between daily and hourly)
  let bannerHTML = "";
  if (w.alerts.length > 0) {
    const names = w.alerts.map(a => a.event.toUpperCase()).join(", ");
    bannerHTML = `<div class="alert-banner">WARNING: ${names}</div>`;
  } else {
    const rainWarn = getRainWarning(w);
    if (rainWarn) {
      bannerHTML = `<div class="rain-warning">${rainWarn}</div>`;
    }
  }

  // Hourly forecast — filter to future hours only (Chicago time)
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  });
  const p = fmt.formatToParts(now);
  const pv = (t: string) => p.find(x => x.type === t)!.value;
  const nowISO = `${pv("year")}-${pv("month")}-${pv("day")}T${pv("hour")}:${pv("minute")}`;
  const futureHours = w.hourly_12h.filter(h => h.time >= nowISO);
  const hourlyHTML = futureHours.slice(0, 6).map(h => `
      <div class="hour">
        <div class="hour-time">${formatTime(h.time)}</div>
        <div class="hour-icon">${icon(h.icon, 28)}</div>
        <div class="hour-temp">${h.temp_c}°</div>
        <div class="hour-precip">${h.precip_prob_pct > 0 ? h.precip_prob_pct + "% rain" : ""}</div>
      </div>`).join("");

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=800">
<title>Weather - ${w.location.name}</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    width: 800px; height: 480px; overflow: hidden;
    background: #fff; color: #000;
    font-family: -apple-system, "Helvetica Neue", Arial, sans-serif;
    padding: 16px 28px;
  }

  .header {
    display: flex; justify-content: space-between; align-items: flex-start;
    margin-bottom: 8px;
  }
  .location { font-size: 26px; font-weight: 700; letter-spacing: 1px; }
  .header-right { text-align: right; }
  .datetime { font-size: 16px; font-weight: 500; }
  .battery { font-size: 15px; font-weight: 500; margin-top: 2px; }

  .current {
    display: flex; align-items: center; gap: 20px;
    margin-bottom: 4px;
  }
  .cur-temp { font-size: 80px; font-weight: 700; line-height: 1; }
  .cur-icon { line-height: 0; }
  .cur-details { font-size: 18px; }
  .cur-condition { font-size: 26px; font-weight: 700; margin-bottom: 4px; }
  .cur-meta { font-size: 18px; font-weight: 500; }
  .cur-sun { font-size: 18px; font-weight: 500; margin-top: 2px; }
  .cur-indoor { font-size: 16px; font-weight: 500; margin-top: 2px; display: flex; align-items: center; gap: 4px; }

  .divider {
    border: none; border-top: 2px solid #000;
    margin: 10px 0;
  }

  .section-label {
    font-size: 14px; font-weight: 700; letter-spacing: 1.5px;
    margin-bottom: 4px; text-transform: uppercase;
  }

  .daily {
    display: flex; gap: 12px; margin-bottom: 10px;
  }
  .day {
    flex: 1; text-align: center;
    border: 2px solid #000; border-radius: 6px;
    padding: 6px 4px;
  }
  .day-name { font-size: 16px; font-weight: 700; margin-bottom: 2px; }
  .day-icon { margin: 4px 0; line-height: 0; }
  .day-temps { font-size: 18px; font-weight: 700; }
  .day-precip { font-size: 14px; font-weight: 500; }

  .alert-banner {
    background: #000; color: #fff;
    font-size: 16px; font-weight: 700;
    padding: 6px 10px; text-align: center;
    margin-bottom: 8px;
  }
  .rain-warning {
    font-size: 16px; font-weight: 700;
    margin-bottom: 8px;
  }

  .hourly {
    display: flex; gap: 10px;
  }
  .hour {
    flex: 1; text-align: center;
    border: 2px solid #000; border-radius: 6px;
    padding: 6px 4px;
  }
  .hour-time { font-size: 15px; font-weight: 700; }
  .hour-icon { margin: 2px 0; line-height: 0; }
  .hour-temp { font-size: 18px; font-weight: 700; }
  .hour-precip { font-size: 14px; font-weight: 500; }
</style>
</head>
<body>
  <div class="header">
    <div class="location">${w.location.name.toUpperCase()}</div>
    <div class="header-right">
      <div class="datetime">${dateStr} | ${timeStr}</div>
      ${device ? `<div class="battery">${batteryIcon(device.battery_level, device.battery_charging, 20)} ${device.battery_level}%</div>` : ""}
    </div>
  </div>

  <div class="current">
    <div class="cur-temp">${cur.temp_c}°C</div>
    <div class="cur-icon">${icon(cur.condition.icon, 64)}</div>
    <div class="cur-details">
      <div class="cur-condition">${cur.condition.label}</div>
      <div class="cur-meta">
        Feels like ${cur.feels_like_c}°C | ${icon("droplet", 18)} ${cur.humidity_pct}%
      </div>
      <div class="cur-meta">${windStr}</div>
      ${device ? `<div class="cur-indoor">${icon("house", 20)}<span>${device.indoor_temp_c}°C</span><span>|</span>${icon("droplet", 16)}<span>${device.indoor_humidity_pct}%</span></div>` : ""}
      ${sunLine}
    </div>
  </div>

  <hr class="divider">

  <div class="section-label">5-Day Forecast</div>
  <div class="daily">${dailyHTML}
  </div>

  ${bannerHTML}

  <div class="section-label">Next Hours</div>
  <div class="hourly">${hourlyHTML}
  </div>
</body>
</html>`;
}

const TEST_ALERTS: Record<string, import("../types").NWSAlert[]> = {
  tornado: [
    { event: "Tornado Warning", severity: "Extreme", headline: "Tornado Warning issued for DuPage County", onset: "", expires: "" },
    { event: "Severe Thunderstorm Warning", severity: "Severe", headline: "Severe Thunderstorm Warning", onset: "", expires: "" },
  ],
  winter: [
    { event: "Winter Storm Warning", severity: "Severe", headline: "Winter Storm Warning issued for DuPage County", onset: "", expires: "" },
  ],
  flood: [
    { event: "Flash Flood Warning", severity: "Severe", headline: "Flash Flood Warning issued for DuPage County", onset: "", expires: "" },
  ],
};

export async function handleWeatherPageV2(env: Env, url: URL): Promise<Response> {
  const [weather, device] = await Promise.all([
    getWeather(env),
    fetchDeviceData(env),
  ]);

  // ?test-alert=tornado|winter|flood injects fake alerts for testing
  const testAlert = url.searchParams.get("test-alert");
  if (testAlert && TEST_ALERTS[testAlert]) {
    weather.alerts = TEST_ALERTS[testAlert];
  }
  // ?test-rain injects fake 15-min precipitation
  if (url.searchParams.has("test-rain")) {
    weather.precip_next_2h = [0, 0, 0.2, 0.5, 0.8, 0.3, 0, 0];
  }
  // ?test-temp=N overrides current temperature
  const testTemp = url.searchParams.get("test-temp");
  if (testTemp !== null) {
    weather.current.temp_c = parseInt(testTemp, 10);
  }
  // ?test-device injects fake device data
  const testDevice: DeviceData | null = url.searchParams.has("test-device")
    ? { battery_level: 73, battery_charging: false, indoor_temp_c: 22, indoor_humidity_pct: 45 }
    : device;

  const html = renderHTML(weather, testDevice);

  return new Response(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "public, max-age=900",
    },
  });
}
