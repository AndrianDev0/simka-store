import { sql } from "drizzle-orm";
import { boolean, index, integer, pgTable, text, uniqueIndex } from "drizzle-orm/pg-core";

export const orders = pgTable("orders", {
  id: text("id").primaryKey(),
  requestId: text("request_id").notNull(),
  orderNumber: text("order_number").notNull(),
  customerName: text("customer_name").notNull(),
  customerEmail: text("customer_email").notNull(),
  customerContact: text("customer_contact").notNull().default(""),
  deliveryAddress: text("delivery_address"),
  customerComment: text("customer_comment").notNull().default(""),
  paymentMethod: text("payment_method", { enum: ["crypto", "manager"] }).notNull(),
  // Kept as text so new workflow states can be added without a destructive migration.
  status: text("status").notNull(),
  totalAmount: integer("total_amount").notNull(),
  currency: text("currency").notNull().default("RUB"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  uniqueIndex("idx_orders_request_id").on(table.requestId),
  uniqueIndex("idx_orders_order_number").on(table.orderNumber),
  index("idx_orders_customer_email").on(table.customerEmail),
  index("idx_orders_status_created_at").on(table.status, table.createdAt),
]);

export const orderItems = pgTable("order_items", {
  id: text("id").primaryKey(),
  orderId: text("order_id").notNull().references(() => orders.id, { onDelete: "cascade" }),
  productId: integer("product_id").notNull(),
  sku: text("sku").notNull(),
  productName: text("product_name").notNull(),
  simType: text("sim_type", { enum: ["eSIM", "SIM"] }).notNull(),
  unitPrice: integer("unit_price").notNull(),
  quantity: integer("quantity").notNull(),
  lineTotal: integer("line_total").notNull(),
}, (table) => [index("idx_order_items_order_id").on(table.orderId)]);

export const categories = pgTable("categories", {
  id: text("id").primaryKey(),
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
  index("idx_categories_published_order").on(table.isPublished, table.archivedAt, table.sortOrder),
]);

export const productCategories = pgTable("product_categories", {
  productId: integer("product_id").notNull(),
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
