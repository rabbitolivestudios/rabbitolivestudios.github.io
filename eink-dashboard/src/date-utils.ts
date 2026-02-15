/**
 * Shared Chicago timezone date helpers.
 *
 * All date logic in this project uses America/Chicago timezone
 * since the display device is located there.
 */

export function getChicagoDateParts(): { year: string; month: string; day: string; dateStr: string } {
  const now = new Date();
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = fmt.formatToParts(now);
  const year = parts.find((p) => p.type === "year")!.value;
  const month = parts.find((p) => p.type === "month")!.value;
  const day = parts.find((p) => p.type === "day")!.value;
  const dateStr = `${year}-${month}-${day}`;
  return { year, month, day, dateStr };
}

export function getChicagoDateISO(): string {
  return getChicagoDateParts().dateStr;
}
