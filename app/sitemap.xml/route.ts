import { products, slugify } from "@/lib/catalog";
import { getPublicCategories } from "@/lib/categories";

const origin = "https://simka-store.onrender.com";

export async function GET() {
  const staticPaths = ["", "/catalog", "/categories", "/countries", "/faq", "/payment", "/delivery", "/contacts", "/about", "/privacy", "/terms", "/returns", "/cookies"];
  const countries = [...new Set(products.map((product) => slugify(product.country)))];
  const categories = (await getPublicCategories()).filter((category) => !category.noindex);
  const urls = [
    ...staticPaths.map((path) => `${origin}${path}`),
    ...products.map((product) => `${origin}/product/${product.slug}`),
    ...countries.map((slug) => `${origin}/country/${encodeURIComponent(slug)}`),
    ...categories.map((category) => `${origin}/category/${encodeURIComponent(category.slug)}`),
  ];
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((url) => `  <url><loc>${url.replaceAll("&", "&amp;")}</loc></url>`).join("\n")}\n</urlset>\n`;
  return new Response(xml, { headers: { "Content-Type": "application/xml; charset=utf-8", "Cache-Control": "public, max-age=3600, s-maxage=3600" } });
}
