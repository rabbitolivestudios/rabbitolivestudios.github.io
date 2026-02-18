/**
 * Fetch wrapper with AbortController-based timeout.
 *
 * On timeout the AbortError propagates to existing try/catch blocks,
 * triggering stale-cache or fallback paths already in place.
 */
export async function fetchWithTimeout(
  input: RequestInfo,
  init?: RequestInit,
  timeoutMs = 10_000,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}
