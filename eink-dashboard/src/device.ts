import { fetchWithTimeout } from "./fetch-timeout";
import type { Env, CachedValue, DeviceData } from "./types";

export const E1001_DEVICE_ID = "20225290"; // Home — Naperville 60540
export const E1002_DEVICE_ID = "20225358"; // Office — Chicago 60606

const API_BASE = "https://sensecraft-hmi-api.seeed.cc/api/v1/user/device/iot_data";
// SenseCraft's API-Key here is a public/shared platform key (not a private project secret).
// See: README "SenseCraft API-Key Note" and DECISIONS.md section 17.
const API_KEY = "sk_Qln1QHIPN1VmsT3u5Fazbt9fthL6ywfG";
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

export async function fetchDeviceData(
  env: Env,
  deviceId: string = E1001_DEVICE_ID,
): Promise<DeviceData | null> {
  const cacheKey = `device:${deviceId}:v1`;

  // Check cache
  const cached = await env.CACHE.get<CachedValue<DeviceData>>(cacheKey, "json");
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    console.log(`Device ${deviceId}: cache hit`);
    return cached.data;
  }

  let attempts = 0;
  while (attempts < 2) {
    attempts++;
    try {
      const res = await fetchWithTimeout(`${API_BASE}/${deviceId}`, {
        headers: { "API-Key": API_KEY },
      }, 8000);
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
        cacheKey,
        JSON.stringify({ data, timestamp: Date.now() }),
        { expirationTtl: 3600 },
      );
      return data;
    } catch (err) {
      if (attempts >= 2) {
        console.error("SenseCraft device data error:", err);
      }
    }
  }

  if (cached) {
    console.log(`Device ${deviceId}: stale fallback`);
    return cached.data;
  }
  return null;
}
