export interface Env {
  CACHE: KVNamespace;
  AI: Ai;
  IMAGES: any;
  PHOTOS: R2Bucket;
  APOD_API_KEY?: string;
}

// --- Moment Before types ---

export interface MomentBeforeData {
  year: number;
  location: string;
  title: string;
  scene: string;
  imagePrompt: string;
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
  wind_dir_label: string;
  wind_gusts_kmh: number;
  is_day: boolean;
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
  is_day: boolean;
}

export interface DailyEntry {
  date: string;
  high_c: number;
  low_c: number;
  precip_prob_pct: number;
  precipitation_sum_mm: number;
  snowfall_sum_cm: number;
  code: number;
  icon: string;
  sunrise: string;
  sunset: string;
}

export interface NWSAlert {
  event: string;
  severity: string;
  headline: string;
  onset: string;
  expires: string;
}

export interface WeatherResponse {
  location: WeatherLocation;
  updated_at: string;
  current: CurrentWeather;
  hourly_12h: HourlyEntry[];
  daily_5d: DailyEntry[];
  precip_next_2h: number[];
  alerts: NWSAlert[];
  sunrise: string;
  sunset: string;
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

// --- Device types ---

export interface DeviceData {
  battery_level: number;       // 0-100
  battery_charging: boolean;
  indoor_temp_c: number;       // rounded to integer
  indoor_humidity_pct: number; // rounded to integer
}

// --- APOD types ---

export interface APODData {
  title: string;
  explanation: string;
  url: string;
  hdurl?: string;
  media_type: string;
  date: string;
  copyright?: string;
  thumbnail_url?: string;
}

// --- Headlines types ---

export interface Headline {
  title: string;
  source: string;
  timestamp: string;
  summary: string;
  category: "tariffs" | "markets" | "company" | "regulatory";
  link?: string;
}

// --- KV cache wrapper ---

export interface CachedValue<T> {
  data: T;
  timestamp: number;
}
