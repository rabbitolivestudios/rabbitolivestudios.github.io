/**
 * Shared weather page UI helpers.
 *
 * Used by both weather2.ts (mono E1001) and color-weather.ts (Spectra 6 E1002).
 * Icons remain page-specific (different color schemes per display).
 */

import type { DailyEntry, WeatherResponse } from "./types";

/** Render an inline SVG icon from an icon map. */
export function icon(icons: Record<string, string>, key: string, size: number): string {
  return `<span style="display:inline-block;width:${size}px;height:${size}px;vertical-align:middle">${icons[key] ?? icons.clear}</span>`;
}

/** Format ISO date string to short weekday (e.g. "MON"). */
export function formatDate(isoDate: string): string {
  const d = new Date(isoDate + "T12:00:00");
  return d.toLocaleDateString("en-US", { weekday: "short", timeZone: "America/Chicago" }).toUpperCase();
}

/** Format ISO time string to 12h format (e.g. "3 PM"). */
export function formatTime(isoTime: string): string {
  const hour = parseInt(isoTime.slice(11, 13), 10);
  if (hour === 0) return "12 AM";
  if (hour === 12) return "12 PM";
  if (hour < 12) return `${hour} AM`;
  return `${hour - 12} PM`;
}

/** Format ISO time string to 12h with minutes (e.g. "6:42 AM"). */
export function formatSunTime(isoTime: string): string {
  const hour = parseInt(isoTime.slice(11, 13), 10);
  const min = isoTime.slice(14, 16);
  if (hour === 0) return `12:${min} AM`;
  if (hour === 12) return `12:${min} PM`;
  if (hour < 12) return `${hour}:${min} AM`;
  return `${hour - 12}:${min} PM`;
}

/** Format daily precipitation summary string. */
export function formatDailyPrecip(d: DailyEntry): string {
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
  if (d.precip_prob_pct > 0) return `${d.precip_prob_pct}% rain`;
  return "";
}

/** Check for imminent rain based on 15-min and hourly data. */
export function getRainWarning(w: WeatherResponse): string | null {
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
  if (next3.some(h => h.precip_prob_pct > 70)) return "Rain likely in next 3h";
  return null;
}
