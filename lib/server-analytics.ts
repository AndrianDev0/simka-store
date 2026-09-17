import { and, desc, eq, isNull } from "drizzle-orm";
import { getDb } from "@/db";
import { orderItems, orders, privacyConsentEvents } from "@/db/schema";
import { allowsAnalytics } from "@/lib/analytics-policy";

type TrackedStatus = "PAID" | "CANCELLED" | "REFUNDED";

const statusConfig = {
  PAID: { event: "purchase", sentAt: orders.analyticsPurchaseSentAt },
  CANCELLED: { event: "order_cancelled", sentAt: orders.analyticsCancellationSentAt },
  REFUNDED: { event: "refund", sentAt: orders.analyticsRefundSentAt },
} as const;

export async function sendOrderAnalytics(orderId: string, status: TrackedStatus) {
  const measurementId = process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID?.trim();
  const apiSecret = process.env.GA_MEASUREMENT_API_SECRET?.trim();
  if (!measurementId || !apiSecret) return false;

  const db = getDb();
  const config = statusConfig[status];
  const [order] = await db.select({
    id: orders.id,
    orderNumber: orders.orderNumber,
    customerAccountId: orders.customerAccountId,
    analyticsClientId: orders.analyticsClientId,
    firstPartyClientId: orders.firstPartyClientId,
    totalAmount: orders.totalAmount,
    promoCode: orders.promoCode,
    currency: orders.currency,
    sentAt: config.sentAt,
  }).from(orders).where(eq(orders.id, orderId)).limit(1);
  if (!order?.analyticsClientId || !order.firstPartyClientId || order.sentAt) return false;

  const [latestConsent] = await db.select({
    decision: privacyConsentEvents.decision,
    policyVersion: privacyConsentEvents.policyVersion,
  }).from(privacyConsentEvents)
    .where(eq(privacyConsentEvents.consentId, order.firstPartyClientId))
    .orderBy(desc(privacyConsentEvents.createdAt))
    .limit(1);
  if (!allowsAnalytics(latestConsent)) return false;

  const items = await db.select({
    sku: orderItems.sku,
    productName: orderItems.productName,
    simType: orderItems.simType,
    unitPrice: orderItems.unitPrice,
    quantity: orderItems.quantity,
  }).from(orderItems).where(eq(orderItems.orderId, order.id));

  const endpoint = new URL("https://www.google-analytics.com/mp/collect");
  endpoint.searchParams.set("measurement_id", measurementId);
  endpoint.searchParams.set("api_secret", apiSecret);
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: order.analyticsClientId,
      ...(order.customerAccountId ? { user_id: order.customerAccountId } : {}),
      events: [{
        name: config.event,
        params: {
          transaction_id: order.orderNumber,
          value: order.totalAmount,
          currency: order.currency,
          ...(order.promoCode ? { coupon: order.promoCode } : {}),
          items: items.map((item) => ({ item_id: item.sku, item_name: item.productName, item_category: item.simType, price: item.unitPrice, quantity: item.quantity })),
        },
      }],
    }),
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) throw new Error(`GA_MEASUREMENT_PROTOCOL_${response.status}`);

  const now = new Date().toISOString();
  const value = status === "PAID" ? { analyticsPurchaseSentAt: now }
    : status === "CANCELLED" ? { analyticsCancellationSentAt: now }
      : { analyticsRefundSentAt: now };
  await db.update(orders).set(value).where(and(eq(orders.id, order.id), isNull(config.sentAt)));
  return true;
}
