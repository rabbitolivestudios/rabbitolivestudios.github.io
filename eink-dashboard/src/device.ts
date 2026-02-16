import type { Env, CachedValue, DeviceData } from "./types";

const DEVICE_ID = "20225290";
const API_URL = `https://sensecraft-hmi-api.seeed.cc/api/v1/user/device/iot_data/${DEVICE_ID}`;
// SenseCraft's API-Key here is a public/shared platform key (not a private project secret).
// See: README "SenseCraft API-Key Note" and DECISIONS.md section 17.
const API_KEY = "sk_Qln1QHIPN1VmsT3u5Fazbt9fthL6ywfG";
const CACHE_KEY = `device:${DEVICE_ID}:v1`;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

export async function fetchDeviceData(env: Env): Promise<DeviceData | null> {
  // Check cache
  const cached = await env.CACHE.get<CachedValue<DeviceData>>(CACHE_KEY, "json");
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return cached.data;
  }

  let attempts = 0;
  while (attempts < 2) {
    attempts++;
    try {
      const res = await fetch(API_URL, {
        headers: { "API-Key": API_KEY },
      });
      if (!res.ok) {
        throw new Error(`SenseCraft returned ${res.status}`);
      }
      const json: any = await res.json();
      const result = json.result;
      if (!result) throw new Error("No result in response");

      const data: DeviceData = {
        battery_level: Math.round(result.battery?.level ?? 0),
        battery_charging: result.battery?.charging ?? false,
        indoor_temp_c: Math.round(result.sensor?.temp ?? 0),
        indoor_humidity_pct: Math.round(result.sensor?.humidity ?? 0),
      };

      await env.CACHE.put(
        CACHE_KEY,
        JSON.stringify({ data, timestamp: Date.now() })
      );
      return data;
    } catch (err) {
      if (attempts >= 2) {
        console.error("SenseCraft device data error:", err);
      }
    }
  }

  // Return stale cache or null
  if (cached) return cached.data;
  return null;
}
