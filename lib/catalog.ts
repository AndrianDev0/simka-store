import { absoluteUrl } from "@/lib/seo";

export type SimType = "eSIM" | "SIM";
export type ProductPublicationStatus = "DRAFT" | "PUBLISHED" | "ARCHIVED";
export type ProductAvailabilityStatus = "IN_STOCK" | "OUT_OF_STOCK" | "PREORDER";
export type ProductCharacteristicValue = string | number | boolean | null;
export type ProductCharacteristics = Record<string, ProductCharacteristicValue>;

export type ProductDeliveryOption = {
  id: string;
  label: string;
  cost: number | null;
  currency: string;
  regions: string[];
  dispatchDaysMin: number | null;
  dispatchDaysMax: number | null;
};

export type ProductImage = {
  id: number;
  productId: number;
  url: string;
  alt: string;
  sortOrder: number;
  isPrimary: boolean;
};

export type ProductVariant = {
  id: number;
  productId: number;
  name: string;
  sku: string;
  slug: string;
  price: number;
  currency: string;
  data: string | null;
  days: number | null;
  characteristics: ProductCharacteristics;
  available: boolean;
  availabilityStatus: ProductAvailabilityStatus;
  stockQuantity: number | null;
  sortOrder: number;
};

/**
 * Public catalogue shape.
 *
 * The original fields stay required so existing storefront and order code can
 * continue to consume the in-memory fallback while the database-backed
 * repository is rolled out page by page.
 */
export type Product = {
  id: number;
  sku: string;
  slug: string;
  countryId: number;
  country: string;
  flag: string;
  region: string;
  operatorId: number;
  operator: string;
  type: SimType;
  name: string;
  data: string;
  dataMb: number | null;
  isUnlimited: boolean;
  days: number;
  price: number;
  oldPrice?: number;
  currency: string;
  calls?: string;
  hasCalls: boolean;
  sms?: string;
  hasSms: boolean;
  shortDescription: string;
  fullDescription: string;
  characteristics: ProductCharacteristics;
  roamingTerms: string;
  activationTerms: string;
  compatibility: string;
  instructions: string;
  esimType: string | null;
  esimDeliveryMethod: string | null;
  deliveryOptions: ProductDeliveryOption[];
  categoryIds: string[];
  images: ProductImage[];
  variants: ProductVariant[];
  popular?: boolean;
  tone: string;
  available: boolean;
  availabilityStatus: ProductAvailabilityStatus;
  stockQuantity: number | null;
  publicationStatus: ProductPublicationStatus;
  /** Convenience alias for consumers that only need a boolean. */
  published: boolean;
  seoTitle: string | null;
  seoDescription: string | null;
  h1: string | null;
  seoText: string | null;
  canonicalUrl: string | null;
  ogTitle: string | null;
  ogDescription: string | null;
  ogImage: string | null;
  updatedAt: string;
};

export function variantIsAvailable(variant: ProductVariant) {
  return variant.available && variant.availabilityStatus !== "OUT_OF_STOCK" && variant.stockQuantity !== 0;
}

export function productIsAvailable(product: Product) {
  return product.available
    && product.availabilityStatus !== "OUT_OF_STOCK"
    && product.stockQuantity !== 0
    && (product.variants.length === 0 || product.variants.some(variantIsAvailable));
}

export function productDisplayOffer(product: Product) {
  const variant = product.variants.find((item) => item.sku === product.sku && variantIsAvailable(item))
    ?? product.variants.find(variantIsAvailable)
    ?? null;
  return {
    variant,
    price: variant?.price ?? product.price,
    currency: variant?.currency ?? product.currency,
  };
}

type LegacyProductSeed = Pick<Product,
  "id" | "sku" | "slug" | "countryId" | "country" | "flag" | "region" |
  "operatorId" | "operator" | "type" | "data" | "dataMb" | "isUnlimited" |
  "days" | "price" | "tone"
> & Pick<Partial<Product>, "oldPrice" | "calls" | "popular">;

function createFallbackProduct(seed: LegacyProductSeed): Product {
  const name = `${seed.type} ${seed.operator}: ${seed.data} на ${seed.days} дней — ${seed.country}`;
  const shortDescription = `${seed.type} оператора ${seed.operator} для путешествий по направлению «${seed.country}».`;
  const seoTitle = `${seed.country} — ${seed.type} ${seed.operator}: ${seed.data} на ${seed.days} дней — SIMKA`;
  const seoDescription = `${seed.type} оператора ${seed.operator}, направление «${seed.country}»: ${seed.data} на ${seed.days} дней. Сравните активацию, совместимость, цену и наличие.`;
  const hasCalls = Boolean(seed.calls);

  return {
    ...seed,
    name,
    currency: "RUB",
    hasCalls,
    hasSms: false,
    shortDescription,
    fullDescription: `${shortDescription} Точные условия использования подтверждаются перед оплатой.`,
    characteristics: {
      region: seed.region,
      operator: seed.operator,
      data: seed.data,
      validityDays: seed.days,
    },
    roamingTerms: "Условия использования за пределами указанной страны уточняются перед оплатой.",
    activationTerms: "Активация выполняется по инструкции после получения SIM или eSIM.",
    compatibility: seed.type === "eSIM"
      ? "Требуется разблокированное устройство с поддержкой eSIM."
      : "Требуется разблокированное устройство с подходящим SIM-слотом.",
    instructions: "Инструкция предоставляется после подтверждения оплаты.",
    esimType: seed.type === "eSIM" ? "consumer" : null,
    esimDeliveryMethod: seed.type === "eSIM" ? "email" : null,
    deliveryOptions: seed.type === "SIM" ? [{
      id: "manager-delivery",
      label: "Доставка по согласованию с менеджером",
      cost: null,
      currency: "RUB",
      regions: ["Регион уточняется при оформлении"],
      dispatchDaysMin: null,
      dispatchDaysMax: null,
    }] : [],
    categoryIds: [],
    images: [],
    variants: [{
      id: seed.id,
      productId: seed.id,
      name: "Основной вариант",
      sku: seed.sku,
      slug: `${seed.slug}-default`,
      price: seed.price,
      currency: "RUB",
      data: seed.data,
      days: seed.days,
      characteristics: {},
      available: true,
      availabilityStatus: "IN_STOCK",
      stockQuantity: null,
      sortOrder: 0,
    }],
    available: true,
    availabilityStatus: "IN_STOCK",
    stockQuantity: null,
    publicationStatus: "PUBLISHED",
    published: true,
    seoTitle,
    seoDescription,
    h1: name,
    seoText: null,
    canonicalUrl: absoluteUrl(`/product/${seed.slug}`),
    ogTitle: seoTitle,
    ogDescription: seoDescription,
    ogImage: null,
    updatedAt: "2026-09-15T00:00:00.000Z",
  };
}

/** Stable emergency fallback and seed source for the first six live products. */
export const products: Product[] = [
  createFallbackProduct({ id: 1, sku: "TR-ESIM-20-30", slug: "turkey-turkcell-20gb", countryId: 1, country: "Турция", flag: "🇹🇷", region: "Европа", operatorId: 1, operator: "Turkcell", type: "eSIM", data: "20 ГБ", dataMb: 20480, isUnlimited: false, days: 30, price: 2490, oldPrice: 2890, popular: true, tone: "from-[#1679f2] to-[#0d46ad]" }),
  createFallbackProduct({ id: 2, sku: "TH-ESIM-UNL-15", slug: "thailand-ais-unlimited", countryId: 2, country: "Таиланд", flag: "🇹🇭", region: "Азия", operatorId: 2, operator: "AIS", type: "eSIM", data: "Безлимит", dataMb: null, isUnlimited: true, days: 15, price: 3190, calls: "15 минут", tone: "from-[#7047eb] to-[#4020a7]" }),
  createFallbackProduct({ id: 3, sku: "AE-SIM-10-28", slug: "uae-du-10gb", countryId: 3, country: "ОАЭ", flag: "🇦🇪", region: "Ближний Восток", operatorId: 3, operator: "du", type: "SIM", data: "10 ГБ", dataMb: 10240, isUnlimited: false, days: 28, price: 3590, calls: "30 минут", tone: "from-[#ef6a39] to-[#bb2c21]" }),
  createFallbackProduct({ id: 4, sku: "DE-ESIM-30-30", slug: "germany-o2-30gb", countryId: 4, country: "Германия", flag: "🇩🇪", region: "Европа", operatorId: 4, operator: "O2", type: "eSIM", data: "30 ГБ", dataMb: 30720, isUnlimited: false, days: 30, price: 2790, popular: true, tone: "from-[#10a985] to-[#08705c]" }),
  createFallbackProduct({ id: 5, sku: "US-ESIM-20-30", slug: "usa-tmobile-20gb", countryId: 5, country: "США", flag: "🇺🇸", region: "Америка", operatorId: 5, operator: "T-Mobile", type: "eSIM", data: "20 ГБ", dataMb: 20480, isUnlimited: false, days: 30, price: 3990, calls: "Безлимит", tone: "from-[#ef3f92] to-[#a20d5d]" }),
  createFallbackProduct({ id: 6, sku: "JP-SIM-15-16", slug: "japan-kddi-15gb", countryId: 6, country: "Япония", flag: "🇯🇵", region: "Азия", operatorId: 6, operator: "KDDI", type: "SIM", data: "15 ГБ", dataMb: 15360, isUnlimited: false, days: 16, price: 2890, tone: "from-[#27344a] to-[#111827]" }),
];

export function getProductById(id: number) {
  return products.find((product) => product.id === id);
}

export function getProductBySlug(slug: string) {
  return products.find((product) => product.slug === slug);
}

export function slugify(value: string) {
  return value.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9а-яё]+/gi, "-").replace(/^-+|-+$/g, "");
}
