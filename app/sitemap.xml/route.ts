import { getPublicCategories } from "@/lib/categories";
import { getCatalogCountries, getCatalogProducts } from "@/lib/catalog-repository";
import { absoluteUrl } from "@/lib/seo";

function xmlEscape(value: string) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&apos;");
}

function lastModified(value: string | undefined) {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function newest(values: Array<string | undefined>) {
  const valid = values.map(lastModified).filter((value): value is string => Boolean(value));
  return valid.sort().at(-1);
}

function hasSelfCanonical(canonical: string | null | undefined, path: string) {
  return !canonical || absoluteUrl(canonical) === absoluteUrl(path);
}

export async function GET() {
  const [products, countries, categories] = await Promise.all([getCatalogProducts(), getCatalogCountries(), getPublicCategories()]);
  const staticPaths = ["/", "/catalog", "/categories", "/countries", "/faq", "/payment", "/delivery", "/contacts", "/about", "/privacy", "/terms", "/returns", "/cookies"];
  const builtInCategories = [
    { slug: "esim", hasItems: products.some((product) => product.type === "eSIM") },
    { slug: "sim", hasItems: products.some((product) => product.type === "SIM") },
    { slug: "europe", hasItems: products.some((product) => product.region === "Европа") },
    { slug: "asia", hasItems: products.some((product) => product.region === "Азия") },
    { slug: "america", hasItems: products.some((product) => product.region === "Америка") },
  ];
  const entries = new Map<string, string | undefined>(staticPaths.map((path) => [path, undefined]));
  const catalogUpdated = newest(products.map((product) => product.updatedAt));
  entries.set("/", catalogUpdated);
  entries.set("/catalog", catalogUpdated);
  entries.set("/countries", newest([...countries.map((country) => country.updatedAt), ...products.map((product) => product.updatedAt)]));
  entries.set("/categories", newest([...categories.map((category) => category.updatedAt), ...products.map((product) => product.updatedAt)]));
  for (const product of products) {
    const path = `/product/${encodeURIComponent(product.slug)}`;
    if (hasSelfCanonical(product.canonicalUrl, path)) entries.set(path, lastModified(product.updatedAt));
  }
  for (const country of countries.filter((item) => !item.noindex && products.some((product) => product.countryId === item.id))) {
    const path = `/country/${encodeURIComponent(country.slug)}`;
    if (hasSelfCanonical(country.canonicalUrl, path)) entries.set(path, newest([country.updatedAt, ...products.filter((product) => product.countryId === country.id).map((product) => product.updatedAt)]));
  }
  for (const category of builtInCategories.filter((item) => item.hasItems)) {
    const related = products.filter((product) => category.slug === "esim" ? product.type === "eSIM" : category.slug === "sim" ? product.type === "SIM" : product.region.toLowerCase() === ({ europe: "европа", asia: "азия", america: "америка" } as Record<string, string>)[category.slug]);
    entries.set(`/category/${category.slug}`, newest(related.map((product) => product.updatedAt)));
  }
  for (const category of categories.filter((item) => !item.noindex && products.some((product) => product.categoryIds.includes(item.id)))) {
    const path = `/category/${encodeURIComponent(category.slug)}`;
    if (hasSelfCanonical(category.canonicalUrl, path)) entries.set(path, newest([category.updatedAt, ...products.filter((product) => product.categoryIds.includes(category.id)).map((product) => product.updatedAt)]));
  }
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${[...entries].map(([path, modified]) => `  <url><loc>${xmlEscape(absoluteUrl(path))}</loc>${modified ? `<lastmod>${modified}</lastmod>` : ""}</url>`).join("\n")}\n</urlset>\n`;
  return new Response(xml, { headers: { "Content-Type": "application/xml; charset=utf-8", "Cache-Control": "public, max-age=3600, s-maxage=3600" } });
}
