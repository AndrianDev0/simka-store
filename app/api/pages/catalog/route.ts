import { getPublicCategories } from "@/lib/categories";
import { getCatalogCountries, getCatalogProducts } from "@/lib/catalog-repository";
import { pagesCors } from "@/lib/pages-cors";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const [products, categories, countries] = await Promise.all([
      getCatalogProducts({ requireDatabase: true }),
      getPublicCategories({ strict: true }),
      getCatalogCountries(),
    ]);
    return pagesCors(Response.json({
      products: products.filter((product) => product.publicationStatus === "PUBLISHED"),
      categories,
      countries: countries.filter((country) => country.publicationStatus === "PUBLISHED"),
    }, { headers: { "Cache-Control": "public, max-age=60" } }), request);
  } catch (error) {
    console.error("pages_catalog_failed", { name: error instanceof Error ? error.name : "UnknownError" });
    return pagesCors(Response.json({ error: "Каталог временно недоступен" }, { status: 503 }), request);
  }
}
