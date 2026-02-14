import { getWeatherInfo } from "./weather-codes";
import type { Env, WeatherResponse, HourlyEntry, DailyEntry, CachedValue } from "./types";

const LAT = 41.7508;
const LON = -88.1535;
const CACHE_KEY = "weather:60540";
const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes

const OPEN_METEO_URL =
  `https://api.open-meteo.com/v1/forecast` +
  `?latitude=${LAT}&longitude=${LON}` +
  `&current=temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m,wind_direction_10m` +
  `&hourly=temperature_2m,precipitation_probability,precipitation,weather_code,wind_speed_10m` +
  `&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max,weather_code,sunrise,sunset` +
  `&timezone=America%2FChicago` +
  `&forecast_days=5` +
  `&forecast_hours=24`;

export async function getWeather(env: Env): Promise<WeatherResponse> {
  // Check cache
  const cached = await env.CACHE.get<CachedValue<WeatherResponse>>(CACHE_KEY, "json");
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return cached.data;
  }

  try {
    const res = await fetch(OPEN_METEO_URL);
    if (!res.ok) {
      throw new Error(`Open-Meteo returned ${res.status}`);
    }
    const raw: any = await res.json();
    const weather = normalize(raw);

    // Store in cache
    await env.CACHE.put(CACHE_KEY, JSON.stringify({ data: weather, timestamp: Date.now() }));
    return weather;
  } catch (err) {
    // Return stale cache if available
    if (cached) {
      return cached.data;
    }
    throw err;
  }
}

function normalize(raw: any): WeatherResponse {
  const current = raw.current;
  const hourly = raw.hourly;
  const daily = raw.daily;
  const condInfo = getWeatherInfo(current.weather_code);

  const now = new Date().toLocaleString("en-US", { timeZone: "America/Chicago" });
  const chicagoNow = new Date(now);

  const hourly12h: HourlyEntry[] = [];
  const hourlyLen = Math.min(hourly.time.length, 24);
  for (let i = 0; i < hourlyLen; i++) {
    const info = getWeatherInfo(hourly.weather_code[i]);
    hourly12h.push({
      time: hourly.time[i],
      temp_c: Math.round(hourly.temperature_2m[i]),
      precip_prob_pct: hourly.precipitation_probability[i] ?? 0,
      precip_mm: round2(hourly.precipitation[i] ?? 0),
      code: hourly.weather_code[i],
      icon: info.icon,
    });
  }

  const daily5d: DailyEntry[] = [];
  const dailyLen = Math.min(daily.time.length, 5);
  for (let i = 0; i < dailyLen; i++) {
    const info = getWeatherInfo(daily.weather_code[i]);
    daily5d.push({
      date: daily.time[i],
      high_c: Math.round(daily.temperature_2m_max[i]),
      low_c: Math.round(daily.temperature_2m_min[i]),
      precip_prob_pct: daily.precipitation_probability_max[i] ?? 0,
      code: daily.weather_code[i],
      icon: info.icon,
      sunrise: daily.sunrise[i],
      sunset: daily.sunset[i],
    });
  }

  return {
    location: {
      zip: "60540",
      name: "Naperville, IL",
      lat: LAT,
      lon: LON,
      tz: "America/Chicago",
    },
    updated_at: current.time,
    current: {
      temp_c: Math.round(current.temperature_2m),
      feels_like_c: Math.round(current.apparent_temperature),
      humidity_pct: Math.round(current.relative_humidity_2m),
      wind_kmh: Math.round(current.wind_speed_10m),
      wind_dir_deg: Math.round(current.wind_direction_10m),
      precip_mm_hr: round2(current.precipitation),
      condition: {
        code: current.weather_code,
        label: condInfo.label,
        icon: condInfo.icon,
      },
    },
    hourly_12h: hourly12h,
    daily_5d: daily5d,
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
