import type { Env, WeatherResponse } from "../types";
import { getWeather } from "../weather";

// Inline SVG weather icons — black on transparent, designed for e-ink
const ICONS: Record<string, string> = {
  clear: `<svg viewBox="0 0 32 32" fill="none" stroke="#000" stroke-width="2" stroke-linecap="round">
    <circle cx="16" cy="16" r="6" fill="#000" stroke="none"/>
    <line x1="16" y1="2" x2="16" y2="6"/><line x1="16" y1="26" x2="16" y2="30"/>
    <line x1="2" y1="16" x2="6" y2="16"/><line x1="26" y1="16" x2="30" y2="16"/>
    <line x1="6.1" y1="6.1" x2="8.9" y2="8.9"/><line x1="23.1" y1="23.1" x2="25.9" y2="25.9"/>
    <line x1="25.9" y1="6.1" x2="23.1" y2="8.9"/><line x1="8.9" y1="23.1" x2="6.1" y2="25.9"/>
  </svg>`,
  partly_cloudy: `<svg viewBox="0 0 32 32" fill="none" stroke="#000" stroke-width="2">
    <circle cx="12" cy="10" r="4" fill="#000" stroke="none"/>
    <line x1="12" y1="2" x2="12" y2="4" stroke-linecap="round"/><line x1="12" y1="16" x2="12" y2="18" stroke-linecap="round"/>
    <line x1="4" y1="10" x2="6" y2="10" stroke-linecap="round"/><line x1="18" y1="10" x2="20" y2="10" stroke-linecap="round"/>
    <line x1="6.3" y1="4.3" x2="7.7" y2="5.7" stroke-linecap="round"/><line x1="16.3" y1="4.3" x2="17.7" y2="5.7" stroke-linecap="round"/>
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
};

function icon(key: string, size: number): string {
  return `<span style="display:inline-block;width:${size}px;height:${size}px;vertical-align:middle">${ICONS[key] ?? ICONS.clear}</span>`;
}

function formatDate(isoDate: string): string {
  const d = new Date(isoDate + "T12:00:00");
  return d.toLocaleDateString("en-US", { weekday: "short", timeZone: "America/Chicago" }).toUpperCase();
}

function formatTime(isoTime: string): string {
  // Open-Meteo times are already in Chicago timezone, parse hour directly
  const hour = parseInt(isoTime.slice(11, 13), 10);
  if (hour === 0) return "12 AM";
  if (hour === 12) return "12 PM";
  if (hour < 12) return `${hour} AM`;
  return `${hour - 12} PM`;
}

function renderHTML(w: WeatherResponse): string {
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
  // Daily forecast
  const dailyHTML = w.daily_5d.map(d => `
      <div class="day">
        <div class="day-name">${formatDate(d.date)}</div>
        <div class="day-icon">${icon(d.icon, 32)}</div>
        <div class="day-temps">${d.high_c}° / ${d.low_c}°</div>
        <div class="day-precip">${d.precip_prob_pct > 0 ? d.precip_prob_pct + "% rain" : ""}</div>
      </div>`).join("");

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
        <div class="hour-icon">${icon(h.icon, 24)}</div>
        <div class="hour-temp">${h.temp_c}°</div>
        <div class="hour-precip">${h.precip_prob_pct > 0 ? h.precip_prob_pct + "% rain" : ""}</div>
      </div>`).join("");

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=800">
<title>Weather - Naperville, IL</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    width: 800px; height: 480px; overflow: hidden;
    background: #fff; color: #000;
    font-family: -apple-system, "Helvetica Neue", Arial, sans-serif;
    padding: 20px 28px;
  }

  .header {
    display: flex; justify-content: space-between; align-items: baseline;
    margin-bottom: 12px;
  }
  .location { font-size: 22px; font-weight: 700; letter-spacing: 1px; }
  .datetime { font-size: 16px; font-weight: 500; }

  .current {
    display: flex; align-items: center; gap: 20px;
    margin-bottom: 8px;
  }
  .cur-temp { font-size: 72px; font-weight: 700; line-height: 1; }
  .cur-icon { line-height: 0; }
  .cur-details { font-size: 16px; }
  .cur-condition { font-size: 22px; font-weight: 700; margin-bottom: 4px; }
  .cur-meta { font-size: 16px; font-weight: 500; }

  .divider {
    border: none; border-top: 2px solid #000;
    margin: 14px 0;
  }

  .section-label {
    font-size: 13px; font-weight: 700; letter-spacing: 1.5px;
    margin-bottom: 8px; text-transform: uppercase;
  }

  .daily {
    display: flex; gap: 12px; margin-bottom: 14px;
  }
  .day {
    flex: 1; text-align: center;
    border: 2px solid #000; border-radius: 6px;
    padding: 8px 4px;
  }
  .day-name { font-size: 14px; font-weight: 700; margin-bottom: 2px; }
  .day-icon { margin: 4px 0; line-height: 0; }
  .day-temps { font-size: 16px; font-weight: 700; }
  .day-precip { font-size: 12px; font-weight: 500; }

  .hourly {
    display: flex; gap: 10px;
  }
  .hour {
    flex: 1; text-align: center;
    border: 2px solid #000; border-radius: 6px;
    padding: 6px 4px;
  }
  .hour-time { font-size: 13px; font-weight: 700; }
  .hour-icon { margin: 2px 0; line-height: 0; }
  .hour-temp { font-size: 16px; font-weight: 700; }
  .hour-precip { font-size: 11px; font-weight: 500; }
</style>
</head>
<body>
  <div class="header">
    <div class="location">NAPERVILLE, IL</div>
    <div class="datetime">${dateStr} | ${timeStr}</div>
  </div>

  <div class="current">
    <div class="cur-temp">${cur.temp_c}°C</div>
    <div class="cur-icon">${icon(cur.condition.icon, 56)}</div>
    <div class="cur-details">
      <div class="cur-condition">${cur.condition.label}</div>
      <div class="cur-meta">
        Feels like ${cur.feels_like_c}°C | Humidity ${cur.humidity_pct}% | Wind ${cur.wind_kmh} km/h
      </div>
    </div>
  </div>

  <hr class="divider">

  <div class="section-label">5-Day Forecast</div>
  <div class="daily">${dailyHTML}
  </div>

  <div class="section-label">Next Hours</div>
  <div class="hourly">${hourlyHTML}
  </div>
</body>
</html>`;
}

export async function handleWeatherPage(env: Env): Promise<Response> {
  const weather = await getWeather(env);
  const html = renderHTML(weather);

  return new Response(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "public, max-age=1800",
    },
  });
}
