import { and, asc, eq, inArray, isNull, or } from "drizzle-orm";
import { getDb } from "@/db";
import { analyticsEvents, analyticsSessions, analyticsVisitors, cryptoPayments, customerAccounts, customerSessions, orderItems, orders, privacyConsentEvents } from "@/db/schema";
import { collectAccountAnalyticsClientIds, exclusivelyOwnedAnalyticsClientIds } from "@/lib/account-data-export";
import { getCurrentAccount } from "@/lib/customer-auth";
import { consumeRateLimit, tooManyRequests } from "@/lib/rate-limit";

export const runtime = "nodejs";

function omitOrderId<T extends { orderId: string }>({ orderId, ...value }: T) {
  void orderId;
  return value;
}

export async function GET(request: Request) {
  const rateLimit = await consumeRateLimit({ request, action: "account-data-export", limit: 5, windowMs: 60 * 60 * 1000 });
  if (!rateLimit.allowed) return tooManyRequests(rateLimit.retryAfterSeconds);

  const account = await getCurrentAccount();
  if (!account) return Response.json({ error: "Требуется вход в личный кабинет" }, { status: 401, headers: { "Cache-Control": "no-store" } });

  const db = getDb();
  const [profile] = await db.select({
    id: customerAccounts.id,
    email: customerAccounts.email,
    name: customerAccounts.name,
    contact: customerAccounts.contact,
    partnerCode: customerAccounts.partnerCode,
    createdAt: customerAccounts.createdAt,
    updatedAt: customerAccounts.updatedAt,
  }).from(customerAccounts).where(eq(customerAccounts.id, account.id)).limit(1);
  if (!profile) return Response.json({ error: "Аккаунт не найден" }, { status: 404, headers: { "Cache-Control": "no-store" } });

  const accountOrders = await db.select({
    id: orders.id,
    orderNumber: orders.orderNumber,
    customerName: orders.customerName,
    customerEmail: orders.customerEmail,
    customerContact: orders.customerContact,
    deliveryAddress: orders.deliveryAddress,
    customerComment: orders.customerComment,
    paymentMethod: orders.paymentMethod,
    status: orders.status,
    subtotalAmount: orders.subtotalAmount,
    promoCode: orders.promoCode,
    partnerCode: orders.partnerCode,
    discountAmount: orders.discountAmount,
    deliveryAmount: orders.deliveryAmount,
    totalAmount: orders.totalAmount,
    currency: orders.currency,
    analyticsClientId: orders.analyticsClientId,
    firstPartyClientId: orders.firstPartyClientId,
    analyticsSource: orders.analyticsSource,
    analyticsMedium: orders.analyticsMedium,
    analyticsCampaign: orders.analyticsCampaign,
    analyticsContent: orders.analyticsContent,
    analyticsTerm: orders.analyticsTerm,
    createdAt: orders.createdAt,
    paidAt: orders.paidAt,
    updatedAt: orders.updatedAt,
  }).from(orders).where(eq(orders.customerAccountId, account.id)).orderBy(asc(orders.createdAt));
  const orderIds = accountOrders.map((order) => order.id);
  const items = orderIds.length ? await db.select({
    orderId: orderItems.orderId,
    sku: orderItems.sku,
    productName: orderItems.productName,
    simType: orderItems.simType,
    unitPrice: orderItems.unitPrice,
    quantity: orderItems.quantity,
    lineTotal: orderItems.lineTotal,
    fulfillmentStatus: orderItems.fulfillmentStatus,
    deliveryMethod: orderItems.deliveryMethod,
    trackingNumber: orderItems.trackingNumber,
    trackingUrl: orderItems.trackingUrl,
    fulfillmentInstructions: orderItems.fulfillmentInstructions,
    fulfilledAt: orderItems.fulfilledAt,
  }).from(orderItems).where(inArray(orderItems.orderId, orderIds)) : [];
  const payments = orderIds.length ? await db.select({
    orderId: cryptoPayments.orderId,
    provider: cryptoPayments.provider,
    status: cryptoPayments.status,
    requestedAmount: cryptoPayments.requestedAmount,
    requestedCurrency: cryptoPayments.requestedCurrency,
    receivedAmount: cryptoPayments.receivedAmount,
    receivedCurrency: cryptoPayments.receivedCurrency,
    transactionId: cryptoPayments.transactionId,
    paidAt: cryptoPayments.paidAt,
    createdAt: cryptoPayments.createdAt,
  }).from(cryptoPayments).where(inArray(cryptoPayments.orderId, orderIds)) : [];
  const sessions = await db.select({ createdAt: customerSessions.createdAt, lastUsedAt: customerSessions.lastUsedAt, expiresAt: customerSessions.expiresAt })
    .from(customerSessions).where(eq(customerSessions.accountId, account.id)).orderBy(asc(customerSessions.createdAt));
  const { consentHistory, analyticsVisitorRows, analyticsSessionRows, analyticsEventRows } = await db.transaction(async (tx) => {
    const consentHistory = await tx.select({
      consentId: privacyConsentEvents.consentId,
      decision: privacyConsentEvents.decision,
      source: privacyConsentEvents.source,
      policyVersion: privacyConsentEvents.policyVersion,
      createdAt: privacyConsentEvents.createdAt,
    }).from(privacyConsentEvents).where(eq(privacyConsentEvents.accountId, account.id)).orderBy(asc(privacyConsentEvents.createdAt));
    const [ownedVisitors, ownedEvents] = await Promise.all([
      tx.select({ clientId: analyticsVisitors.clientId }).from(analyticsVisitors).where(eq(analyticsVisitors.accountId, account.id)),
      tx.selectDistinct({ clientId: analyticsEvents.clientId }).from(analyticsEvents).where(eq(analyticsEvents.accountId, account.id)),
    ]);
    const candidateClientIds = [...new Set([
      ...collectAccountAnalyticsClientIds(ownedVisitors, consentHistory, accountOrders),
      ...ownedEvents.map((event) => event.clientId),
    ])];
    const [foreignVisitors, foreignEvents, foreignConsents, foreignOrders] = candidateClientIds.length
      ? await Promise.all([
        tx.select({ clientId: analyticsVisitors.clientId, accountId: analyticsVisitors.accountId }).from(analyticsVisitors)
          .where(inArray(analyticsVisitors.clientId, candidateClientIds)),
        tx.selectDistinct({ clientId: analyticsEvents.clientId, accountId: analyticsEvents.accountId }).from(analyticsEvents)
          .where(inArray(analyticsEvents.clientId, candidateClientIds)),
        tx.selectDistinct({ clientId: privacyConsentEvents.consentId, accountId: privacyConsentEvents.accountId }).from(privacyConsentEvents)
          .where(inArray(privacyConsentEvents.consentId, candidateClientIds)),
        tx.selectDistinct({ clientId: orders.firstPartyClientId, accountId: orders.customerAccountId }).from(orders)
          .where(inArray(orders.firstPartyClientId, candidateClientIds)),
      ])
      : [[], [], [], []];
    const analyticsClientIds = exclusivelyOwnedAnalyticsClientIds(account.id, candidateClientIds, [
      ...foreignVisitors, ...foreignEvents, ...foreignConsents,
      ...foreignOrders.filter((order): order is { clientId: string; accountId: string | null } => order.clientId !== null),
    ]);
    const analyticsVisitorRows = analyticsClientIds.length
      ? await tx.select().from(analyticsVisitors).where(inArray(analyticsVisitors.clientId, analyticsClientIds)).orderBy(asc(analyticsVisitors.firstSeenAt))
      : [];
    const analyticsSessionRows = analyticsClientIds.length
      ? await tx.select().from(analyticsSessions).where(inArray(analyticsSessions.clientId, analyticsClientIds)).orderBy(asc(analyticsSessions.startedAt))
      : [];
    const analyticsEventRows = await tx.select({
      id: analyticsEvents.id, sessionId: analyticsEvents.sessionId, clientId: analyticsEvents.clientId,
      name: analyticsEvents.name, path: analyticsEvents.path, params: analyticsEvents.params,
      occurredAt: analyticsEvents.occurredAt,
    }).from(analyticsEvents).where(analyticsClientIds.length
      ? or(eq(analyticsEvents.accountId, account.id), and(isNull(analyticsEvents.accountId), inArray(analyticsEvents.clientId, analyticsClientIds)))
      : eq(analyticsEvents.accountId, account.id)).orderBy(asc(analyticsEvents.occurredAt));
    return { consentHistory, analyticsVisitorRows, analyticsSessionRows, analyticsEventRows };
  }, { isolationLevel: "repeatable read", accessMode: "read only" });

  const payload = {
    exportedAt: new Date().toISOString(),
    profile,
    sessions,
    consentHistory,
    analytics: { visitors: analyticsVisitorRows, sessions: analyticsSessionRows, events: analyticsEventRows },
    orders: accountOrders.map(({ id, ...order }) => {
      const payment = payments.find((item) => item.orderId === id);
      return {
        ...order,
        items: items.filter((item) => item.orderId === id).map(omitOrderId),
        payment: payment ? omitOrderId(payment) : null,
      };
    }),
  };

  return new Response(JSON.stringify(payload, null, 2), {
    headers: {
      "Cache-Control": "private, no-store, max-age=0",
      "Content-Disposition": "attachment; filename=simka-personal-data.json",
      "Content-Type": "application/json; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
