import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const orders = sqliteTable("orders", {
  id: text("id").primaryKey(),
  requestId: text("request_id").notNull(),
  orderNumber: text("order_number").notNull(),
  customerName: text("customer_name").notNull(),
  customerEmail: text("customer_email").notNull(),
  customerContact: text("customer_contact").notNull().default(""),
  deliveryAddress: text("delivery_address"),
  customerComment: text("customer_comment").notNull().default(""),
  paymentMethod: text("payment_method", { enum: ["crypto", "manager"] }).notNull(),
  status: text("status", { enum: ["NEW", "WAITING_FOR_MANAGER", "WAITING_PAYMENT"] }).notNull(),
  totalAmount: integer("total_amount").notNull(),
  currency: text("currency").notNull().default("RUB"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  uniqueIndex("idx_orders_request_id").on(table.requestId),
  uniqueIndex("idx_orders_order_number").on(table.orderNumber),
  index("idx_orders_customer_email").on(table.customerEmail),
  index("idx_orders_status_created_at").on(table.status, table.createdAt),
]);

export const orderItems = sqliteTable("order_items", {
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
