import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  uniqueIndex,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";

type JsonScalar = string | number | boolean | null;
type JsonObject = Record<string, JsonScalar>;
type CountryFaqItem = { question: string; answer: string };
type DeliveryOption = {
  id: string;
  label: string;
  cost: number | null;
  currency: string;
  regions: string[];
  dispatchDaysMin: number | null;
  dispatchDaysMax: number | null;
};

export const customerAccounts = pgTable("customer_accounts", {
  id: text("id").primaryKey(),
  email: text("email").notNull(),
  passwordHash: text("password_hash").notNull(),
  name: text("name").notNull(),
  contact: text("contact").notNull().default(""),
  partnerCode: text("partner_code"),
  isBlocked: boolean("is_blocked").notNull().default(false),
  blockedAt: text("blocked_at"),
  blockedReason: text("blocked_reason"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  uniqueIndex("idx_customer_accounts_email").on(table.email),
  index("idx_customer_accounts_partner_code").on(table.partnerCode),
]);

export const customerSessions = pgTable("customer_sessions", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull().references(() => customerAccounts.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull(),
  expiresAt: text("expires_at").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  lastUsedAt: text("last_used_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  uniqueIndex("idx_customer_sessions_token_hash").on(table.tokenHash),
  index("idx_customer_sessions_account_id").on(table.accountId),
  index("idx_customer_sessions_expires_at").on(table.expiresAt),
]);

export const customerPasswordResets = pgTable("customer_password_resets", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull().references(() => customerAccounts.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull(),
  expiresAt: text("expires_at").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  uniqueIndex("idx_customer_password_resets_token_hash").on(table.tokenHash),
  index("idx_customer_password_resets_account_id").on(table.accountId),
]);

export const privacyConsentEvents = pgTable("privacy_consent_events", {
  id: text("id").primaryKey(),
  consentId: text("consent_id").notNull(),
  accountId: text("account_id").references(() => customerAccounts.id, { onDelete: "set null" }),
  decision: text("decision", { enum: ["accepted", "declined", "withdrawn"] }).notNull(),
  source: text("source", { enum: ["banner", "settings"] }).notNull(),
  policyVersion: text("policy_version").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  index("idx_privacy_consent_events_consent_id").on(table.consentId),
  index("idx_privacy_consent_events_account_id").on(table.accountId),
  index("idx_privacy_consent_events_created_at").on(table.createdAt),
]);

export const promoCodes = pgTable("promo_codes", {
  id: text("id").primaryKey(),
  code: text("code").notNull(),
  discountType: text("discount_type", { enum: ["percent", "fixed"] }).notNull(),
  discountValue: integer("discount_value").notNull(),
  currency: text("currency").notNull().default("RUB"),
  minOrderAmount: integer("min_order_amount").notNull().default(0),
  usageLimit: integer("usage_limit"),
  active: boolean("active").notNull().default(true),
  startsAt: text("starts_at"),
  endsAt: text("ends_at"),
  createdBy: text("created_by").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  uniqueIndex("idx_promo_codes_code").on(table.code),
  index("idx_promo_codes_active_dates").on(table.active, table.startsAt, table.endsAt),
  check("promo_codes_discount_value_positive", sql`${table.discountValue} > 0`),
  check("promo_codes_percent_below_100", sql`${table.discountType} <> 'percent' OR ${table.discountValue} < 100`),
  check("promo_codes_min_order_nonnegative", sql`${table.minOrderAmount} >= 0`),
  check("promo_codes_usage_limit_positive", sql`${table.usageLimit} IS NULL OR ${table.usageLimit} > 0`),
]);

export const partners = pgTable("partners", {
  id: text("id").primaryKey(),
  code: text("code").notNull(),
  name: text("name").notNull(),
  commissionBps: integer("commission_bps").notNull().default(0),
  active: boolean("active").notNull().default(true),
  createdBy: text("created_by").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  uniqueIndex("idx_partners_code").on(table.code),
  index("idx_partners_active_created_at").on(table.active, table.createdAt),
  check("partners_commission_valid", sql`${table.commissionBps} >= 0 AND ${table.commissionBps} <= 10000`),
]);

export const partnerClicks = pgTable("partner_clicks", {
  id: text("id").primaryKey(),
  partnerCode: text("partner_code").notNull(),
  visitorHash: text("visitor_hash").notNull(),
  clickCount: integer("click_count").notNull().default(1),
  landingPath: text("landing_path").notNull().default("/"),
  firstSeenAt: text("first_seen_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  lastSeenAt: text("last_seen_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  uniqueIndex("idx_partner_clicks_partner_visitor").on(table.partnerCode, table.visitorHash),
  index("idx_partner_clicks_last_seen_at").on(table.lastSeenAt),
  check("partner_clicks_count_positive", sql`${table.clickCount} > 0`),
]);

export const marketingCosts = pgTable("marketing_costs", {
  id: text("id").primaryKey(), source: text("source").notNull(), campaign: text("campaign"), amount: integer("amount").notNull(),
  currency: text("currency").notNull().default("RUB"), startsAt: text("starts_at").notNull(), endsAt: text("ends_at").notNull(),
  createdBy: text("created_by").notNull(), createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  index("idx_marketing_costs_period").on(table.startsAt, table.endsAt),
  index("idx_marketing_costs_source_campaign").on(table.source, table.campaign),
  check("marketing_costs_amount_positive", sql`${table.amount} > 0`),
]);

export const orders = pgTable("orders", {
  id: text("id").primaryKey(),
  requestId: text("request_id").notNull(),
  orderNumber: text("order_number").notNull(),
  customerAccountId: text("customer_account_id").references(() => customerAccounts.id, { onDelete: "set null" }),
  customerName: text("customer_name").notNull(),
  customerEmail: text("customer_email").notNull(),
  customerContact: text("customer_contact").notNull().default(""),
  deliveryAddress: text("delivery_address"),
  customerComment: text("customer_comment").notNull().default(""),
  paymentMethod: text("payment_method", { enum: ["crypto", "manager"] }).notNull(),
  // Kept as text so new workflow states can be added without a destructive migration.
  status: text("status").notNull(),
  subtotalAmount: integer("subtotal_amount").notNull().default(0),
  promoCode: text("promo_code"),
  partnerCode: text("partner_code"),
  discountAmount: integer("discount_amount").notNull().default(0),
  deliveryAmount: integer("delivery_amount").notNull().default(0),
  totalAmount: integer("total_amount").notNull(),
  currency: text("currency").notNull().default("RUB"),
  inventoryReserved: boolean("inventory_reserved").notNull().default(false),
  paymentInstructionsSentAt: text("payment_instructions_sent_at"),
  paidAt: text("paid_at"),
  analyticsClientId: text("analytics_client_id"),
  analyticsSource: text("analytics_source"),
  analyticsMedium: text("analytics_medium"),
  analyticsCampaign: text("analytics_campaign"),
  analyticsContent: text("analytics_content"),
  analyticsTerm: text("analytics_term"),
  analyticsPurchaseSentAt: text("analytics_purchase_sent_at"),
  analyticsCancellationSentAt: text("analytics_cancellation_sent_at"),
  analyticsRefundSentAt: text("analytics_refund_sent_at"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  uniqueIndex("idx_orders_request_id").on(table.requestId),
  uniqueIndex("idx_orders_order_number").on(table.orderNumber),
  index("idx_orders_customer_email").on(table.customerEmail),
  index("idx_orders_customer_account_id").on(table.customerAccountId),
  index("idx_orders_status_created_at").on(table.status, table.createdAt),
  index("idx_orders_paid_at").on(table.paidAt),
  index("idx_orders_partner_code").on(table.partnerCode),
  check("orders_subtotal_amount_nonnegative", sql`${table.subtotalAmount} >= 0`),
  check("orders_discount_amount_nonnegative", sql`${table.discountAmount} >= 0`),
  check("orders_discount_not_above_subtotal", sql`${table.discountAmount} <= ${table.subtotalAmount}`),
  check("orders_delivery_amount_nonnegative", sql`${table.deliveryAmount} >= 0`),
  check("orders_total_amount_nonnegative", sql`${table.totalAmount} >= 0`),
  check("orders_total_amount_consistent", sql`${table.totalAmount} = ${table.subtotalAmount} - ${table.discountAmount} + ${table.deliveryAmount}`),
]);

export const orderItems = pgTable("order_items", {
  id: text("id").primaryKey(),
  orderId: text("order_id").notNull().references(() => orders.id, { onDelete: "cascade" }),
  productId: integer("product_id").notNull(),
  // Historical order lines are immutable snapshots; a variant may not exist anymore.
  variantId: integer("variant_id"),
  sku: text("sku").notNull(),
  productName: text("product_name").notNull(),
  simType: text("sim_type", { enum: ["eSIM", "SIM"] }).notNull(),
  unitPrice: integer("unit_price").notNull(),
  // Procurement cost at checkout. Null means the cost was not configured.
  unitCost: integer("unit_cost"),
  quantity: integer("quantity").notNull(),
  lineTotal: integer("line_total").notNull(),
  fulfillmentStatus: text("fulfillment_status").notNull().default("PENDING"),
  deliveryMethod: text("delivery_method"),
  deliveryCost: integer("delivery_cost").notNull().default(0),
  deliveryCostConfirmed: boolean("delivery_cost_confirmed").notNull().default(false),
  trackingNumber: text("tracking_number"),
  trackingUrl: text("tracking_url"),
  activationCodeEncrypted: text("activation_code_encrypted"),
  fulfillmentInstructions: text("fulfillment_instructions"),
  fulfilledAt: text("fulfilled_at"),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  index("idx_order_items_order_id").on(table.orderId),
  index("idx_order_items_fulfillment_status").on(table.fulfillmentStatus),
  check("order_items_delivery_cost_nonnegative", sql`${table.deliveryCost} >= 0`),
  check("order_items_unit_cost_nonnegative", sql`${table.unitCost} IS NULL OR ${table.unitCost} >= 0`),
]);

export const cryptoPayments = pgTable("crypto_payments", {
  id: text("id").primaryKey(),
  orderId: text("order_id").notNull().references(() => orders.id, { onDelete: "cascade" }),
  provider: text("provider").notNull(),
  providerPaymentId: text("provider_payment_id"),
  status: text("status").notNull().default("CREATING"),
  checkoutUrl: text("checkout_url"),
  requestedAmount: integer("requested_amount").notNull(),
  requestedCurrency: text("requested_currency").notNull(),
  receivedAmount: integer("received_amount"),
  receivedCurrency: text("received_currency"),
  transactionId: text("transaction_id"),
  paidAt: text("paid_at"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  uniqueIndex("idx_crypto_payments_order_id").on(table.orderId),
  uniqueIndex("idx_crypto_payments_provider_payment").on(table.provider, table.providerPaymentId),
  uniqueIndex("idx_crypto_payments_provider_transaction").on(table.provider, table.transactionId),
  index("idx_crypto_payments_status").on(table.status),
  check("crypto_payments_requested_amount_positive", sql`${table.requestedAmount} > 0`),
  check("crypto_payments_received_amount_nonnegative", sql`${table.receivedAmount} IS NULL OR ${table.receivedAmount} >= 0`),
]);

export const cryptoPaymentEvents = pgTable("crypto_payment_events", {
  id: text("id").primaryKey(),
  provider: text("provider").notNull(),
  providerEventId: text("provider_event_id").notNull(),
  cryptoPaymentId: text("crypto_payment_id").notNull().references(() => cryptoPayments.id, { onDelete: "cascade" }),
  eventType: text("event_type").notNull(),
  payloadHash: text("payload_hash").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  uniqueIndex("idx_crypto_payment_events_provider_event").on(table.provider, table.providerEventId),
  index("idx_crypto_payment_events_payment_id").on(table.cryptoPaymentId),
]);

export const countries = pgTable("countries", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull(),
  isoCode: text("iso_code"),
  flag: text("flag").notNull().default(""),
  region: text("region").notNull().default(""),
  description: text("description").notNull().default(""),
  imageUrl: text("image_url"),
  seoTitle: text("seo_title"),
  seoDescription: text("seo_description"),
  h1: text("h1"),
  seoText: text("seo_text"),
  canonicalUrl: text("canonical_url"),
  faq: jsonb("faq").$type<CountryFaqItem[]>().notNull().default(sql`'[]'::jsonb`),
  publicationStatus: text("publication_status", { enum: ["DRAFT", "PUBLISHED", "ARCHIVED"] }).notNull().default("DRAFT"),
  noindex: boolean("noindex").notNull().default(true),
  sortOrder: integer("sort_order").notNull().default(0),
  archivedAt: text("archived_at"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  uniqueIndex("idx_countries_slug").on(table.slug),
  uniqueIndex("idx_countries_iso_code").on(table.isoCode),
  index("idx_countries_publication_order").on(table.publicationStatus, table.archivedAt, table.sortOrder),
]);

export const operators = pgTable("operators", {
  id: serial("id").primaryKey(),
  countryId: integer("country_id").notNull().references(() => countries.id, { onDelete: "restrict" }),
  name: text("name").notNull(),
  slug: text("slug").notNull(),
  description: text("description").notNull().default(""),
  logoUrl: text("logo_url"),
  publicationStatus: text("publication_status", { enum: ["DRAFT", "PUBLISHED", "ARCHIVED"] }).notNull().default("DRAFT"),
  sortOrder: integer("sort_order").notNull().default(0),
  archivedAt: text("archived_at"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  uniqueIndex("idx_operators_country_slug").on(table.countryId, table.slug),
  index("idx_operators_country_publication").on(table.countryId, table.publicationStatus, table.sortOrder),
]);

export const categories = pgTable("categories", {
  id: text("id").primaryKey(),
  parentId: text("parent_id").references((): AnyPgColumn => categories.id, { onDelete: "restrict" }),
  name: text("name").notNull(),
  slug: text("slug").notNull(),
  description: text("description").notNull().default(""),
  imageUrl: text("image_url"),
  seoTitle: text("seo_title"),
  seoDescription: text("seo_description"),
  h1: text("h1"),
  seoText: text("seo_text"),
  canonicalUrl: text("canonical_url"),
  ogTitle: text("og_title"),
  ogDescription: text("og_description"),
  ogImage: text("og_image"),
  isPublished: boolean("is_published").notNull().default(false),
  noindex: boolean("noindex").notNull().default(true),
  sortOrder: integer("sort_order").notNull().default(0),
  archivedAt: text("archived_at"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  uniqueIndex("idx_categories_slug").on(table.slug),
  index("idx_categories_parent_order").on(table.parentId, table.sortOrder),
  index("idx_categories_published_order").on(table.isPublished, table.archivedAt, table.sortOrder),
]);

export const catalogProducts = pgTable("products", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  sku: text("sku").notNull(),
  slug: text("slug").notNull(),
  countryId: integer("country_id").notNull().references(() => countries.id, { onDelete: "restrict" }),
  operatorId: integer("operator_id").notNull().references(() => operators.id, { onDelete: "restrict" }),
  simType: text("sim_type", { enum: ["eSIM", "SIM"] }).notNull(),
  price: integer("price").notNull(),
  oldPrice: integer("old_price"),
  unitCost: integer("unit_cost"),
  currency: text("currency").notNull().default("RUB"),
  shortDescription: text("short_description").notNull().default(""),
  fullDescription: text("full_description").notNull().default(""),
  characteristics: jsonb("characteristics").$type<JsonObject>().notNull().default(sql`'{}'::jsonb`),
  validityDays: integer("validity_days").notNull(),
  dataVolume: text("data_volume").notNull(),
  dataMb: integer("data_mb"),
  isUnlimited: boolean("is_unlimited").notNull().default(false),
  hasCalls: boolean("has_calls").notNull().default(false),
  callsDetails: text("calls_details"),
  hasSms: boolean("has_sms").notNull().default(false),
  smsDetails: text("sms_details"),
  roamingTerms: text("roaming_terms").notNull().default(""),
  activationTerms: text("activation_terms").notNull().default(""),
  compatibility: text("compatibility").notNull().default(""),
  instructions: text("instructions").notNull().default(""),
  esimType: text("esim_type"),
  esimDeliveryMethod: text("esim_delivery_method"),
  deliveryOptions: jsonb("delivery_options").$type<DeliveryOption[]>().notNull().default(sql`'[]'::jsonb`),
  popular: boolean("popular").notNull().default(false),
  tone: text("tone").notNull().default("from-[#1679f2] to-[#0d46ad]"),
  available: boolean("available").notNull().default(false),
  availabilityStatus: text("availability_status", { enum: ["IN_STOCK", "OUT_OF_STOCK", "PREORDER"] }).notNull().default("OUT_OF_STOCK"),
  stockQuantity: integer("stock_quantity"),
  publicationStatus: text("publication_status", { enum: ["DRAFT", "PUBLISHED", "ARCHIVED"] }).notNull().default("DRAFT"),
  seoTitle: text("seo_title"),
  seoDescription: text("seo_description"),
  h1: text("h1"),
  seoText: text("seo_text"),
  canonicalUrl: text("canonical_url"),
  ogTitle: text("og_title"),
  ogDescription: text("og_description"),
  ogImage: text("og_image"),
  sortOrder: integer("sort_order").notNull().default(0),
  archivedAt: text("archived_at"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  uniqueIndex("idx_products_sku").on(table.sku),
  uniqueIndex("idx_products_slug").on(table.slug),
  index("idx_products_publication_order").on(table.publicationStatus, table.archivedAt, table.sortOrder),
  index("idx_products_catalog_filters").on(table.countryId, table.operatorId, table.simType, table.available),
  index("idx_products_price_validity_data").on(table.price, table.validityDays, table.dataMb),
  check("products_price_nonnegative", sql`${table.price} >= 0`),
  check("products_old_price_nonnegative", sql`${table.oldPrice} IS NULL OR ${table.oldPrice} >= 0`),
  check("products_unit_cost_nonnegative", sql`${table.unitCost} IS NULL OR ${table.unitCost} >= 0`),
  check("products_validity_days_positive", sql`${table.validityDays} > 0`),
  check("products_data_mb_nonnegative", sql`${table.dataMb} IS NULL OR ${table.dataMb} >= 0`),
  check("products_stock_quantity_nonnegative", sql`${table.stockQuantity} IS NULL OR ${table.stockQuantity} >= 0`),
]);

export const productVariants = pgTable("product_variants", {
  id: serial("id").primaryKey(),
  productId: integer("product_id").notNull().references(() => catalogProducts.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  sku: text("sku").notNull(),
  slug: text("slug").notNull(),
  price: integer("price").notNull(),
  unitCost: integer("unit_cost"),
  currency: text("currency").notNull().default("RUB"),
  dataVolume: text("data_volume"),
  validityDays: integer("validity_days"),
  characteristics: jsonb("characteristics").$type<JsonObject>().notNull().default(sql`'{}'::jsonb`),
  available: boolean("available").notNull().default(false),
  availabilityStatus: text("availability_status", { enum: ["IN_STOCK", "OUT_OF_STOCK", "PREORDER"] }).notNull().default("OUT_OF_STOCK"),
  stockQuantity: integer("stock_quantity"),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  uniqueIndex("idx_product_variants_sku").on(table.sku),
  uniqueIndex("idx_product_variants_slug").on(table.slug),
  index("idx_product_variants_product_order").on(table.productId, table.sortOrder),
  check("product_variants_price_nonnegative", sql`${table.price} >= 0`),
  check("product_variants_unit_cost_nonnegative", sql`${table.unitCost} IS NULL OR ${table.unitCost} >= 0`),
  check("product_variants_validity_days_positive", sql`${table.validityDays} IS NULL OR ${table.validityDays} > 0`),
  check("product_variants_stock_quantity_nonnegative", sql`${table.stockQuantity} IS NULL OR ${table.stockQuantity} >= 0`),
]);

export const productImages = pgTable("product_images", {
  id: serial("id").primaryKey(),
  productId: integer("product_id").notNull().references(() => catalogProducts.id, { onDelete: "cascade" }),
  url: text("url").notNull(),
  alt: text("alt").notNull().default(""),
  sortOrder: integer("sort_order").notNull().default(0),
  isPrimary: boolean("is_primary").notNull().default(false),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  uniqueIndex("idx_product_images_product_url").on(table.productId, table.url),
  index("idx_product_images_product_order").on(table.productId, table.sortOrder),
]);

export const productCategories = pgTable("product_categories", {
  productId: integer("product_id").notNull().references(() => catalogProducts.id, { onDelete: "restrict" }),
  categoryId: text("category_id").notNull().references(() => categories.id, { onDelete: "cascade" }),
}, (table) => [
  uniqueIndex("idx_product_categories_pair").on(table.productId, table.categoryId),
  index("idx_product_categories_category_id").on(table.categoryId),
]);

export const adminAuditLog = pgTable("admin_audit_log", {
  id: text("id").primaryKey(),
  adminTelegramId: text("admin_telegram_id").notNull(),
  action: text("action").notNull(),
  entityType: text("entity_type").notNull(),
  entityId: text("entity_id"),
  metadata: text("metadata").notNull().default("{}"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [index("idx_admin_audit_created_at").on(table.createdAt)]);

export const storeSettings = pgTable("store_settings", {
  key: text("key").primaryKey(),
  encryptedValue: text("encrypted_value").notNull(),
  updatedBy: text("updated_by").notNull(),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const requestRateLimits = pgTable("request_rate_limits", {
  key: text("key").primaryKey(),
  action: text("action").notNull(),
  subjectHash: text("subject_hash").notNull(),
  windowStartedAt: text("window_started_at").notNull(),
  count: integer("count").notNull().default(1),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  index("idx_request_rate_limits_updated_at").on(table.updatedAt),
  check("request_rate_limits_count_positive", sql`${table.count} > 0`),
]);

export const operationalEvents = pgTable("operational_events", {
  id: text("id").primaryKey(),
  kind: text("kind").notNull(),
  severity: text("severity", { enum: ["warning", "error", "critical"] }).notNull(),
  area: text("area").notNull(),
  path: text("path").notNull(),
  code: text("code").notNull(),
  count: integer("count").notNull().default(1),
  firstSeenAt: text("first_seen_at").notNull(),
  lastSeenAt: text("last_seen_at").notNull(),
}, (table) => [
  index("idx_operational_events_last_seen_at").on(table.lastSeenAt),
  index("idx_operational_events_kind_last_seen").on(table.kind, table.lastSeenAt),
  check("operational_events_count_positive", sql`${table.count} > 0`),
]);

export const searchAnalytics = pgTable("search_analytics", {
  id: text("id").primaryKey(),
  day: text("day").notNull(),
  query: text("query").notNull(),
  searches: integer("searches").notNull().default(1),
  noResultSearches: integer("no_result_searches").notNull().default(0),
  totalResults: integer("total_results").notNull().default(0),
  firstSeenAt: text("first_seen_at").notNull(),
  lastSeenAt: text("last_seen_at").notNull(),
}, (table) => [
  index("idx_search_analytics_last_seen_at").on(table.lastSeenAt),
  index("idx_search_analytics_query").on(table.query),
  check("search_analytics_searches_positive", sql`${table.searches} > 0`),
  check("search_analytics_counts_nonnegative", sql`${table.noResultSearches} >= 0 AND ${table.totalResults} >= 0`),
]);

export const seoRedirects = pgTable("seo_redirects", {
  id: serial("id").primaryKey(),
  entityType: text("entity_type", { enum: ["category", "country", "product"] }).notNull(),
  entityId: text("entity_id").notNull(),
  oldSlug: text("old_slug").notNull(),
  newSlug: text("new_slug").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  uniqueIndex("idx_seo_redirects_entity_old_slug").on(table.entityType, table.oldSlug),
  index("idx_seo_redirects_entity_id").on(table.entityType, table.entityId),
]);
