import { htmlResponse } from "../response";

export function handleFactPage(): Response {
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=800, initial-scale=1, maximum-scale=1">
<title>Moment Before</title>
<style>
* { margin: 0; padding: 0; }
html, body { width: 100%; height: 100%; overflow: hidden; background: #fff; }
img { display: block; width: 100vw; height: 100vh; object-fit: cover; }
</style>
</head>
<body>
<img src="/fact.png" width="800" height="480" alt="Moment Before">
</body>
</html>`;

  return htmlResponse(html, "public, max-age=86400");
}
