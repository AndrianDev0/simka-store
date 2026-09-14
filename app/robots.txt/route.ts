export function GET() {
  return new Response([
    "User-agent: *",
    "Allow: /",
    "Disallow: /api/",
    "Disallow: /search",
    "Sitemap: https://simka-store.onrender.com/sitemap.xml",
    "",
  ].join("\n"), { headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=3600" } });
}
