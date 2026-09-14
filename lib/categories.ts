import { asc, eq, isNull, and } from "drizzle-orm";
import { getDb } from "@/db";
import { categories, productCategories } from "@/db/schema";

export type PublicCategory = {
  id: string;
  slug: string;
  name: string;
  description: string;
  imageUrl: string | null;
  seoTitle: string | null;
  seoDescription: string | null;
  h1: string | null;
  seoText: string | null;
  canonicalUrl: string | null;
  ogTitle: string | null;
  ogDescription: string | null;
  ogImage: string | null;
  noindex: boolean;
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
      imageUrl: categories.imageUrl,
      seoTitle: categories.seoTitle,
      seoDescription: categories.seoDescription,
      h1: categories.h1,
      seoText: categories.seoText,
      canonicalUrl: categories.canonicalUrl,
      ogTitle: categories.ogTitle,
      ogDescription: categories.ogDescription,
      ogImage: categories.ogImage,
      noindex: categories.noindex,
    }).from(categories)
      .where(and(eq(categories.isPublished, true), isNull(categories.archivedAt)))
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
