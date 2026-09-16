import { and, asc, desc, eq, ilike, inArray, isNull, or, sql } from "drizzle-orm";
import { getDb } from "@/db";
import {
  catalogProducts,
  categories,
  countries,
  operators,
  productCategories,
  productImages,
  productVariants,
} from "@/db/schema";
import { catalogSearchPattern, normalizeCatalogSearchQuery } from "@/lib/catalog-search";
import {
  products as fallbackProducts,
  type Product,
  type ProductAvailabilityStatus,
  type ProductImage,
  type ProductVariant,
} from "@/lib/catalog";
import { slugify } from "@/lib/catalog";
import { productDisplayOffer, productIsAvailable } from "@/lib/catalog";

export type CatalogProduct = Product;

export type CatalogCountry = {
  id: number;
  name: string;
  slug: string;
  isoCode: string | null;
  flag: string;
  region: string;
  description: string;
  imageUrl: string | null;
  seoTitle: string | null;
  seoDescription: string | null;
  h1: string | null;
  seoText: string | null;
  canonicalUrl: string | null;
  faq: Array<{ question: string; answer: string }>;
  publicationStatus: "DRAFT" | "PUBLISHED" | "ARCHIVED";
  noindex: boolean;
  sortOrder: number;
  updatedAt: string;
};

export type CatalogQueryOptions = {
  /** Administrative reads can opt in to drafts and archived records. */
  includeUnpublished?: boolean;
  /** Public listings normally show unavailable products with their status. */
  availableOnly?: boolean;
  /** Transactional flows must fail closed instead of ordering fallback demo data. */
  requireDatabase?: boolean;
};

type ProductSelector = { id?: number; ids?: number[]; slug?: string };

let fallbackWarningEmitted = false;

function warnAboutFallback(error: unknown) {
  if (fallbackWarningEmitted) return;
  fallbackWarningEmitted = true;
  console.warn("catalog_database_unavailable_using_fallback", {
    name: error instanceof Error ? error.name : "UnknownError",
  });
}

function isVisible(product: Product, options: CatalogQueryOptions) {
  if (!options.includeUnpublished && product.publicationStatus !== "PUBLISHED") return false;
  if (options.availableOnly && !product.available) return false;
  return true;
}

function cloneFallbackProduct(product: Product): Product {
  return {
    ...product,
    categoryIds: [...product.categoryIds],
    characteristics: { ...product.characteristics },
    images: product.images.map((image) => ({ ...image })),
    variants: product.variants.map((variant) => ({
      ...variant,
      characteristics: { ...variant.characteristics },
    })),
  };
}

function fallback(options: CatalogQueryOptions, selector: ProductSelector = {}) {
  return fallbackProducts
    .filter((product) => selector.id === undefined || product.id === selector.id)
    .filter((product) => selector.ids === undefined || selector.ids.includes(product.id))
    .filter((product) => selector.slug === undefined || product.slug === selector.slug)
    .filter((product) => isVisible(product, options))
    .map(cloneFallbackProduct);
}

async function loadFromDatabase(options: CatalogQueryOptions, selector: ProductSelector = {}): Promise<Product[]> {
  if (selector.ids?.length === 0) return [];
  const db = getDb();
  const predicates = [
    isNull(catalogProducts.archivedAt),
    isNull(countries.archivedAt),
    isNull(operators.archivedAt),
  ];
  if (!options.includeUnpublished) {
    predicates.push(eq(catalogProducts.publicationStatus, "PUBLISHED"));
    predicates.push(eq(countries.publicationStatus, "PUBLISHED"));
    predicates.push(eq(operators.publicationStatus, "PUBLISHED"));
  }
  if (options.availableOnly) predicates.push(eq(catalogProducts.available, true));
  if (selector.id !== undefined) predicates.push(eq(catalogProducts.id, selector.id));
  if (selector.ids !== undefined) predicates.push(inArray(catalogProducts.id, selector.ids));
  if (selector.slug !== undefined) predicates.push(eq(catalogProducts.slug, selector.slug));

  const rows = await db.select({
    id: catalogProducts.id,
    sku: catalogProducts.sku,
    slug: catalogProducts.slug,
    countryId: catalogProducts.countryId,
    country: countries.name,
    flag: countries.flag,
    region: countries.region,
    operatorId: catalogProducts.operatorId,
    operator: operators.name,
    type: catalogProducts.simType,
    name: catalogProducts.name,
    data: catalogProducts.dataVolume,
    dataMb: catalogProducts.dataMb,
    isUnlimited: catalogProducts.isUnlimited,
    days: catalogProducts.validityDays,
    price: catalogProducts.price,
    oldPrice: catalogProducts.oldPrice,
    currency: catalogProducts.currency,
    calls: catalogProducts.callsDetails,
    hasCalls: catalogProducts.hasCalls,
    sms: catalogProducts.smsDetails,
    hasSms: catalogProducts.hasSms,
    shortDescription: catalogProducts.shortDescription,
    fullDescription: catalogProducts.fullDescription,
    characteristics: catalogProducts.characteristics,
    roamingTerms: catalogProducts.roamingTerms,
    activationTerms: catalogProducts.activationTerms,
    compatibility: catalogProducts.compatibility,
    instructions: catalogProducts.instructions,
    esimType: catalogProducts.esimType,
    esimDeliveryMethod: catalogProducts.esimDeliveryMethod,
    deliveryOptions: catalogProducts.deliveryOptions,
    popular: catalogProducts.popular,
    tone: catalogProducts.tone,
    available: catalogProducts.available,
    availabilityStatus: catalogProducts.availabilityStatus,
    stockQuantity: catalogProducts.stockQuantity,
    publicationStatus: catalogProducts.publicationStatus,
    seoTitle: catalogProducts.seoTitle,
    seoDescription: catalogProducts.seoDescription,
    h1: catalogProducts.h1,
    seoText: catalogProducts.seoText,
    canonicalUrl: catalogProducts.canonicalUrl,
    ogTitle: catalogProducts.ogTitle,
    ogDescription: catalogProducts.ogDescription,
    ogImage: catalogProducts.ogImage,
    updatedAt: catalogProducts.updatedAt,
  }).from(catalogProducts)
    .innerJoin(countries, eq(catalogProducts.countryId, countries.id))
    .innerJoin(operators, eq(catalogProducts.operatorId, operators.id))
    .where(and(...predicates))
    .orderBy(asc(catalogProducts.sortOrder), asc(catalogProducts.id));

  if (!rows.length) return [];

  const productIds = rows.map((row) => row.id);
  const [categoryLinks, imageRows, variantRows] = await Promise.all([
    db.select({ productId: productCategories.productId, categoryId: productCategories.categoryId })
      .from(productCategories)
      .where(inArray(productCategories.productId, productIds)),
    db.select({
      id: productImages.id,
      productId: productImages.productId,
      url: productImages.url,
      alt: productImages.alt,
      sortOrder: productImages.sortOrder,
      isPrimary: productImages.isPrimary,
    }).from(productImages)
      .where(inArray(productImages.productId, productIds))
      .orderBy(asc(productImages.sortOrder), asc(productImages.id)),
    db.select({
      id: productVariants.id,
      productId: productVariants.productId,
      name: productVariants.name,
      sku: productVariants.sku,
      slug: productVariants.slug,
      price: productVariants.price,
      currency: productVariants.currency,
      data: productVariants.dataVolume,
      days: productVariants.validityDays,
      characteristics: productVariants.characteristics,
      available: productVariants.available,
      availabilityStatus: productVariants.availabilityStatus,
      stockQuantity: productVariants.stockQuantity,
      sortOrder: productVariants.sortOrder,
    }).from(productVariants)
      .where(inArray(productVariants.productId, productIds))
      .orderBy(asc(productVariants.sortOrder), asc(productVariants.id)),
  ]);

  const categoriesByProduct = new Map<number, string[]>();
  for (const link of categoryLinks) {
    const list = categoriesByProduct.get(link.productId) ?? [];
    list.push(link.categoryId);
    categoriesByProduct.set(link.productId, list);
  }

  const imagesByProduct = new Map<number, ProductImage[]>();
  for (const image of imageRows) {
    const list = imagesByProduct.get(image.productId) ?? [];
    list.push(image);
    imagesByProduct.set(image.productId, list);
  }

  const variantsByProduct = new Map<number, ProductVariant[]>();
  for (const variant of variantRows) {
    const list = variantsByProduct.get(variant.productId) ?? [];
    list.push({
      ...variant,
      availabilityStatus: variant.availabilityStatus as ProductAvailabilityStatus,
      characteristics: variant.characteristics ?? {},
    });
    variantsByProduct.set(variant.productId, list);
  }

  return rows.map((row): Product => ({
    ...row,
    type: row.type as Product["type"],
    oldPrice: row.oldPrice ?? undefined,
    calls: row.calls ?? undefined,
    sms: row.sms ?? undefined,
    characteristics: row.characteristics ?? {},
    deliveryOptions: row.deliveryOptions ?? [],
    categoryIds: categoriesByProduct.get(row.id) ?? [],
    images: imagesByProduct.get(row.id) ?? [],
    variants: variantsByProduct.get(row.id) ?? [],
    popular: row.popular || undefined,
    availabilityStatus: row.availabilityStatus as ProductAvailabilityStatus,
    publicationStatus: row.publicationStatus as Product["publicationStatus"],
    published: row.publicationStatus === "PUBLISHED",
  }));
}

async function loadWithFallback(options: CatalogQueryOptions, selector: ProductSelector = {}) {
  try {
    return await loadFromDatabase(options, selector);
  } catch (error) {
    if (options.requireDatabase) throw error;
    warnAboutFallback(error);
    return fallback(options, selector);
  }
}

/** Returns published products by default, including unavailable items. */
export async function getCatalogProducts(options: CatalogQueryOptions = {}): Promise<CatalogProduct[]> {
  return loadWithFallback(options);
}

export type CatalogSearchResult = { items: CatalogProduct[]; total: number; limit: number; offset: number };

export async function searchCatalogProducts(rawQuery: string, page = 1, pageSize = 24): Promise<CatalogSearchResult> {
  const query = normalizeCatalogSearchQuery(rawQuery);
  const limit = Math.min(48, Math.max(1, Math.trunc(pageSize) || 24));
  const safePage = Math.min(10_000, Math.max(1, Math.trunc(page) || 1));
  const offset = (safePage - 1) * limit;
  if (!query) return { items: [], total: 0, limit, offset };

  try {
    const db = getDb();
    const pattern = catalogSearchPattern(query);
    const categoryAlias = query.toLocaleLowerCase("ru-RU");
    const predefinedCategory = categoryAlias === "europe" || categoryAlias === "европа" ? eq(countries.region, "Европа")
      : categoryAlias === "asia" || categoryAlias === "азия" ? eq(countries.region, "Азия")
      : categoryAlias === "america" || categoryAlias === "америка" ? eq(countries.region, "Америка")
      : categoryAlias === "esim" || categoryAlias === "e-sim" ? eq(catalogProducts.simType, "eSIM")
      : categoryAlias === "sim" || categoryAlias === "физические sim" ? eq(catalogProducts.simType, "SIM")
      : undefined;
    const match = or(
      ilike(catalogProducts.name, pattern),
      ilike(catalogProducts.sku, pattern),
      ilike(catalogProducts.slug, pattern),
      ilike(catalogProducts.shortDescription, pattern),
      ilike(countries.name, pattern),
      ilike(countries.slug, pattern),
      ilike(countries.region, pattern),
      ilike(operators.name, pattern),
      ilike(operators.slug, pattern),
      and(eq(categories.isPublished, true), isNull(categories.archivedAt), or(ilike(categories.name, pattern), ilike(categories.slug, pattern))),
      ilike(productVariants.name, pattern),
      ilike(productVariants.sku, pattern),
      ilike(productVariants.dataVolume, pattern),
      predefinedCategory,
    );
    const where = and(
      isNull(catalogProducts.archivedAt),
      isNull(countries.archivedAt),
      isNull(operators.archivedAt),
      eq(catalogProducts.publicationStatus, "PUBLISHED"),
      eq(countries.publicationStatus, "PUBLISHED"),
      eq(operators.publicationStatus, "PUBLISHED"),
      match,
    );
    const joined = () => db.selectDistinct({ id: catalogProducts.id, sortOrder: catalogProducts.sortOrder }).from(catalogProducts)
      .innerJoin(countries, eq(catalogProducts.countryId, countries.id))
      .innerJoin(operators, eq(catalogProducts.operatorId, operators.id))
      .leftJoin(productCategories, eq(productCategories.productId, catalogProducts.id))
      .leftJoin(categories, eq(productCategories.categoryId, categories.id))
      .leftJoin(productVariants, eq(productVariants.productId, catalogProducts.id));
    const [idRows, countRows] = await Promise.all([
      joined().where(where).orderBy(asc(catalogProducts.sortOrder), asc(catalogProducts.id)).limit(limit).offset(offset),
      db.select({ total: sql<number>`COUNT(DISTINCT ${catalogProducts.id})::int` }).from(catalogProducts)
        .innerJoin(countries, eq(catalogProducts.countryId, countries.id))
        .innerJoin(operators, eq(catalogProducts.operatorId, operators.id))
        .leftJoin(productCategories, eq(productCategories.productId, catalogProducts.id))
        .leftJoin(categories, eq(productCategories.categoryId, categories.id))
        .leftJoin(productVariants, eq(productVariants.productId, catalogProducts.id))
        .where(where),
    ]);
    const items = await loadFromDatabase({}, { ids: idRows.map((row) => row.id) });
    return { items, total: Number(countRows[0]?.total || 0), limit, offset };
  } catch (error) {
    warnAboutFallback(error);
    const normalized = query.toLocaleLowerCase("ru-RU");
    const matches = fallback({}, {}).filter((product) => {
      const variants = product.variants.map((variant) => `${variant.name} ${variant.sku} ${variant.data || ""}`).join(" ");
      return `${product.name} ${product.country} ${product.operator} ${product.sku} ${product.slug} ${product.shortDescription} ${variants}`.toLocaleLowerCase("ru-RU").includes(normalized);
    });
    return { items: matches.slice(offset, offset + limit), total: matches.length, limit, offset };
  }
}

export type CatalogFilters = {
  q?: string;
  country?: string;
  operator?: string;
  category?: string;
  type?: "eSIM" | "SIM";
  currency?: string;
  availability?: "available" | "unavailable";
  data?: "small" | "medium" | "large" | "unlimited";
  days?: number;
  minPrice?: number;
  maxPrice?: number;
  sort?: "popular" | "price-asc" | "price-desc" | "days";
};

export type CatalogFacets = { countries: string[]; operators: string[]; currencies: string[] };

const availableVariantSql = (productId: typeof catalogProducts.id) => sql`EXISTS (
  SELECT 1 FROM product_variants AS v WHERE v.product_id = ${productId}
    AND v.available = TRUE AND v.availability_status <> 'OUT_OF_STOCK'
    AND (v.stock_quantity IS NULL OR v.stock_quantity > 0)
)`;

const displayVariantSql = (field: "price" | "currency") => sql`(
  SELECT ${field === "price" ? sql.raw("v.price") : sql.raw("v.currency")}
  FROM product_variants AS v WHERE v.product_id = ${catalogProducts.id}
    AND v.available = TRUE AND v.availability_status <> 'OUT_OF_STOCK'
    AND (v.stock_quantity IS NULL OR v.stock_quantity > 0)
  ORDER BY CASE WHEN v.sku = ${catalogProducts.sku} THEN 0 ELSE 1 END, v.sort_order, v.id
  LIMIT 1
)`;

const displayPriceSql = sql<number>`COALESCE(${displayVariantSql("price")}, ${catalogProducts.price})`;
const displayCurrencySql = sql<string>`COALESCE(${displayVariantSql("currency")}, ${catalogProducts.currency})`;

function visibleCatalogPredicate() {
  return and(
    isNull(catalogProducts.archivedAt),
    isNull(countries.archivedAt),
    isNull(operators.archivedAt),
    eq(catalogProducts.publicationStatus, "PUBLISHED"),
    eq(countries.publicationStatus, "PUBLISHED"),
    eq(operators.publicationStatus, "PUBLISHED"),
  );
}

function catalogFilterPredicate(filters: CatalogFilters) {
  const predicates = [visibleCatalogPredicate()];
  const query = normalizeCatalogSearchQuery(filters.q || "");
  if (query) {
    const pattern = catalogSearchPattern(query);
    predicates.push(or(
      ilike(catalogProducts.name, pattern), ilike(catalogProducts.sku, pattern),
      ilike(catalogProducts.shortDescription, pattern), ilike(catalogProducts.dataVolume, pattern), ilike(countries.name, pattern),
      ilike(operators.name, pattern),
      sql`EXISTS (SELECT 1 FROM product_variants AS v WHERE v.product_id = ${catalogProducts.id} AND (v.name ILIKE ${pattern} OR v.sku ILIKE ${pattern} OR v.data_volume ILIKE ${pattern}))`,
      sql`EXISTS (SELECT 1 FROM product_categories AS pc INNER JOIN categories AS c ON c.id = pc.category_id WHERE pc.product_id = ${catalogProducts.id} AND c.is_published = TRUE AND c.archived_at IS NULL AND (c.name ILIKE ${pattern} OR c.slug ILIKE ${pattern}))`,
    ));
  }
  if (filters.country) predicates.push(eq(countries.name, filters.country));
  if (filters.operator) predicates.push(eq(operators.name, filters.operator));
  if (filters.type) predicates.push(eq(catalogProducts.simType, filters.type));
  if (filters.currency) predicates.push(sql`${displayCurrencySql} = ${filters.currency}`);
  const availabilitySql = sql`${catalogProducts.available} = TRUE AND ${catalogProducts.availabilityStatus} <> 'OUT_OF_STOCK' AND (${catalogProducts.stockQuantity} IS NULL OR ${catalogProducts.stockQuantity} > 0) AND (NOT EXISTS (SELECT 1 FROM product_variants AS v WHERE v.product_id = ${catalogProducts.id}) OR ${availableVariantSql(catalogProducts.id)})`;
  if (filters.availability === "available") predicates.push(availabilitySql);
  if (filters.availability === "unavailable") predicates.push(sql`NOT (${availabilitySql})`);
  if (filters.data === "unlimited") predicates.push(eq(catalogProducts.isUnlimited, true));
  if (filters.data === "small") predicates.push(sql`${catalogProducts.isUnlimited} = FALSE AND COALESCE(${catalogProducts.dataMb}, 0) <= ${5 * 1024}`);
  if (filters.data === "medium") predicates.push(sql`${catalogProducts.isUnlimited} = FALSE AND COALESCE(${catalogProducts.dataMb}, 0) > ${5 * 1024} AND COALESCE(${catalogProducts.dataMb}, 0) <= ${20 * 1024}`);
  if (filters.data === "large") predicates.push(sql`${catalogProducts.isUnlimited} = FALSE AND COALESCE(${catalogProducts.dataMb}, 0) > ${20 * 1024}`);
  if (filters.days && filters.days > 0) predicates.push(sql`${catalogProducts.validityDays} <= ${filters.days}`);
  if (filters.minPrice !== undefined) predicates.push(sql`${displayPriceSql} >= ${filters.minPrice}`);
  if (filters.maxPrice !== undefined) predicates.push(sql`${displayPriceSql} <= ${filters.maxPrice}`);
  if (filters.category === "esim") predicates.push(eq(catalogProducts.simType, "eSIM"));
  else if (filters.category === "sim") predicates.push(eq(catalogProducts.simType, "SIM"));
  else if (filters.category === "europe") predicates.push(eq(countries.region, "Европа"));
  else if (filters.category === "asia") predicates.push(eq(countries.region, "Азия"));
  else if (filters.category === "america") predicates.push(eq(countries.region, "Америка"));
  else if (filters.category) predicates.push(sql`EXISTS (SELECT 1 FROM product_categories AS pc INNER JOIN categories AS c ON c.id = pc.category_id WHERE pc.product_id = ${catalogProducts.id} AND c.slug = ${filters.category} AND c.is_published = TRUE AND c.archived_at IS NULL)`);
  return and(...predicates);
}

function filterFallbackCatalogProducts(filters: CatalogFilters) {
  const query = normalizeCatalogSearchQuery(filters.q || "").toLocaleLowerCase("ru-RU");
  return fallback({}, {}).filter((product) => {
    const offer = productDisplayOffer(product);
    const text = `${product.name} ${product.country} ${product.operator} ${product.sku} ${product.shortDescription} ${product.data} ${product.variants.map((variant) => `${variant.name} ${variant.sku} ${variant.data || ""}`).join(" ")}`.toLocaleLowerCase("ru-RU");
    const category = filters.category;
    const region = category === "europe" ? "Европа" : category === "asia" ? "Азия" : category === "america" ? "Америка" : null;
    const dataMb = product.dataMb ?? 0;
    return (!query || text.includes(query))
      && (!filters.country || product.country === filters.country)
      && (!filters.operator || product.operator === filters.operator)
      && (!filters.type || product.type === filters.type)
      && (!filters.currency || offer.currency === filters.currency)
      && (!filters.availability || (filters.availability === "available") === productIsAvailable(product))
      && (!filters.data || (filters.data === "unlimited" ? product.isUnlimited : !product.isUnlimited && (filters.data === "small" ? dataMb <= 5 * 1024 : filters.data === "medium" ? dataMb > 5 * 1024 && dataMb <= 20 * 1024 : dataMb > 20 * 1024)))
      && (!filters.days || product.days <= filters.days)
      && (filters.minPrice === undefined || offer.price >= filters.minPrice)
      && (filters.maxPrice === undefined || offer.price <= filters.maxPrice)
      && (!category || (category === "esim" ? product.type === "eSIM" : category === "sim" ? product.type === "SIM" : region ? product.region === region : false));
  }).sort((left, right) => {
    if (filters.sort === "days") return left.days - right.days || left.id - right.id;
    if (filters.sort === "price-asc" || filters.sort === "price-desc") {
      const leftOffer = productDisplayOffer(left); const rightOffer = productDisplayOffer(right);
      return leftOffer.currency.localeCompare(rightOffer.currency) || (filters.sort === "price-asc" ? leftOffer.price - rightOffer.price : rightOffer.price - leftOffer.price) || left.id - right.id;
    }
    return Number(right.popular) - Number(left.popular) || left.id - right.id;
  });
}

export async function queryCatalogProducts(filters: CatalogFilters, page = 1, pageSize = 24): Promise<CatalogSearchResult> {
  const limit = Math.min(48, Math.max(1, Math.trunc(pageSize) || 24));
  const safePage = Math.min(10_000, Math.max(1, Math.trunc(page) || 1));
  const offset = (safePage - 1) * limit;
  try {
    const db = getDb();
    const where = catalogFilterPredicate(filters);
    const base = () => db.select({ id: catalogProducts.id }).from(catalogProducts)
      .innerJoin(countries, eq(catalogProducts.countryId, countries.id))
      .innerJoin(operators, eq(catalogProducts.operatorId, operators.id));
    const [{ total }] = await db.select({ total: sql<number>`COUNT(*)::int` }).from(catalogProducts)
      .innerJoin(countries, eq(catalogProducts.countryId, countries.id))
      .innerJoin(operators, eq(catalogProducts.operatorId, operators.id)).where(where);
    const order = filters.sort === "days" ? [asc(catalogProducts.validityDays), asc(catalogProducts.sortOrder), asc(catalogProducts.id)]
      : filters.sort === "price-asc" ? [asc(displayCurrencySql), asc(displayPriceSql), asc(catalogProducts.id)]
      : filters.sort === "price-desc" ? [asc(displayCurrencySql), desc(displayPriceSql), asc(catalogProducts.id)]
      : [desc(catalogProducts.popular), asc(catalogProducts.sortOrder), asc(catalogProducts.id)];
    const idRows = await base().where(where).orderBy(...order).limit(limit).offset(offset);
    const loaded = await loadFromDatabase({}, { ids: idRows.map((row) => row.id) });
    const byId = new Map(loaded.map((product) => [product.id, product]));
    return { items: idRows.flatMap((row) => byId.get(row.id) ? [byId.get(row.id)!] : []), total: Number(total || 0), limit, offset };
  } catch (error) {
    warnAboutFallback(error);
    const matches = filterFallbackCatalogProducts(filters);
    return { items: matches.slice(offset, offset + limit), total: matches.length, limit, offset };
  }
}

export async function getCatalogFacets(): Promise<CatalogFacets> {
  try {
    const db = getDb();
    const rows = await db.selectDistinct({ country: countries.name, operator: operators.name, currency: displayCurrencySql })
      .from(catalogProducts)
      .innerJoin(countries, eq(catalogProducts.countryId, countries.id))
      .innerJoin(operators, eq(catalogProducts.operatorId, operators.id))
      .where(visibleCatalogPredicate());
    return {
      countries: [...new Set(rows.map((row) => row.country))].sort((a, b) => a.localeCompare(b, "ru")),
      operators: [...new Set(rows.map((row) => row.operator))].sort((a, b) => a.localeCompare(b, "ru")),
      currencies: [...new Set(rows.map((row) => row.currency))].sort(),
    };
  } catch (error) {
    warnAboutFallback(error);
    const products = fallback({}, {});
    return {
      countries: [...new Set(products.map((product) => product.country))].sort((a, b) => a.localeCompare(b, "ru")),
      operators: [...new Set(products.map((product) => product.operator))].sort((a, b) => a.localeCompare(b, "ru")),
      currencies: [...new Set(products.map((product) => productDisplayOffer(product).currency))].sort(),
    };
  }
}

export async function getCatalogProductById(
  id: number,
  options: CatalogQueryOptions = {},
): Promise<CatalogProduct | undefined> {
  if (!Number.isInteger(id) || id <= 0) return undefined;
  return (await loadWithFallback(options, { id }))[0];
}

export async function getCatalogProductBySlug(
  slug: string,
  options: CatalogQueryOptions = {},
): Promise<CatalogProduct | undefined> {
  const normalizedSlug = slug.trim().toLowerCase();
  if (!normalizedSlug) return undefined;
  return (await loadWithFallback(options, { slug: normalizedSlug }))[0];
}

const fallbackCountrySlugs: Record<number, string> = {
  1: "turkey",
  2: "thailand",
  3: "uae",
  4: "germany",
  5: "usa",
  6: "japan",
};

function fallbackCountries(): CatalogCountry[] {
  const unique = new Map<number, CatalogCountry>();
  for (const product of fallbackProducts) {
    if (unique.has(product.countryId)) continue;
    unique.set(product.countryId, {
      id: product.countryId,
      name: product.country,
      slug: fallbackCountrySlugs[product.countryId] || slugify(product.country),
      isoCode: null,
      flag: product.flag,
      region: product.region,
      description: `SIM и eSIM для путешествий: ${product.country}.`,
      imageUrl: null,
      seoTitle: `${product.country}: eSIM и SIM для путешествий`,
      seoDescription: `Сравните SIM и eSIM по направлению «${product.country}»: операторы, интернет, срок действия и цены.`,
      h1: `SIM и eSIM: ${product.country}`,
      seoText: null,
      canonicalUrl: null,
      faq: [],
      publicationStatus: "PUBLISHED",
      noindex: false,
      sortOrder: product.countryId * 10,
      updatedAt: new Date(0).toISOString(),
    });
  }
  return [...unique.values()].sort((left, right) => left.sortOrder - right.sortOrder || left.name.localeCompare(right.name, "ru"));
}

async function loadCountriesFromDatabase(): Promise<CatalogCountry[]> {
  const db = getDb();
  const rows = await db.select({
    id: countries.id,
    name: countries.name,
    slug: countries.slug,
    isoCode: countries.isoCode,
    flag: countries.flag,
    region: countries.region,
    description: countries.description,
    imageUrl: countries.imageUrl,
    seoTitle: countries.seoTitle,
    seoDescription: countries.seoDescription,
    h1: countries.h1,
    seoText: countries.seoText,
    canonicalUrl: countries.canonicalUrl,
    faq: countries.faq,
    publicationStatus: countries.publicationStatus,
    noindex: countries.noindex,
    sortOrder: countries.sortOrder,
    updatedAt: countries.updatedAt,
  }).from(countries)
    .where(and(eq(countries.publicationStatus, "PUBLISHED"), isNull(countries.archivedAt)))
    .orderBy(asc(countries.sortOrder), asc(countries.name));

  return rows.map((country) => ({
    ...country,
    faq: Array.isArray(country.faq)
      ? country.faq.filter((item): item is { question: string; answer: string } => Boolean(item && typeof item.question === "string" && typeof item.answer === "string"))
      : [],
    publicationStatus: country.publicationStatus as CatalogCountry["publicationStatus"],
  }));
}

export async function getCatalogCountries(): Promise<CatalogCountry[]> {
  try {
    return await loadCountriesFromDatabase();
  } catch (error) {
    warnAboutFallback(error);
    return fallbackCountries();
  }
}

export async function getCatalogCountryBySlug(slug: string): Promise<CatalogCountry | undefined> {
  const normalized = slug.trim().toLowerCase();
  if (!normalized) return undefined;
  return (await getCatalogCountries()).find((country) => country.slug.toLowerCase() === normalized);
}
