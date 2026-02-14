import type { Env, WeatherResponse } from "../types";
import { getWeather } from "../weather";

const ICON_EMOJI: Record<string, string> = {
  clear: "☀️",
  partly_cloudy: "⛅",
  cloudy: "☁️",
  fog: "🌫️",
  drizzle: "🌦️",
  rain: "🌧️",
  snow: "❄️",
  thunder: "⛈️",
  unknown: "❓",
};

function emoji(icon: string): string {
  return ICON_EMOJI[icon] ?? "❓";
}


function formatDate(isoDate: string): string {
  const d = new Date(isoDate + "T12:00:00");
  return d.toLocaleDateString("en-US", { weekday: "short", timeZone: "America/Chicago" }).toUpperCase();
}

function formatTime(isoTime: string): string {
  const d = new Date(isoTime);
  return d.toLocaleTimeString("en-US", { hour: "numeric", timeZone: "America/Chicago" });
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
        <div class="day-icon">${emoji(d.icon)}</div>
        <div class="day-temps">${d.high_c}° / ${d.low_c}°</div>
        <div class="day-precip">${d.precip_prob_pct}%💧</div>
      </div>`).join("");

  // Hourly forecast (next 6)
  const hourlyHTML = w.hourly_12h.slice(0, 6).map(h => `
      <div class="hour">
        <div class="hour-time">${formatTime(h.time)}</div>
        <div class="hour-icon">${emoji(h.icon)}</div>
        <div class="hour-temp">${h.temp_c}°</div>
        <div class="hour-precip">${h.precip_prob_pct > 0 ? h.precip_prob_pct + "%💧" : ""}</div>
      </div>`).join("");

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=800">
<title>Weather — Naperville, IL</title>
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
  .datetime { font-size: 16px; color: #333; }

  .current {
    display: flex; align-items: center; gap: 24px;
    margin-bottom: 8px;
  }
  .cur-temp { font-size: 72px; font-weight: 700; line-height: 1; }
  .cur-icon { font-size: 56px; }
  .cur-details { font-size: 16px; }
  .cur-condition { font-size: 20px; font-weight: 600; margin-bottom: 4px; }
  .cur-meta { font-size: 15px; color: #222; }

  .divider {
    border: none; border-top: 2px solid #000;
    margin: 14px 0;
  }

  .section-label {
    font-size: 13px; font-weight: 700; letter-spacing: 1.5px;
    color: #444; margin-bottom: 8px; text-transform: uppercase;
  }

  .daily {
    display: flex; gap: 12px; margin-bottom: 14px;
  }
  .day {
    flex: 1; text-align: center;
    border: 1px solid #ccc; border-radius: 6px;
    padding: 8px 4px;
  }
  .day-name { font-size: 14px; font-weight: 700; margin-bottom: 2px; }
  .day-icon { font-size: 28px; margin: 2px 0; }
  .day-temps { font-size: 15px; font-weight: 600; }
  .day-precip { font-size: 12px; color: #444; }

  .hourly {
    display: flex; gap: 10px;
  }
  .hour {
    flex: 1; text-align: center;
    border: 1px solid #ddd; border-radius: 6px;
    padding: 6px 4px;
  }
  .hour-time { font-size: 13px; font-weight: 600; }
  .hour-icon { font-size: 22px; margin: 2px 0; }
  .hour-temp { font-size: 15px; font-weight: 700; }
  .hour-precip { font-size: 11px; color: #444; }
</style>
</head>
<body>
  <div class="header">
    <div class="location">NAPERVILLE, IL</div>
    <div class="datetime">${dateStr} · ${timeStr}</div>
  </div>

  <div class="current">
    <div class="cur-temp">${cur.temp_c}°C</div>
    <div class="cur-icon">${emoji(cur.condition.icon)}</div>
    <div class="cur-details">
      <div class="cur-condition">${cur.condition.label}</div>
      <div class="cur-meta">
        Feels like ${cur.feels_like_c}°C · Humidity ${cur.humidity_pct}% · Wind ${cur.wind_kmh} km/h
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
