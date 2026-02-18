/**
 * Color steel & trade headlines page for reTerminal E1002 (Spectra 6).
 *
 * Pure HTML page (no image pipeline) displaying 3-5 headline cards
 * with colored category badges.
 *
 * Route: /color/headlines
 */

import type { Env, Headline } from "../types";
import { getChicagoDateISO } from "../date-utils";
import { getHeadlines, getCurrentPeriod } from "../headlines";
import { spectra6CSS } from "../spectra6";
import { escapeHTML } from "../escape";

const CATEGORY_COLORS: Record<Headline["category"], string> = {
  tariffs: "var(--s6-red)",
  markets: "var(--s6-blue)",
  company: "var(--s6-green)",
  regulatory: "var(--s6-yellow)",
};

const CATEGORY_LABELS: Record<Headline["category"], string> = {
  tariffs: "TARIFFS",
  markets: "MARKETS",
  company: "INDUSTRY",
  regulatory: "REGULATORY",
};

const TEST_HEADLINES: Headline[] = [
  {
    title: "US Imposes 25% Steel Tariff on EU Imports",
    source: "Reuters",
    timestamp: "2026-02-15T14:30:00Z",
    summary: "The White House announced new Section 232 tariffs on European steel imports. EU officials warned of retaliatory measures.",
    category: "tariffs",
  },
  {
    title: "Steel Prices Hit 6-Month High on Supply Concerns",
    source: "Bloomberg",
    timestamp: "2026-02-15T12:00:00Z",
    summary: "Hot-rolled coil futures rose 3.2% as trade tensions limited import supply. Domestic producers are ramping up capacity.",
    category: "markets",
  },
  {
    title: "Nucor Reports Record Q4 Earnings",
    source: "CNBC",
    timestamp: "2026-02-15T10:15:00Z",
    summary: "Nucor Corp posted earnings above estimates driven by strong demand and pricing. CEO cited domestic infrastructure spending.",
    category: "company",
  },
  {
    title: "Commerce Dept Proposes New Anti-Dumping Rules",
    source: "Federal Register",
    timestamp: "2026-02-15T08:00:00Z",
    summary: "Proposed rules would streamline anti-dumping investigations for steel products. Public comment period opens March 1.",
    category: "regulatory",
  },
  {
    title: "China Steel Exports Surge Despite Trade Barriers",
    source: "Financial Times",
    timestamp: "2026-02-14T22:00:00Z",
    summary: "Chinese steel exports reached a 7-year high in January. Southeast Asian markets absorbed most of the overflow.",
    category: "tariffs",
  },
];

function formatTimestamp(ts: string): string {
  if (!ts) return "";
  try {
    const d = new Date(ts);
    return d.toLocaleDateString("en-US", {
      month: "short", day: "numeric",
      timeZone: "America/Chicago",
    });
  } catch {
    return ts.slice(0, 10);
  }
}

function renderHTML(headlines: Headline[], dateStr: string): string {
  const cardsHTML = headlines.slice(0, 5).map(h => {
    const badgeColor = CATEGORY_COLORS[h.category];
    const badgeLabel = CATEGORY_LABELS[h.category];
    const badgeTextColor = h.category === "regulatory" ? "#000" : "#fff";
    const ts = formatTimestamp(h.timestamp);

    return `
      <div class="card">
        <div class="card-header">
          <span class="badge" style="background:${badgeColor};color:${badgeTextColor}">${badgeLabel}</span>
          <span class="meta">${escapeHTML(h.source)}${ts ? ` | ${ts}` : ""}</span>
        </div>
        <div class="card-title">${escapeHTML(h.title)}</div>
        <div class="card-summary">${escapeHTML(h.summary)}</div>
      </div>`;
  }).join(`<div class="divider"></div>`);

  const noData = headlines.length === 0;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=800">
<title>Steel &amp; Trade Headlines</title>
<style>
  :root { ${spectra6CSS()} }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    width: 800px; height: 480px; overflow: hidden;
    background: #fff; color: #000;
    font-family: -apple-system, "Helvetica Neue", Arial, sans-serif;
    padding: 16px 28px;
  }
  .header {
    display: flex; justify-content: space-between; align-items: center;
    margin-bottom: 12px;
    padding-bottom: 8px;
    border-bottom: 3px solid #000;
  }
  .header-title { font-size: 22px; font-weight: 700; letter-spacing: 2px; }
  .header-date { font-size: 15px; font-weight: 500; }
  .card { margin-bottom: 4px; }
  .card-header {
    display: flex; align-items: center; gap: 8px;
    margin-bottom: 2px;
  }
  .badge {
    font-size: 11px; font-weight: 700; letter-spacing: 1px;
    padding: 2px 6px;
    display: inline-block;
  }
  .meta { font-size: 12px; font-weight: 500; }
  .card-title { font-size: 16px; font-weight: 700; margin-bottom: 2px; }
  .card-summary {
    font-size: 13px; font-weight: 400; line-height: 1.3;
  }
  .divider {
    border: none; border-top: 1px solid #000;
    margin: 6px 0;
  }
  .no-data {
    font-size: 18px; font-weight: 500;
    text-align: center;
    margin-top: 120px;
  }
</style>
</head>
<body>
  <div class="header">
    <div class="header-title">STEEL &amp; TRADE</div>
    <div class="header-date">${dateStr}</div>
  </div>
  ${noData ? '<div class="no-data">No headlines available. Check back later.</div>' : cardsHTML}
</body>
</html>`;
}

export async function handleColorHeadlinesPage(env: Env, url: URL): Promise<Response> {
  const dateStr = getChicagoDateISO();

  let headlines: Headline[];

  if (url.searchParams.has("test-headlines")) {
    headlines = TEST_HEADLINES;
  } else {
    const period = getCurrentPeriod();
    headlines = await getHeadlines(env, dateStr, period);
  }

  const html = renderHTML(headlines, dateStr);

  return new Response(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "public, max-age=21600",
    },
  });
}
