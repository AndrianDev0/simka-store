import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { orders, orderItems } from "@/db/schema";
import { getCurrentAccount } from "@/lib/customer-auth";

export async function GET(request: Request) {
  const account = await getCurrentAccount();
  if (!account) return Response.json({ error: "UNAUTHORIZED" }, { status: 401 });
  const orderNumber = new URL(request.url).searchParams.get("order")?.trim() || "";
  if (!orderNumber || orderNumber.length > 80) return Response.json({ error: "ORDER_NOT_FOUND" }, { status: 404 });
  const db = getDb();
  const [order] = await db.select({ id: orders.id }).from(orders).where(and(eq(orders.orderNumber, orderNumber), eq(orders.customerAccountId, account.id))).limit(1);
  if (!order) return Response.json({ error: "ORDER_NOT_FOUND" }, { status: 404 });
  const items = await db.select({ productId: orderItems.productId, variantId: orderItems.variantId, quantity: orderItems.quantity }).from(orderItems).where(eq(orderItems.orderId, order.id));
  return Response.json({ items }, { headers: { "Cache-Control": "no-store" } });
}
