import { SITE_ORIGIN } from "@/lib/seo";

export function GET() {
  return new Response([
    "User-agent: *",
    "Allow: /",
    "Disallow: /api/",
    `Host: ${new URL(SITE_ORIGIN).host}`,
    `Sitemap: ${SITE_ORIGIN}/sitemap.xml`,
    "",
  ].join("\n"), { headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=3600" } });
}
