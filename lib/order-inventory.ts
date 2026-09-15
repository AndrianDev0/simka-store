import { and, eq, inArray, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { catalogProducts, orderItems, orders, productVariants } from "@/db/schema";

export async function releaseReservedInventory(orderId: string, finalStatus: string, allowedStatuses: string[]) {
  const db = getDb();
  const items = await db.select({ productId: orderItems.productId, variantId: orderItems.variantId, quantity: orderItems.quantity }).from(orderItems).where(eq(orderItems.orderId, orderId));
  const products = new Map<number, number>();
  const variants = new Map<number, number>();
  for (const item of items) {
    products.set(item.productId, (products.get(item.productId) ?? 0) + item.quantity);
    if (item.variantId !== null) variants.set(item.variantId, (variants.get(item.variantId) ?? 0) + item.quantity);
  }

  return db.transaction(async (tx) => {
    const now = new Date().toISOString();
    const [changed] = await tx.update(orders).set({ status: finalStatus, inventoryReserved: false, updatedAt: now }).where(and(eq(orders.id, orderId), eq(orders.inventoryReserved, true), inArray(orders.status, allowedStatuses))).returning({ id: orders.id });
    if (!changed) return false;
    for (const [productId, quantity] of products) {
      await tx.update(catalogProducts).set({
        stockQuantity: sql`CASE WHEN ${catalogProducts.stockQuantity} IS NULL THEN NULL ELSE ${catalogProducts.stockQuantity} + ${quantity} END`,
        available: true,
        availabilityStatus: sql`CASE WHEN ${catalogProducts.availabilityStatus} = 'OUT_OF_STOCK' THEN 'IN_STOCK' ELSE ${catalogProducts.availabilityStatus} END`,
        updatedAt: now,
      }).where(eq(catalogProducts.id, productId));
    }
    for (const [variantId, quantity] of variants) {
      await tx.update(productVariants).set({
        stockQuantity: sql`CASE WHEN ${productVariants.stockQuantity} IS NULL THEN NULL ELSE ${productVariants.stockQuantity} + ${quantity} END`,
        available: true,
        availabilityStatus: sql`CASE WHEN ${productVariants.availabilityStatus} = 'OUT_OF_STOCK' THEN 'IN_STOCK' ELSE ${productVariants.availabilityStatus} END`,
        updatedAt: now,
      }).where(eq(productVariants.id, variantId));
    }
    return true;
  });
}
