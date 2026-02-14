export function handleFactPage(): Response {
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=800">
<title>Moment Before</title>
<style>
* { margin: 0; padding: 0; }
body { width: 800px; height: 480px; overflow: hidden; background: #fff; }
img { display: block; }
</style>
</head>
<body>
<img src="/fact.png" width="800" height="480" alt="Moment Before">
</body>
</html>`;

  return new Response(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "public, max-age=86400",
    },
  });
}
