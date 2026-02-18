/**
 * Color APOD page for reTerminal E1002 (Spectra 6).
 *
 * Displays NASA Astronomy Picture of the Day as a Spectra 6 dithered image
 * with title and copyright caption.
 *
 * Route: /color/apod
 */

import type { Env } from "../types";
import { getChicagoDateISO } from "../date-utils";
import { getAPODData, getAPODColorImage } from "../apod";
import { spectra6CSS } from "../spectra6";
import { escapeHTML } from "../escape";
import { htmlResponse } from "../response";

function renderImageHTML(imageB64: string, title: string, copyright?: string, date?: string): string {
  const copyrightText = copyright ? `&copy; ${escapeHTML(copyright)}` : "";
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=800">
<title>APOD - ${escapeHTML(title)}</title>
<style>
  :root { ${spectra6CSS()} }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    width: 800px; height: 480px; overflow: hidden;
    background: #000; color: #fff;
    font-family: -apple-system, "Helvetica Neue", Arial, sans-serif;
  }
  .image-container {
    width: 800px; height: 454px;
    overflow: hidden;
  }
  .image-container img {
    width: 800px; height: 454px;
    object-fit: cover;
    display: block;
  }
  .caption {
    width: 800px; height: 26px;
    background: #000; color: #fff;
    font-size: 13px; font-weight: 600;
    display: flex; align-items: center;
    padding: 0 16px;
    overflow: hidden;
    white-space: nowrap;
  }
  .caption-title { flex: 1; text-overflow: ellipsis; overflow: hidden; }
  .caption-date { flex-shrink: 0; margin-left: 12px; }
  .caption-copyright { flex-shrink: 0; margin-left: 12px; font-weight: 400; font-size: 11px; opacity: 0.8; }
</style>
</head>
<body>
  <div class="image-container">
    <img src="data:image/png;base64,${imageB64}" alt="${escapeHTML(title)}">
  </div>
  <div class="caption">
    <span class="caption-title">${escapeHTML(title)}</span>
    ${copyrightText ? `<span class="caption-copyright">${copyrightText}</span>` : ""}
    ${date ? `<span class="caption-date">${escapeHTML(date)}</span>` : ""}
  </div>
</body>
</html>`;
}

function renderTextFallback(title: string, explanation: string, date: string, copyright?: string): string {
  // Truncate explanation to fit 800x480
  const shortExplanation = explanation.length > 600 ? explanation.slice(0, 597) + "..." : explanation;
  const copyrightText = copyright ? `Credit: ${escapeHTML(copyright)}` : "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=800">
<title>APOD - ${escapeHTML(title)}</title>
<style>
  :root { ${spectra6CSS()} }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    width: 800px; height: 480px; overflow: hidden;
    background: #000; color: #fff;
    font-family: -apple-system, "Helvetica Neue", Arial, sans-serif;
    padding: 24px 32px;
  }
  .header { font-size: 12px; font-weight: 500; margin-bottom: 8px; color: var(--s6-blue); }
  .title { font-size: 28px; font-weight: 700; margin-bottom: 16px; }
  .explanation { font-size: 16px; line-height: 1.4; margin-bottom: 16px; }
  .credit { font-size: 13px; font-weight: 400; opacity: 0.7; }
</style>
</head>
<body>
  <div class="header">NASA ASTRONOMY PICTURE OF THE DAY | ${escapeHTML(date)}</div>
  <div class="title">${escapeHTML(title)}</div>
  <div class="explanation">${escapeHTML(shortExplanation)}</div>
  ${copyrightText ? `<div class="credit">${copyrightText}</div>` : ""}
</body>
</html>`;
}

export async function handleColorAPODPage(env: Env, url: URL): Promise<Response> {
  const dateStr = getChicagoDateISO();

  const [apod, imageB64] = await Promise.all([
    getAPODData(env, dateStr),
    getAPODColorImage(env, dateStr),
  ]);

  let html: string;

  if (apod && imageB64) {
    html = renderImageHTML(imageB64, apod.title, apod.copyright, apod.date);
  } else if (apod) {
    // Video or image processing failed — text fallback
    html = renderTextFallback(apod.title, apod.explanation, apod.date, apod.copyright);
  } else {
    // Complete failure
    html = renderTextFallback(
      "Astronomy Picture of the Day",
      "Unable to load today's APOD. Please try again later.",
      dateStr
    );
  }

  return htmlResponse(html, "public, max-age=86400");
}
