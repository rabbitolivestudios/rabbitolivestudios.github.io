/**
 * Skyline HTML pages for reTerminal E1002 (Spectra 6) and E1001 (mono).
 *
 * /skyline       — live skyline (img src points to /skyline.png with forwarded params)
 * /skyline-test  — test with date/city/style overrides (forwards ALL query params)
 *
 * HTML wrappers are always no-store so SenseCraft re-fetches on each screenshot,
 * and the <img src> triggers a fresh (or bucket-cached) .png fetch each time.
 */

import { spectra6CSS } from "../spectra6";
import { htmlResponse } from "../response";

/**
 * Build a skyline HTML page that loads the image via <img src>.
 * The query string is forwarded so rotation params reach the .png endpoint.
 */
function renderSkylineHTML(pngPath: string, queryString: string): string {
  const src = queryString ? `${pngPath}?${queryString}` : pngPath;
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=800">
<title>World Skyline Series</title>
<style>
  :root { ${spectra6CSS()} }
  * { margin: 0; padding: 0; }
  html, body { width: 100%; height: 100%; overflow: hidden; background: #fff; }
  img { display: block; width: 800px; height: 480px; object-fit: cover; }
</style>
</head>
<body>
  <img src="${src}" width="800" height="480" alt="World Skyline Series">
</body>
</html>`;
}

/** Serve /skyline — forwards query string to /skyline.png */
export function skylinePageResponse(queryString: string): Response {
  const html = renderSkylineHTML("/skyline.png", queryString);
  return htmlResponse(html, "no-store");
}

/** Serve /skyline-test — forwards ALL query params to /skyline-test.png */
export function skylineTestPageResponse(queryString: string): Response {
  const html = renderSkylineHTML("/skyline-test.png", queryString);
  return htmlResponse(html, "no-store");
}
