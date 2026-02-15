import { getWeatherInfo } from "./weather-codes";
import { fetchAlerts, fetchAlertsForLocation } from "./alerts";
import type { Env, WeatherResponse, HourlyEntry, DailyEntry, CachedValue } from "./types";

const LAT = 41.7508;
const LON = -88.1535;
const CACHE_KEY = "weather:60540:v2";
const CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes

const WIND_DIRS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"] as const;

const OPEN_METEO_URL =
  `https://api.open-meteo.com/v1/forecast` +
  `?latitude=${LAT}&longitude=${LON}` +
  `&current=temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m,wind_direction_10m,is_day,wind_gusts_10m` +
  `&hourly=temperature_2m,precipitation_probability,precipitation,weather_code,wind_speed_10m,is_day` +
  `&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max,weather_code,sunrise,sunset,precipitation_sum,snowfall_sum` +
  `&minutely_15=precipitation&forecast_minutely_15=8&past_minutely_15=0` +
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
    const [res, alerts] = await Promise.all([
      fetch(OPEN_METEO_URL),
      fetchAlerts(env),
    ]);
    if (!res.ok) {
      throw new Error(`Open-Meteo returned ${res.status}`);
    }
    const raw: any = await res.json();
    const weather = normalize(raw, alerts);

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

function windDirLabel(deg: number): string {
  return WIND_DIRS[Math.round(deg / 45) % 8];
}

function normalize(raw: any, alerts: import("./types").NWSAlert[]): WeatherResponse {
  const current = raw.current;
  const hourly = raw.hourly;
  const daily = raw.daily;
  const currentIsDay = current.is_day === 1;
  const condInfo = getWeatherInfo(current.weather_code, currentIsDay);

  const hourly12h: HourlyEntry[] = [];
  const hourlyLen = Math.min(hourly.time.length, 24);
  for (let i = 0; i < hourlyLen; i++) {
    const isDay = hourly.is_day?.[i] === 1;
    const info = getWeatherInfo(hourly.weather_code[i], isDay);
    hourly12h.push({
      time: hourly.time[i],
      temp_c: Math.round(hourly.temperature_2m[i]),
      precip_prob_pct: hourly.precipitation_probability[i] ?? 0,
      precip_mm: round2(hourly.precipitation[i] ?? 0),
      code: hourly.weather_code[i],
      icon: info.icon,
      is_day: isDay,
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
      precipitation_sum_mm: round2(daily.precipitation_sum?.[i] ?? 0),
      snowfall_sum_cm: round2(daily.snowfall_sum?.[i] ?? 0),
      code: daily.weather_code[i],
      icon: info.icon,
      sunrise: daily.sunrise[i],
      sunset: daily.sunset[i],
    });
  }

  // Extract 15-min precipitation for next 2 hours (up to 8 values)
  const precip_next_2h: number[] = [];
  const minutely15 = raw.minutely_15;
  if (minutely15?.precipitation) {
    for (let i = 0; i < Math.min(minutely15.precipitation.length, 8); i++) {
      precip_next_2h.push(round2(minutely15.precipitation[i] ?? 0));
    }
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
      wind_dir_label: windDirLabel(current.wind_direction_10m),
      wind_gusts_kmh: Math.round(current.wind_gusts_10m ?? 0),
      is_day: currentIsDay,
      precip_mm_hr: round2(current.precipitation),
      condition: {
        code: current.weather_code,
        label: condInfo.label,
        icon: condInfo.icon,
      },
    },
    hourly_12h: hourly12h,
    daily_5d: daily5d,
    precip_next_2h,
    alerts,
    sunrise: daily5d[0]?.sunrise ?? "",
    sunset: daily5d[0]?.sunset ?? "",
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Fetch weather for a specific location (different from the default Naperville).
 * Used by the E1002 color weather page.
 */
export async function getWeatherForLocation(
  env: Env,
  lat: number,
  lon: number,
  zip: string,
  name: string,
): Promise<WeatherResponse> {
  const cacheKey = `weather:${zip}:v2`;
  const alertsCacheKey = `alerts:${zip}:v1`;

  const cached = await env.CACHE.get<CachedValue<WeatherResponse>>(cacheKey, "json");
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return cached.data;
  }

  try {
    const url =
      `https://api.open-meteo.com/v1/forecast` +
      `?latitude=${lat}&longitude=${lon}` +
      `&current=temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m,wind_direction_10m,is_day,wind_gusts_10m` +
      `&hourly=temperature_2m,precipitation_probability,precipitation,weather_code,wind_speed_10m,is_day` +
      `&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max,weather_code,sunrise,sunset,precipitation_sum,snowfall_sum` +
      `&minutely_15=precipitation&forecast_minutely_15=8&past_minutely_15=0` +
      `&timezone=America%2FChicago` +
      `&forecast_days=5` +
      `&forecast_hours=24`;

    const [res, alerts] = await Promise.all([
      fetch(url),
      fetchAlertsForLocation(env, lat, lon, alertsCacheKey),
    ]);
    if (!res.ok) throw new Error(`Open-Meteo returned ${res.status}`);
    const raw: any = await res.json();
    const weather = normalizeForLocation(raw, alerts, lat, lon, zip, name);

    await env.CACHE.put(cacheKey, JSON.stringify({ data: weather, timestamp: Date.now() }));
    return weather;
  } catch (err) {
    if (cached) return cached.data;
    throw err;
  }
}

function normalizeForLocation(
  raw: any,
  alerts: import("./types").NWSAlert[],
  lat: number,
  lon: number,
  zip: string,
  name: string,
): WeatherResponse {
  const current = raw.current;
  const hourly = raw.hourly;
  const daily = raw.daily;
  const currentIsDay = current.is_day === 1;
  const condInfo = getWeatherInfo(current.weather_code, currentIsDay);

  const hourly12h: HourlyEntry[] = [];
  const hourlyLen = Math.min(hourly.time.length, 24);
  for (let i = 0; i < hourlyLen; i++) {
    const isDay = hourly.is_day?.[i] === 1;
    const info = getWeatherInfo(hourly.weather_code[i], isDay);
    hourly12h.push({
      time: hourly.time[i],
      temp_c: Math.round(hourly.temperature_2m[i]),
      precip_prob_pct: hourly.precipitation_probability[i] ?? 0,
      precip_mm: round2(hourly.precipitation[i] ?? 0),
      code: hourly.weather_code[i],
      icon: info.icon,
      is_day: isDay,
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
      precipitation_sum_mm: round2(daily.precipitation_sum?.[i] ?? 0),
      snowfall_sum_cm: round2(daily.snowfall_sum?.[i] ?? 0),
      code: daily.weather_code[i],
      icon: info.icon,
      sunrise: daily.sunrise[i],
      sunset: daily.sunset[i],
    });
  }

  const precip_next_2h: number[] = [];
  const minutely15 = raw.minutely_15;
  if (minutely15?.precipitation) {
    for (let i = 0; i < Math.min(minutely15.precipitation.length, 8); i++) {
      precip_next_2h.push(round2(minutely15.precipitation[i] ?? 0));
    }
  }

  return {
    location: { zip, name, lat, lon, tz: "America/Chicago" },
    updated_at: current.time,
    current: {
      temp_c: Math.round(current.temperature_2m),
      feels_like_c: Math.round(current.apparent_temperature),
      humidity_pct: Math.round(current.relative_humidity_2m),
      wind_kmh: Math.round(current.wind_speed_10m),
      wind_dir_deg: Math.round(current.wind_direction_10m),
      wind_dir_label: windDirLabel(current.wind_direction_10m),
      wind_gusts_kmh: Math.round(current.wind_gusts_10m ?? 0),
      is_day: currentIsDay,
      precip_mm_hr: round2(current.precipitation),
      condition: { code: current.weather_code, label: condInfo.label, icon: condInfo.icon },
    },
    hourly_12h: hourly12h,
    daily_5d: daily5d,
    precip_next_2h,
    alerts,
    sunrise: daily5d[0]?.sunrise ?? "",
    sunset: daily5d[0]?.sunset ?? "",
  };
}
