import type { SkylineMode } from "./skyline";

export const FACT4_CACHE_VERSION = "v4";
export const FACT1_CACHE_VERSION = "v7";
export const BIRTHDAY_CACHE_VERSION = "v1";
export const COLOR_MOMENT_CACHE_VERSION = "v2";
export const COLOR_BIRTHDAY_CACHE_VERSION = "v1";
export const MOMENT_CACHE_VERSION = "v1";
export const SKYLINE_CACHE_VERSION = "v3";

export function fact4CacheKey(dateStr: string): string {
  return `fact4:${FACT4_CACHE_VERSION}:${dateStr}`;
}

export function fact1CacheKey(dateStr: string): string {
  return `fact1:${FACT1_CACHE_VERSION}:${dateStr}`;
}

export function birthdayCacheKey(dateStr: string): string {
  return `birthday:${BIRTHDAY_CACHE_VERSION}:${dateStr}`;
}

export function colorMomentCacheKey(dateStr: string, styleId: string): string {
  return `color-moment:${COLOR_MOMENT_CACHE_VERSION}:${dateStr}:${styleId}`;
}

export function colorBirthdayCacheKey(dateStr: string): string {
  return `color-birthday:${COLOR_BIRTHDAY_CACHE_VERSION}:${dateStr}`;
}

export function momentCacheKey(dateStr: string): string {
  return `moment:${MOMENT_CACHE_VERSION}:${dateStr}`;
}

export function skylineCacheKey(
  dateStr: string,
  mode: Exclude<SkylineMode, "random">,
  rotateMin: number,
  bucket: number,
  bwOnly: boolean = false,
): string {
  const bwSuffix = bwOnly ? ":bw" : "";
  if (mode === "daily") {
    return `skyline:${SKYLINE_CACHE_VERSION}:${dateStr}:daily${bwSuffix}`;
  }
  return `skyline:${SKYLINE_CACHE_VERSION}:${dateStr}:r${rotateMin}:b${bucket}${bwSuffix}`;
}

export function generationLockKey(cacheKey: string): string {
  return `gen-lock:v1:${cacheKey}`;
}
