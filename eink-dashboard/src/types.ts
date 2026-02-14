export interface Env {
  CACHE: KVNamespace;
}

// --- Weather types ---

export interface WeatherLocation {
  zip: string;
  name: string;
  lat: number;
  lon: number;
  tz: string;
}

export interface WeatherCondition {
  code: number;
  label: string;
  icon: string;
}

export interface CurrentWeather {
  temp_c: number;
  feels_like_c: number;
  humidity_pct: number;
  wind_kmh: number;
  wind_dir_deg: number;
  precip_mm_hr: number;
  condition: WeatherCondition;
}

export interface HourlyEntry {
  time: string;
  temp_c: number;
  precip_prob_pct: number;
  precip_mm: number;
  code: number;
  icon: string;
}

export interface DailyEntry {
  date: string;
  high_c: number;
  low_c: number;
  precip_prob_pct: number;
  code: number;
  icon: string;
  sunrise: string;
  sunset: string;
}

export interface WeatherResponse {
  location: WeatherLocation;
  updated_at: string;
  current: CurrentWeather;
  hourly_12h: HourlyEntry[];
  daily_5d: DailyEntry[];
}

// --- Fact types ---

export interface FactPage {
  title: string;
  url: string;
}

export interface FactEvent {
  year: number;
  text: string;
  pages: FactPage[];
}

export interface FactResponse {
  date: string;
  display_date: string;
  event: FactEvent;
  source: string;
}

// --- KV cache wrapper ---

export interface CachedValue<T> {
  data: T;
  timestamp: number;
}
