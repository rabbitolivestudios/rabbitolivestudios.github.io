import type { Env } from "./types";
import { generationLockKey } from "./cache-keys";

const AI_BUDGET_BLOCK_KEY = "ai-budget:v1:block";
const AI_BUDGET_BLOCK_TTL_SECONDS = 6 * 60 * 60;
const AI_BUDGET_BLOCK_MS = AI_BUDGET_BLOCK_TTL_SECONDS * 1000;

export interface AiBudgetBlock {
  source: string;
  message: string;
  createdAt: number;
  blockUntil: number;
}

export function isNeuronBudgetError(err: unknown): boolean {
  const msg = String((err as any)?.message ?? err).toLowerCase();
  return msg.includes("4006") || msg.includes("neurons");
}

export async function getAiBudgetBlock(env: Env): Promise<AiBudgetBlock | null> {
  const raw = await env.CACHE.get(AI_BUDGET_BLOCK_KEY);
  if (!raw) return null;
  try {
    const block = JSON.parse(raw) as AiBudgetBlock;
    if (Date.now() < block.blockUntil) return block;
  } catch { /* ignore malformed marker */ }
  return null;
}

export async function markAiBudgetExhausted(
  env: Env,
  source: string,
  err: unknown,
): Promise<boolean> {
  if (!isNeuronBudgetError(err)) return false;

  const message = String((err as any)?.message ?? err).slice(0, 300);
  const now = Date.now();
  const block: AiBudgetBlock = {
    source,
    message,
    createdAt: now,
    blockUntil: now + AI_BUDGET_BLOCK_MS,
  };

  await env.CACHE.put(AI_BUDGET_BLOCK_KEY, JSON.stringify(block), {
    expirationTtl: AI_BUDGET_BLOCK_TTL_SECONDS,
  });
  console.error(`AI budget marker set by ${source}: ${message}`);
  return true;
}

export async function assertAiBudgetAvailable(env: Env): Promise<void> {
  const block = await getAiBudgetBlock(env);
  if (!block) return;
  const mins = Math.ceil((block.blockUntil - Date.now()) / 60000);
  throw new Error(`AI budget temporarily paused after ${block.source}; retry in ~${mins} min`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Soft single-flight guard for cached AI generation.
 *
 * Cloudflare KV has no atomic "put if absent", so this is intentionally a
 * best-effort lock: it prevents most duplicate cold-cache generations and lets
 * a second request wait briefly for the first one to fill the real cache.
 */
export async function withGenerationLock<T>(
  env: Env,
  cacheKey: string,
  readCached: () => Promise<T | null>,
  generate: () => Promise<T>,
  options: { waitMs?: number; pollMs?: number; lockTtlSeconds?: number } = {},
): Promise<T> {
  const waitMs = options.waitMs ?? 18_000;
  const pollMs = options.pollMs ?? 1500;
  const lockTtlSeconds = options.lockTtlSeconds ?? 90;
  const lockKey = generationLockKey(cacheKey);

  const locked = await env.CACHE.get(lockKey);
  if (locked) {
    const deadline = Date.now() + waitMs;
    while (Date.now() < deadline) {
      await sleep(pollMs);
      const cached = await readCached();
      if (cached) return cached;
    }
  }

  const token = crypto.randomUUID();
  await env.CACHE.put(lockKey, token, { expirationTtl: lockTtlSeconds });

  try {
    const cached = await readCached();
    if (cached) return cached;
    return await generate();
  } finally {
    try {
      const current = await env.CACHE.get(lockKey);
      if (current === token) await env.CACHE.delete(lockKey);
    } catch { /* lock cleanup is best-effort */ }
  }
}
