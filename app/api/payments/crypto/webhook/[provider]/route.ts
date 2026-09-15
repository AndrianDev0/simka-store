import { createHash } from "node:crypto";
import { and, eq, inArray, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db";
import { catalogProducts, cryptoPaymentEvents, cryptoPayments, orderItems, orders, productVariants } from "@/db/schema";
import { getCryptoPaymentConfig, verifyCryptoWebhookSignature } from "@/lib/crypto-payments";
import { escapeHtml, sendTransactionalEmail } from "@/lib/email";
import { sendOrderAnalytics } from "@/lib/server-analytics";

export const runtime = "nodejs";

const webhookSchema = z.object({
  event_id: z.string().trim().min(1).max(200),
  event_type: z.string().trim().min(1).max(100),
  payment_id: z.string().trim().min(1).max(200),
  order_id: z.string().uuid(),
  status: z.enum(["pending", "confirmed", "paid", "failed", "cancelled", "expired"]),
  amount: z.number().int().nonnegative(),
  currency: z.string().trim().min(3).max(12),
  transaction_id: z.string().trim().min(1).max(300).optional(),
  paid_at: z.string().datetime({ offset: true }).optional(),
}).strict();

async function notifyPaymentConfirmed(order: { customerEmail: string; customerName: string; orderNumber: string; totalAmount: number; currency: string }) {
  const amount = `${order.totalAmount.toLocaleString("ru-RU")} ${order.currency}`;
  await sendTransactionalEmail({
    to: order.customerEmail,
    subject: `Оплата заказа ${order.orderNumber} подтверждена — SIMKA`,
    text: `Здравствуйте, ${order.customerName}!\n\nПлатёж по заказу ${order.orderNumber} на сумму ${amount} подтверждён платёжным провайдером. Заказ передан в обработку.`,
    html: `<div style="font-family:Arial,sans-serif;line-height:1.6;color:#10213a"><h1 style="font-size:24px">Оплата подтверждена</h1><p>Здравствуйте, ${escapeHtml(order.customerName)}!</p><p>Платёж по заказу <strong>${escapeHtml(order.orderNumber)}</strong> на сумму <strong>${escapeHtml(amount)}</strong> подтверждён платёжным провайдером.</p><p>Заказ передан в обработку.</p></div>`,
  });

  await notifyManagers(`Криптоплатёж подтверждён\nЗаказ: ${order.orderNumber}\nСумма: ${amount}`, order.orderNumber);
}

async function notifyManagers(text: string, orderNumber: string) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const adminIds = (process.env.TELEGRAM_ADMIN_IDS ?? "").split(",").map((id) => id.trim()).filter(Boolean);
  if (!token || !adminIds.length) return;
  await Promise.allSettled(adminIds.map((chatId) => fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, reply_markup: { inline_keyboard: [[{ text: "Открыть заказ", callback_data: `order:view:${orderNumber}` }]] } }),
    signal: AbortSignal.timeout(10_000),
  })));
}

export async function POST(request: Request, context: { params: Promise<{ provider: string }> }) {
  const config = getCryptoPaymentConfig();
  const { provider } = await context.params;
  if (!config || provider.toLowerCase() !== config.provider) return Response.json({ error: "Not found" }, { status: 404 });
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) return Response.json({ error: "Unsupported media type" }, { status: 415 });
  const contentLength = Number(request.headers.get("content-length") || 0);
  if (contentLength > 100_000) return Response.json({ error: "Payload too large" }, { status: 413 });

  const rawBody = await request.text();
  if (Buffer.byteLength(rawBody, "utf8") > 100_000) return Response.json({ error: "Payload too large" }, { status: 413 });
  const validSignature = verifyCryptoWebhookSignature({
    rawBody,
    timestamp: request.headers.get("x-payment-timestamp"),
    signature: request.headers.get("x-payment-signature"),
    secret: config.webhookSecret,
  });
  if (!validSignature) return Response.json({ error: "Invalid signature" }, { status: 401 });

  let json: unknown;
  try { json = JSON.parse(rawBody); } catch { return Response.json({ error: "Invalid payload" }, { status: 400 }); }
  const parsed = webhookSchema.safeParse(json);
  if (!parsed.success) return Response.json({ error: "Invalid payload" }, { status: 400 });
  const event = parsed.data;
  const db = getDb();
  const [payment] = await db.select().from(cryptoPayments).where(and(eq(cryptoPayments.provider, config.provider), eq(cryptoPayments.orderId, event.order_id))).limit(1);
  if (!payment || (payment.providerPaymentId && payment.providerPaymentId !== event.payment_id)) return Response.json({ error: "Payment not found" }, { status: 404 });

  const eventRecord = {
    id: crypto.randomUUID(),
    provider: config.provider,
    providerEventId: event.event_id,
    cryptoPaymentId: payment.id,
    eventType: event.event_type,
    payloadHash: createHash("sha256").update(rawBody, "utf8").digest("hex"),
  };

  const [order] = await db.select().from(orders).where(and(eq(orders.id, payment.orderId), eq(orders.paymentMethod, "crypto"))).limit(1);
  if (!order) return Response.json({ error: "Order not found" }, { status: 404 });
  const now = new Date().toISOString();
  const currencyMatches = event.currency.toUpperCase() === payment.requestedCurrency.toUpperCase();
  const amountMatches = event.amount === payment.requestedAmount;
  if (!currencyMatches || !amountMatches) {
    const recorded = await db.transaction(async (tx) => {
      const [inserted] = await tx.insert(cryptoPaymentEvents).values(eventRecord).onConflictDoNothing().returning({ id: cryptoPaymentEvents.id });
      if (!inserted) return false;
      await tx.update(cryptoPayments).set({ providerPaymentId: event.payment_id, status: "MISMATCH", receivedAmount: event.amount, receivedCurrency: event.currency.toUpperCase(), updatedAt: now }).where(and(eq(cryptoPayments.id, payment.id), ne(cryptoPayments.status, "PAID")));
      await tx.update(orders).set({ status: "PAYMENT_PENDING", updatedAt: now }).where(and(eq(orders.id, order.id), inArray(orders.status, ["WAITING_PAYMENT", "PAYMENT_PENDING"])));
      return true;
    });
    if (!recorded) return Response.json({ ok: true, duplicate: true });
    console.error("crypto_payment_mismatch", { orderId: order.id, paymentId: payment.id });
    return Response.json({ error: "Payment details mismatch" }, { status: 409 });
  }

  if (event.status !== "confirmed" && event.status !== "paid") {
    const mappedStatus = event.status.toUpperCase();
    const terminal = ["failed", "cancelled", "expired"].includes(event.status);
    const items = terminal ? await db.select({ productId: orderItems.productId, variantId: orderItems.variantId, quantity: orderItems.quantity }).from(orderItems).where(eq(orderItems.orderId, order.id)) : [];
    const productQuantities = new Map<number, number>();
    const variantQuantities = new Map<number, number>();
    for (const item of items) {
      productQuantities.set(item.productId, (productQuantities.get(item.productId) ?? 0) + item.quantity);
      if (item.variantId !== null) variantQuantities.set(item.variantId, (variantQuantities.get(item.variantId) ?? 0) + item.quantity);
    }
    const recorded = await db.transaction(async (tx) => {
      const [inserted] = await tx.insert(cryptoPaymentEvents).values(eventRecord).onConflictDoNothing().returning({ id: cryptoPaymentEvents.id });
      if (!inserted) return false;
      const paymentStatusCondition = terminal
        ? and(eq(cryptoPayments.id, payment.id), ne(cryptoPayments.status, "PAID"))
        : and(eq(cryptoPayments.id, payment.id), inArray(cryptoPayments.status, ["CREATING", "PENDING"]));
      await tx.update(cryptoPayments).set({ providerPaymentId: event.payment_id, status: mappedStatus, receivedAmount: event.amount, receivedCurrency: event.currency.toUpperCase(), updatedAt: now }).where(paymentStatusCondition);
      if (terminal) {
        const [released] = await tx.update(orders).set({ status: "FAILED", inventoryReserved: false, updatedAt: now }).where(and(eq(orders.id, order.id), eq(orders.inventoryReserved, true), inArray(orders.status, ["WAITING_PAYMENT", "PAYMENT_PENDING"]))).returning({ id: orders.id });
        if (released) {
          for (const [productId, quantity] of productQuantities) await tx.update(catalogProducts).set({ stockQuantity: sql`CASE WHEN ${catalogProducts.stockQuantity} IS NULL THEN NULL ELSE ${catalogProducts.stockQuantity} + ${quantity} END`, available: true, availabilityStatus: sql`CASE WHEN ${catalogProducts.availabilityStatus} = 'OUT_OF_STOCK' THEN 'IN_STOCK' ELSE ${catalogProducts.availabilityStatus} END`, updatedAt: now }).where(eq(catalogProducts.id, productId));
          for (const [variantId, quantity] of variantQuantities) await tx.update(productVariants).set({ stockQuantity: sql`CASE WHEN ${productVariants.stockQuantity} IS NULL THEN NULL ELSE ${productVariants.stockQuantity} + ${quantity} END`, available: true, availabilityStatus: sql`CASE WHEN ${productVariants.availabilityStatus} = 'OUT_OF_STOCK' THEN 'IN_STOCK' ELSE ${productVariants.availabilityStatus} END`, updatedAt: now }).where(eq(productVariants.id, variantId));
        }
      } else await tx.update(orders).set({ status: "PAYMENT_PENDING", updatedAt: now }).where(and(eq(orders.id, order.id), inArray(orders.status, ["WAITING_PAYMENT", "PAYMENT_PENDING"])));
      return true;
    });
    if (!recorded) return Response.json({ ok: true, duplicate: true });
    return Response.json({ ok: true, status: mappedStatus });
  }
  if (!event.transaction_id || !event.paid_at) return Response.json({ error: "Missing payment confirmation" }, { status: 400 });

  const paidAt = new Date(event.paid_at).toISOString();
  const result = await db.transaction(async (tx) => {
    const [inserted] = await tx.insert(cryptoPaymentEvents).values(eventRecord).onConflictDoNothing().returning({ id: cryptoPaymentEvents.id });
    if (!inserted) return { duplicate: true, changed: false, reviewRequired: false };
    const [updated] = await tx.update(orders).set({ status: "PAID", updatedAt: now }).where(and(eq(orders.id, order.id), inArray(orders.status, ["WAITING_PAYMENT", "PAYMENT_PENDING"]))).returning({ id: orders.id });
    const paymentStatus = updated || order.status === "PAID" ? "PAID" : "REVIEW_REQUIRED";
    await tx.update(cryptoPayments).set({ providerPaymentId: event.payment_id, status: paymentStatus, receivedAmount: event.amount, receivedCurrency: event.currency.toUpperCase(), transactionId: event.transaction_id, paidAt, updatedAt: now }).where(eq(cryptoPayments.id, payment.id));
    return { duplicate: false, changed: Boolean(updated), reviewRequired: paymentStatus === "REVIEW_REQUIRED" };
  });
  if (result.duplicate) return Response.json({ ok: true, duplicate: true });
  if (result.changed) {
    await Promise.allSettled([sendOrderAnalytics(order.id, "PAID"), notifyPaymentConfirmed(order)]);
  }
  if (result.reviewRequired) {
    console.error("crypto_payment_confirmation_requires_review", { orderId: order.id, paymentId: payment.id, orderStatus: order.status });
    await notifyManagers(`Криптоплатёж требует ручной проверки\nЗаказ: ${order.orderNumber}\nТекущий статус заказа: ${order.status}\nТранзакция сохранена, но заказ автоматически не переведён в PAID.`, order.orderNumber);
  }
  return Response.json({ ok: true, status: result.changed || order.status === "PAID" ? "PAID" : order.status });
}
