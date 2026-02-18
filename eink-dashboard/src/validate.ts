/** Input validation helpers for test endpoint query parameters. */

export function parseMonth(s: string): number {
  const n = parseInt(s, 10);
  return (Number.isNaN(n) || n < 1 || n > 12) ? 1 : n;
}

export function parseDay(s: string): number {
  const n = parseInt(s, 10);
  return (Number.isNaN(n) || n < 1 || n > 31) ? 1 : n;
}

export function parseStyleIdx(s: string | null): number | undefined {
  if (s === null) return undefined;
  const n = parseInt(s, 10);
  return (Number.isNaN(n) || n < 0 || n > 9) ? 0 : n;
}
