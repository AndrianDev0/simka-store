import { asc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { categories, productCategories } from "@/db/schema";
import { getProductById } from "@/lib/catalog";

/** Public catalogue endpoint: only published, non-archived categories are exposed. */
export async function GET() {
  try {
    const db = getDb();
    const rows = await db.select().from(categories)
      .where(eq(categories.isPublished, true))
      .orderBy(asc(categories.sortOrder), asc(categories.name));
    const links = rows.length ? await db.select().from(productCategories) : [];
    const result = rows.filter((category) => category.archivedAt === null).map((category) => ({
      id: category.id,
      slug: category.slug,
      name: category.name,
      description: category.description,
      imageUrl: category.imageUrl,
      h1: category.h1,
      seoTitle: category.seoTitle,
      seoDescription: category.seoDescription,
      noindex: category.noindex,
      productIds: links.filter((link) => link.categoryId === category.id).map((link) => link.productId).filter((id) => Boolean(getProductById(id))),
    }));
    return Response.json({ categories: result }, { headers: { "Cache-Control": "public, max-age=60, s-maxage=300" } });
  } catch (error) {
    console.error("category_list_failed", { name: error instanceof Error ? error.name : "UnknownError" });
    return Response.json({ error: "Категории временно недоступны" }, { status: 503 });
  }
}
