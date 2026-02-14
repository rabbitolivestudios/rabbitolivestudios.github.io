interface WeatherCodeInfo {
  label: string;
  icon: string;
}

const WEATHER_CODES: Record<number, WeatherCodeInfo> = {
  0:  { label: "Clear sky",          icon: "clear" },
  1:  { label: "Mainly clear",       icon: "clear" },
  2:  { label: "Partly cloudy",      icon: "partly_cloudy" },
  3:  { label: "Overcast",           icon: "cloudy" },
  45: { label: "Fog",                icon: "fog" },
  48: { label: "Depositing rime fog", icon: "fog" },
  51: { label: "Light drizzle",      icon: "drizzle" },
  53: { label: "Moderate drizzle",   icon: "drizzle" },
  55: { label: "Dense drizzle",      icon: "drizzle" },
  56: { label: "Freezing drizzle",   icon: "drizzle" },
  57: { label: "Heavy freezing drizzle", icon: "drizzle" },
  61: { label: "Slight rain",        icon: "rain" },
  63: { label: "Moderate rain",      icon: "rain" },
  65: { label: "Heavy rain",         icon: "rain" },
  66: { label: "Light freezing rain", icon: "rain" },
  67: { label: "Heavy freezing rain", icon: "rain" },
  71: { label: "Slight snow",        icon: "snow" },
  73: { label: "Moderate snow",      icon: "snow" },
  75: { label: "Heavy snow",         icon: "snow" },
  77: { label: "Snow grains",        icon: "snow" },
  80: { label: "Slight rain showers", icon: "rain" },
  81: { label: "Moderate rain showers", icon: "rain" },
  82: { label: "Violent rain showers", icon: "rain" },
  85: { label: "Slight snow showers", icon: "snow" },
  86: { label: "Heavy snow showers",  icon: "snow" },
  95: { label: "Thunderstorm",        icon: "thunder" },
  96: { label: "Thunderstorm with slight hail", icon: "thunder" },
  99: { label: "Thunderstorm with heavy hail",  icon: "thunder" },
};

export function getWeatherInfo(code: number): WeatherCodeInfo {
  return WEATHER_CODES[code] ?? { label: "Unknown", icon: "unknown" };
}
