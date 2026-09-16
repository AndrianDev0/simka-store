import { getPublicCategories } from "@/lib/categories";
import { recordOperationalEvent } from "@/lib/operational-events";

/** Public catalogue endpoint: only published, non-archived categories are exposed. */
export async function GET() {
  try {
    const result = await getPublicCategories();
    return Response.json({ categories: result }, { headers: { "Cache-Control": "public, max-age=60, s-maxage=300" } });
  } catch (error) {
    console.error("category_list_failed", { name: error instanceof Error ? error.name : "UnknownError" });
    await recordOperationalEvent({ kind: "api_error", severity: "error", area: "catalog", path: "/api/categories", code: "category_list_failed" });
    return Response.json({ error: "Категории временно недоступны" }, { status: 503 });
  }
}
