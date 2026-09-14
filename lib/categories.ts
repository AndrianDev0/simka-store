import { asc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { categories, productCategories } from "@/db/schema";

export type PublicCategory = {
  id: string;
  slug: string;
  name: string;
  description: string;
  productIds: number[];
};

/**
 * Reads categories created by an administrator. A missing database is treated
 * as an empty result so the static storefront remains usable in previews.
 */
export async function getPublicCategories(): Promise<PublicCategory[]> {
  try {
    const db = getDb();
    const rows = await db.select({
      id: categories.id,
      slug: categories.slug,
      name: categories.name,
      description: categories.description,
    }).from(categories)
      .where(eq(categories.isPublished, true))
      .orderBy(asc(categories.sortOrder), asc(categories.name));

    if (!rows.length) return [];
    const links = await db.select({ productId: productCategories.productId, categoryId: productCategories.categoryId })
      .from(productCategories);
    return rows.map((category) => ({
      ...category,
      productIds: links.filter((link) => link.categoryId === category.id).map((link) => link.productId),
    }));
  } catch (error) {
    console.warn("public_categories_unavailable", error instanceof Error ? error.message : "unknown error");
    return [];
  }
}
