import { asc, eq, inArray, isNull, and } from "drizzle-orm";
import { getDb } from "@/db";
import { catalogProducts, categories, countries, operators, productCategories } from "@/db/schema";

export type PublicCategory = {
  id: string;
  parentId: string | null;
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
  updatedAt: string;
  productIds: number[];
};

/** Lightweight options for filters; avoids loading every product/category link. */
export async function getPublicCategoryOptions(): Promise<Array<Pick<PublicCategory, "id" | "slug" | "name">>> {
  try {
    return await getDb().select({ id: categories.id, slug: categories.slug, name: categories.name })
      .from(categories)
      .where(and(eq(categories.isPublished, true), isNull(categories.archivedAt)))
      .orderBy(asc(categories.sortOrder), asc(categories.name));
  } catch (error) {
    console.warn("public_category_options_unavailable", error instanceof Error ? error.name : "UnknownError");
    return [];
  }
}

/**
 * Reads categories created by an administrator. A missing database is treated
 * as an empty result so the static storefront remains usable in previews.
 */
export async function getPublicCategories(): Promise<PublicCategory[]> {
  try {
    const db = getDb();
    const rows = await db.select({
      id: categories.id,
      parentId: categories.parentId,
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
      updatedAt: categories.updatedAt,
    }).from(categories)
      .where(and(eq(categories.isPublished, true), isNull(categories.archivedAt)))
      .orderBy(asc(categories.sortOrder), asc(categories.name));

    if (!rows.length) return [];
    const links = await db.select({ productId: productCategories.productId, categoryId: productCategories.categoryId })
      .from(productCategories)
      .innerJoin(catalogProducts, eq(productCategories.productId, catalogProducts.id))
      .innerJoin(countries, eq(catalogProducts.countryId, countries.id))
      .innerJoin(operators, eq(catalogProducts.operatorId, operators.id))
      .where(and(
        inArray(productCategories.categoryId, rows.map((category) => category.id)),
        eq(catalogProducts.publicationStatus, "PUBLISHED"),
        isNull(catalogProducts.archivedAt),
        eq(countries.publicationStatus, "PUBLISHED"),
        isNull(countries.archivedAt),
        eq(operators.publicationStatus, "PUBLISHED"),
        isNull(operators.archivedAt),
      ));
    return rows.map((category) => ({
      ...category,
      productIds: links.filter((link) => link.categoryId === category.id).map((link) => link.productId),
    }));
  } catch (error) {
    console.warn("public_categories_unavailable", error instanceof Error ? error.message : "unknown error");
    return [];
  }
}
