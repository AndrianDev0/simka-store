import { getPublicCategories } from "@/lib/categories";

/** Public catalogue endpoint: only published, non-archived categories are exposed. */
export async function GET() {
  try {
    const result = await getPublicCategories();
    return Response.json({ categories: result }, { headers: { "Cache-Control": "public, max-age=60, s-maxage=300" } });
  } catch (error) {
    console.error("category_list_failed", { name: error instanceof Error ? error.name : "UnknownError" });
    return Response.json({ error: "Категории временно недоступны" }, { status: 503 });
  }
}
