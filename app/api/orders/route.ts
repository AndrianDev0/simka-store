import { and, eq, gte, inArray, notInArray, sql } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db";
import { catalogProducts, cryptoPayments, orderItems, orders, productVariants, promoCodes } from "@/db/schema";
import { getCatalogProducts } from "@/lib/catalog-repository";
import { createCryptoPayment, getCryptoPaymentConfig, getPaymentSiteOrigin } from "@/lib/crypto-payments";
import { escapeHtml, sendTransactionalEmail } from "@/lib/email";
import { getEmailValidationError } from "@/lib/email-validation";
import { getCurrentAccount } from "@/lib/customer-auth";
import { releaseReservedInventory } from "@/lib/order-inventory";
import { recordOperationalEvent } from "@/lib/operational-events";
import { evaluatePromoCode, isValidPromoCodeFormat, normalizePromoCode } from "@/lib/promo-codes";
import { consumeRateLimit, tooManyRequests } from "@/lib/rate-limit";
import { resolveTelegramRole, telegramRoleCan } from "@/lib/telegram-rbac";
import { partnerCodeFromRequest } from "@/lib/partner-attribution";

const payloadSchema = z.object({
  requestId: z.string().uuid(),
  customerName: z.string().trim().min(2).max(100),
  customerEmail: z.string().trim().max(254).refine((value) => !getEmailValidationError(value), { message: "Проверьте email: адрес выглядит неверным" }),
  customerContact: z.string().trim().max(100).default(""),
  deliveryAddress: z.string().trim().max(500).optional(),
  customerComment: z.string().trim().max(1000).default(""),
  paymentMethod: z.enum(["crypto", "manager"]),
  promoCode: z.string().trim().max(32).optional(),
  analytics: z.object({
    source: z.string().trim().max(200).optional(),
    medium: z.string().trim().max(200).optional(),
    campaign: z.string().trim().max(200).optional(),
    content: z.string().trim().max(200).optional(),
    term: z.string().trim().max(200).optional(),
  }).optional(),
  items: z.array(z.object({ productId: z.number().int().positive(), variantId: z.number().int().positive().optional(), quantity: z.number().int().min(1).max(20) })).min(1).max(30),
  deliverySelections: z.array(z.object({ productId: z.number().int().positive(), optionId: z.string().trim().min(1).max(80) })).max(30).default([]),
}).strict();

class PromoCodeError extends Error {}

function orderNumber() {
  const date = new Date().toISOString().slice(0, 10).replaceAll("-", "");
  return `SIM-${date}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
}

function analyticsClientId(request: Request) {
  const cookie = request.headers.get("cookie")?.split(";").map((part) => part.trim()).find((part) => part.startsWith("_ga="))?.slice(4);
  if (!cookie) return null;
  const match = decodeURIComponent(cookie).match(/^GA\d+\.\d+\.(\d+\.\d+)$/);
  return match?.[1] ?? null;
}

function isAllowedOrigin(request: Request, origin: string) {
  try {
    const originUrl = new URL(origin);
    const requestUrl = new URL(request.url);
    if (originUrl.origin === requestUrl.origin) return true;

    const forwardedHost = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
    const host = (forwardedHost || request.headers.get("host") || "").toLowerCase();
    const forwardedProto = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
    const protocol = (forwardedProto || requestUrl.protocol.slice(0, -1)).toLowerCase();

    return Boolean(host) && originUrl.host.toLowerCase() === host && originUrl.protocol.toLowerCase() === `${protocol}:`;
  } catch {
    return false;
  }
}

async function notifyManagers(order: {
  orderNumber: string;
  customerName: string;
  customerEmail: string;
  customerContact: string;
  paymentMethod: "crypto" | "manager";
  totalAmount: number;
  promoCode?: string;
  partnerCode?: string;
  discountAmount: number;
  deliveryAmount: number;
  deliveryAddress?: string;
  deliveryMethods: string[];
  hasPendingDeliveryCost: boolean;
  currency: string;
  analyticsSource?: string;
  analyticsMedium?: string;
  analyticsCampaign?: string;
  items: Array<{ productName: string; quantity: number }>;
  checkoutUrl?: string;
}) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const adminIdsValue = process.env.TELEGRAM_ADMIN_IDS ?? "";
  const adminIds = adminIdsValue.split(",").map((id) => id.trim()).filter((id) => {
    const role = resolveTelegramRole(id, adminIdsValue, process.env.TELEGRAM_ADMIN_ROLES);
    return Boolean(role && telegramRoleCan(role, "orders.read"));
  });
  if (!token || !adminIds.length) return false;
  const paymentLabel = order.paymentMethod === "manager" ? "через менеджера" : "криптовалюта (ожидает провайдера)";
  const lines = order.items.map((item) => `• ${item.productName} × ${item.quantity}`).join("\n");
  const text = [
    "Новый заказ SIMKA",
    `№ ${order.orderNumber}`,
    `Клиент: ${order.customerName}`,
    `Email: ${order.customerEmail}`,
    order.customerContact ? `Контакт: ${order.customerContact}` : "",
    `Оплата: ${paymentLabel}`,
    `Сумма: ${order.totalAmount.toLocaleString("ru-RU")} ${order.currency}`,
    order.promoCode ? `Промокод: ${order.promoCode} · скидка ${order.discountAmount.toLocaleString("ru-RU")} ${order.currency}` : "",
    order.partnerCode ? `Partner ID: ${order.partnerCode}` : "",
    order.deliveryAmount ? `Доставка: ${order.deliveryAmount.toLocaleString("ru-RU")} ${order.currency}` : "",
    order.deliveryAddress ? `Адрес: ${order.deliveryAddress}` : "",
    order.deliveryMethods.length ? `Способ доставки: ${order.deliveryMethods.join(", ")}` : "",
    order.hasPendingDeliveryCost ? "Стоимость доставки ещё должен подтвердить менеджер до отправки реквизитов." : "",
    order.analyticsSource ? `Источник: ${order.analyticsSource}${order.analyticsMedium ? ` / ${order.analyticsMedium}` : ""}${order.analyticsCampaign ? ` · ${order.analyticsCampaign}` : ""}` : "",
    "",
    lines,
    "",
    order.paymentMethod === "manager"
      ? `Отправьте актуальные реквизиты на email ${order.customerEmail} и подтвердите оплату только после фактического поступления средств.`
      : "Оплату подтвердит только защищённый webhook платёжного провайдера. Вручную подтверждать криптоплатёж нельзя.",
  ].filter(Boolean).join("\n");
  const telegramUsername = order.customerContact.match(/^@([a-zA-Z0-9_]{5,32})$/)?.[1];
  const keyboard = [
    ...(telegramUsername ? [[{ text: "💬 Связаться с клиентом", url: `https://t.me/${telegramUsername}` }]] : []),
    [{ text: "📄 Открыть заказ", callback_data: `order:view:${order.orderNumber}` }],
    [{ text: "🛒 Открыть заказы", callback_data: "orders:list" }],
  ];
  await Promise.all(adminIds.map(async (chatId) => {
    const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text, reply_markup: { inline_keyboard: keyboard } }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error("TELEGRAM_NOTIFY_FAILED");
  }));
  return true;
}

async function notifyCustomer(order: {
  orderNumber: string;
  customerName: string;
  customerEmail: string;
  paymentMethod: "crypto" | "manager";
  totalAmount: number;
  promoCode?: string;
  discountAmount: number;
  deliveryAmount: number;
  hasPendingDeliveryCost: boolean;
  currency: string;
  items: Array<{ productName: string; quantity: number }>;
  checkoutUrl?: string;
}) {
  const amount = `${order.totalAmount.toLocaleString("ru-RU")} ${order.currency}`;
  const lines = order.items.map((item) => `• ${item.productName} × ${item.quantity}`).join("\n");
  const safeName = escapeHtml(order.customerName);
  const safeNumber = escapeHtml(order.orderNumber);
  const safeAmount = escapeHtml(amount);
  const safeLines = order.items.map((item) => `<li>${escapeHtml(item.productName)} × ${item.quantity}</li>`).join("");
  const paymentText = order.paymentMethod === "manager"
    ? "Менеджер отправит актуальные реквизиты отдельным письмом на этот email. Не оплачивайте по реквизитам из посторонних сообщений."
    : "Перейдите на защищённую страницу платёжного провайдера по ссылке ниже. Возврат на сайт сам по себе не подтверждает оплату — подтверждение поступит серверу от провайдера.";
  const paymentLinkText = order.paymentMethod === "crypto" && order.checkoutUrl ? `\nСтраница оплаты: ${order.checkoutUrl}` : "";
  const paymentLinkHtml = order.paymentMethod === "crypto" && order.checkoutUrl ? `<p><a href="${escapeHtml(order.checkoutUrl)}">Перейти к оплате</a></p>` : "";
  return sendTransactionalEmail({
    to: order.customerEmail,
    subject: `Заказ ${order.orderNumber} создан — SIMKA`,
    text: `Здравствуйте, ${order.customerName}!\n\nЗаказ ${order.orderNumber} создан.\n${order.hasPendingDeliveryCost ? "Промежуточная сумма" : "Сумма"}: ${amount}${order.promoCode ? `\nПромокод: ${order.promoCode}\nСкидка: ${order.discountAmount.toLocaleString("ru-RU")} ${order.currency}` : ""}${order.deliveryAmount ? `\nВ том числе доставка: ${order.deliveryAmount.toLocaleString("ru-RU")} ${order.currency}` : ""}${order.hasPendingDeliveryCost ? "\nМенеджер сначала подтвердит стоимость доставки, затем отправит итоговую сумму и реквизиты." : ""}\n\n${lines}\n\n${paymentText}${paymentLinkText}\n\nСохраните номер заказа для обращения в поддержку.`,
    html: `<div style="font-family:Arial,sans-serif;line-height:1.6;color:#10213a"><h1 style="font-size:24px">Заказ создан</h1><p>Здравствуйте, ${safeName}!</p><p>Номер заказа: <strong>${safeNumber}</strong><br>${order.hasPendingDeliveryCost ? "Промежуточная сумма" : "Сумма"}: <strong>${safeAmount}</strong>${order.promoCode ? `<br>Промокод: <strong>${escapeHtml(order.promoCode)}</strong><br>Скидка: <strong>${escapeHtml(`${order.discountAmount.toLocaleString("ru-RU")} ${order.currency}`)}</strong>` : ""}${order.deliveryAmount ? `<br>В том числе доставка: <strong>${escapeHtml(`${order.deliveryAmount.toLocaleString("ru-RU")} ${order.currency}`)}</strong>` : ""}</p>${order.hasPendingDeliveryCost ? "<p>Менеджер сначала подтвердит стоимость доставки, затем отправит итоговую сумму и реквизиты.</p>" : ""}<ul>${safeLines}</ul><p>${escapeHtml(paymentText)}</p>${paymentLinkHtml}<p>Сохраните номер заказа для обращения в поддержку.</p></div>`,
    idempotencyKey: `order-created/${order.orderNumber}`,
  });
}

export async function POST(request: Request) {
  const contentLength = Number(request.headers.get("content-length") || 0);
  if (contentLength > 20_000) return Response.json({ error: "Слишком большой запрос" }, { status: 413 });

  const origin = request.headers.get("origin") || request.headers.get("referer");
  if (!origin || !isAllowedOrigin(request, origin)) return Response.json({ error: "Недопустимый источник запроса" }, { status: 403 });
  const rateLimit = await consumeRateLimit({ request, action: "order-create", limit: 12, windowMs: 10 * 60 * 1000 });
  if (!rateLimit.allowed) return tooManyRequests(rateLimit.retryAfterSeconds, "Слишком много заказов. Подождите и попробуйте снова.");

  let validatedRequestId: string | null = null;
  try {
    const parsed = payloadSchema.safeParse(await request.json());
    if (!parsed.success) {
      const fields = parsed.error.flatten().fieldErrors;
      return Response.json({ error: fields.customerEmail?.[0] || "Проверьте заполненные поля", fields }, { status: 400 });
    }
    validatedRequestId = parsed.data.requestId;
    const cryptoConfig = getCryptoPaymentConfig();
    if (parsed.data.paymentMethod === "crypto" && !cryptoConfig) {
      return Response.json({ error: "Криптовалютная оплата пока не подключена. Выберите оплату через менеджера." }, { status: 503 });
    }

    const db = getDb();
    // Keep guest checkout available, but link new orders to the signed-in
    // customer so the personal cabinet can show a private order history.
    const account = await getCurrentAccount();
    const attributedPartnerCode = partnerCodeFromRequest(request) ?? account?.partnerCode ?? null;
    const [existing] = await db.select({ id: orders.id, orderNumber: orders.orderNumber, paymentMethod: orders.paymentMethod, status: orders.status, totalAmount: orders.totalAmount, currency: orders.currency, promoCode: orders.promoCode, discountAmount: orders.discountAmount }).from(orders).where(eq(orders.requestId, parsed.data.requestId)).limit(1);
    if (existing) {
      const canContinueCryptoPayment = existing.paymentMethod === "crypto" && ["WAITING_PAYMENT", "PAYMENT_PENDING"].includes(existing.status);
      const [existingPayment] = canContinueCryptoPayment ? await db.select({ checkoutUrl: cryptoPayments.checkoutUrl }).from(cryptoPayments).where(eq(cryptoPayments.orderId, existing.id)).limit(1) : [];
      return Response.json({ order: { orderNumber: existing.orderNumber, paymentMethod: existing.paymentMethod, status: existing.status, totalAmount: existing.totalAmount, currency: existing.currency, promoCode: existing.promoCode, discountAmount: existing.discountAmount, checkoutUrl: existingPayment?.checkoutUrl ?? undefined, managerNotified: false, customerNotified: false } }, { status: 200, headers: { "Cache-Control": "no-store" } });
    }

    const catalog = await getCatalogProducts({ requireDatabase: true });
    const productById = new Map(catalog.map((product) => [product.id, product]));
    const requestedProductIds = [...new Set(parsed.data.items.map((line) => line.productId))];
    const [productCostRows, variantCostRows] = await Promise.all([
      db.select({ id: catalogProducts.id, unitCost: catalogProducts.unitCost }).from(catalogProducts).where(inArray(catalogProducts.id, requestedProductIds)),
      db.select({ id: productVariants.id, unitCost: productVariants.unitCost }).from(productVariants).where(inArray(productVariants.productId, requestedProductIds)),
    ]);
    const productCosts = new Map(productCostRows.map((row) => [row.id, row.unitCost]));
    const variantCosts = new Map(variantCostRows.map((row) => [row.id, row.unitCost]));
    const resolved = parsed.data.items.map((line) => {
      const product = productById.get(line.productId);
      if (!product || !product.available || product.availabilityStatus === "OUT_OF_STOCK" || product.stockQuantity === 0) throw new Error("PRODUCT_UNAVAILABLE");
      const variant = line.variantId
        ? product.variants.find((item) => item.id === line.variantId)
        : product.variants.find((item) => item.sku === product.sku && item.available && item.availabilityStatus !== "OUT_OF_STOCK" && item.stockQuantity !== 0)
          ?? product.variants.find((item) => item.available && item.availabilityStatus !== "OUT_OF_STOCK" && item.stockQuantity !== 0);
      if (line.variantId && !variant) throw new Error("PRODUCT_VARIANT_UNAVAILABLE");
      if (product.variants.length && !variant) throw new Error("PRODUCT_VARIANT_UNAVAILABLE");
      if (variant && (!variant.available || variant.availabilityStatus === "OUT_OF_STOCK" || variant.stockQuantity === 0)) throw new Error("PRODUCT_VARIANT_UNAVAILABLE");
      const unitPrice = variant?.price ?? product.price;
      const unitCost = variant ? variantCosts.get(variant.id) ?? productCosts.get(product.id) ?? null : productCosts.get(product.id) ?? null;
      return { product, variant, quantity: line.quantity, unitPrice, unitCost, currency: variant?.currency ?? product.currency, lineTotal: unitPrice * line.quantity };
    });
    const quantityByProduct = new Map<number, number>();
    const quantityByVariant = new Map<number, number>();
    for (const line of resolved) {
      quantityByProduct.set(line.product.id, (quantityByProduct.get(line.product.id) ?? 0) + line.quantity);
      if (line.variant) quantityByVariant.set(line.variant.id, (quantityByVariant.get(line.variant.id) ?? 0) + line.quantity);
    }
    for (const [productId, quantity] of quantityByProduct) {
      const product = productById.get(productId)!;
      if (product.stockQuantity !== null && quantity > product.stockQuantity) throw new Error("INSUFFICIENT_STOCK");
    }
    for (const [variantId, quantity] of quantityByVariant) {
      const variant = resolved.find((line) => line.variant?.id === variantId)?.variant;
      if (variant?.stockQuantity !== null && variant?.stockQuantity !== undefined && quantity > variant.stockQuantity) throw new Error("INSUFFICIENT_STOCK");
    }
    const currencies = new Set(resolved.map((line) => line.currency));
    if (currencies.size !== 1) throw new Error("MIXED_CURRENCY");
    const currency = resolved[0].currency;
    const esimUnitCount = resolved.filter(({ product }) => product.type === "eSIM").reduce((sum, line) => sum + line.quantity, 0);
    if (esimUnitCount > 20) throw new Error("TOO_MANY_ESIM_UNITS");
    const hasPhysicalSim = resolved.some(({ product }) => product.type === "SIM");
    if (hasPhysicalSim && !parsed.data.deliveryAddress) return Response.json({ error: "Укажите адрес доставки физической SIM" }, { status: 400 });

    const requestedDelivery = new Map<number, string>();
    for (const selection of parsed.data.deliverySelections) {
      if (requestedDelivery.has(selection.productId)) throw new Error("DELIVERY_OPTION_UNAVAILABLE");
      requestedDelivery.set(selection.productId, selection.optionId);
    }
    const deliveryByProduct = new Map<number, NonNullable<(typeof resolved)[number]["product"]["deliveryOptions"]>[number]>();
    for (const productId of new Set(resolved.filter(({ product }) => product.type === "SIM").map(({ product }) => product.id))) {
      const product = productById.get(productId)!;
      const optionId = requestedDelivery.get(productId);
      const option = optionId ? product.deliveryOptions.find((item) => item.id === optionId) : undefined;
      if (!option) throw new Error("DELIVERY_OPTION_UNAVAILABLE");
      if (option.currency !== currency) throw new Error("DELIVERY_CURRENCY_MISMATCH");
      deliveryByProduct.set(productId, option);
    }
    if (parsed.data.paymentMethod === "crypto" && [...deliveryByProduct.values()].some((option) => option.cost === null || option.regions.length > 0)) {
      throw new Error("DELIVERY_REQUIRES_MANAGER");
    }

    const id = crypto.randomUUID();
    const number = orderNumber();
    const subtotalAmount = resolved.reduce((sum, line) => sum + line.lineTotal, 0);
    const deliveryAmount = [...deliveryByProduct.values()].reduce((sum, option) => sum + (option.cost ?? 0), 0);
    let discountAmount = 0;
    let appliedPromoCode: string | null = null;
    let totalAmount = subtotalAmount + deliveryAmount;
    const status = parsed.data.paymentMethod === "manager" ? "WAITING_FOR_MANAGER" : "WAITING_PAYMENT";
    const chargedDeliveryProducts = new Set<number>();
    const itemRows = resolved.flatMap(({ product, variant, quantity, unitPrice, unitCost, lineTotal }) => {
      const delivery = deliveryByProduct.get(product.id);
      const chargeDelivery = Boolean(delivery) && !chargedDeliveryProducts.has(product.id);
      if (delivery) chargedDeliveryProducts.add(product.id);
      const baseName = variant ? `${product.name} · ${variant.name}` : product.name;
      const units = product.type === "eSIM" ? quantity : 1;
      return Array.from({ length: units }, (_, unitIndex) => ({
        id: crypto.randomUUID(), orderId: id, productId: product.id, variantId: variant?.id, sku: variant?.sku ?? product.sku,
        productName: units > 1 ? `${baseName} · eSIM ${unitIndex + 1}/${units}` : baseName, simType: product.type, unitPrice, unitCost,
        quantity: product.type === "eSIM" ? 1 : quantity, lineTotal: product.type === "eSIM" ? unitPrice : lineTotal,
        fulfillmentStatus: "PENDING", deliveryMethod: delivery?.label ?? (product.type === "eSIM" ? product.esimDeliveryMethod || "email" : null),
        deliveryCost: chargeDelivery && unitIndex === 0 ? delivery?.cost ?? 0 : 0,
        deliveryCostConfirmed: product.type === "eSIM" || !chargeDelivery || unitIndex > 0 || (delivery?.cost !== null && delivery?.regions.length === 0),
      }));
    });
    await db.transaction(async (tx) => {
      if (parsed.data.promoCode) {
        if (!isValidPromoCodeFormat(parsed.data.promoCode)) throw new PromoCodeError("Проверьте промокод");
        const code = normalizePromoCode(parsed.data.promoCode);
        const [promo] = await tx.select().from(promoCodes).where(eq(promoCodes.code, code)).for("update").limit(1);
        if (!promo) throw new PromoCodeError("Промокод не найден");
        const [usage] = await tx.select({ count: sql<number>`count(*)::int` }).from(orders)
          .where(and(eq(orders.promoCode, code), notInArray(orders.status, ["CANCELLED", "REFUNDED", "FAILED"])));
        const promoResult = evaluatePromoCode(promo, { subtotalAmount, currency, usedCount: usage?.count ?? 0 });
        if (!promoResult.valid) throw new PromoCodeError(promoResult.error);
        appliedPromoCode = promoResult.code;
        discountAmount = promoResult.discountAmount;
        totalAmount = subtotalAmount - discountAmount + deliveryAmount;
      }
      for (const [productId, quantity] of quantityByProduct) {
        const product = productById.get(productId)!;
        if (product.stockQuantity === null) continue;
        const updated = await tx.update(catalogProducts).set({
          stockQuantity: sql`${catalogProducts.stockQuantity} - ${quantity}`,
          available: sql`CASE WHEN ${catalogProducts.stockQuantity} - ${quantity} = 0 THEN FALSE ELSE ${catalogProducts.available} END`,
          availabilityStatus: sql`CASE WHEN ${catalogProducts.stockQuantity} - ${quantity} = 0 THEN 'OUT_OF_STOCK' ELSE ${catalogProducts.availabilityStatus} END`,
          updatedAt: new Date().toISOString(),
        }).where(and(eq(catalogProducts.id, productId), gte(catalogProducts.stockQuantity, quantity))).returning({ id: catalogProducts.id });
        if (!updated[0]) throw new Error("INSUFFICIENT_STOCK");
      }
      for (const [variantId, quantity] of quantityByVariant) {
        const variant = resolved.find((line) => line.variant?.id === variantId)?.variant;
        if (!variant || variant.stockQuantity === null) continue;
        const updated = await tx.update(productVariants).set({
          stockQuantity: sql`${productVariants.stockQuantity} - ${quantity}`,
          available: sql`CASE WHEN ${productVariants.stockQuantity} - ${quantity} = 0 THEN FALSE ELSE ${productVariants.available} END`,
          availabilityStatus: sql`CASE WHEN ${productVariants.stockQuantity} - ${quantity} = 0 THEN 'OUT_OF_STOCK' ELSE ${productVariants.availabilityStatus} END`,
          updatedAt: new Date().toISOString(),
        }).where(and(eq(productVariants.id, variantId), gte(productVariants.stockQuantity, quantity))).returning({ id: productVariants.id });
        if (!updated[0]) throw new Error("INSUFFICIENT_STOCK");
      }
      await tx.insert(orders).values({ id, requestId: parsed.data.requestId, orderNumber: number, customerAccountId: account?.id ?? null, customerName: parsed.data.customerName, customerEmail: parsed.data.customerEmail.toLowerCase(), customerContact: parsed.data.customerContact, deliveryAddress: parsed.data.deliveryAddress, customerComment: parsed.data.customerComment, paymentMethod: parsed.data.paymentMethod, status, subtotalAmount, promoCode: appliedPromoCode, partnerCode: attributedPartnerCode, discountAmount, deliveryAmount, totalAmount, currency, inventoryReserved: true, analyticsClientId: analyticsClientId(request), analyticsSource: parsed.data.analytics?.source || null, analyticsMedium: parsed.data.analytics?.medium || null, analyticsCampaign: parsed.data.analytics?.campaign || null, analyticsContent: parsed.data.analytics?.content || null, analyticsTerm: parsed.data.analytics?.term || null });
      await tx.insert(orderItems).values(itemRows);
      if (parsed.data.paymentMethod === "crypto" && cryptoConfig) {
        await tx.insert(cryptoPayments).values({ id: crypto.randomUUID(), orderId: id, provider: cryptoConfig.provider, requestedAmount: totalAmount, requestedCurrency: currency.toUpperCase() });
      }
    });
    let checkoutUrl: string | undefined;
    if (parsed.data.paymentMethod === "crypto" && cryptoConfig) {
      let createdPayment;
      try {
        createdPayment = await createCryptoPayment({ config: cryptoConfig, orderId: id, orderNumber: number, amount: totalAmount, currency: currency.toUpperCase(), requestId: parsed.data.requestId, siteOrigin: getPaymentSiteOrigin() });
      } catch (providerError) {
        await db.update(cryptoPayments).set({ status: "CREATE_FAILED", updatedAt: new Date().toISOString() }).where(eq(cryptoPayments.orderId, id));
        await releaseReservedInventory(id, "FAILED", ["WAITING_PAYMENT"]);
        console.error("crypto_payment_creation_failed", { name: providerError instanceof Error ? providerError.name : "UnknownError" });
        await recordOperationalEvent({ kind: "payment_error", severity: "critical", area: "checkout", path: "/api/orders", code: "crypto_payment_creation_failed" });
        throw new Error("CRYPTO_PAYMENT_CREATION_FAILED");
      }
      checkoutUrl = createdPayment.checkoutUrl;
      await db.update(cryptoPayments).set({ providerPaymentId: createdPayment.providerPaymentId, status: "PENDING", checkoutUrl, updatedAt: new Date().toISOString() }).where(eq(cryptoPayments.orderId, id));
    }
    let managerNotified = false;
    let customerNotified = false;
    const notificationPayload = {
        orderNumber: number,
        customerName: parsed.data.customerName,
        customerEmail: parsed.data.customerEmail.toLowerCase(),
        customerContact: parsed.data.customerContact,
        paymentMethod: parsed.data.paymentMethod,
        totalAmount,
        promoCode: appliedPromoCode ?? undefined,
        partnerCode: attributedPartnerCode ?? undefined,
        discountAmount,
        deliveryAmount,
        deliveryAddress: parsed.data.deliveryAddress,
        deliveryMethods: [...deliveryByProduct.values()].map((option) => option.label),
        hasPendingDeliveryCost: [...deliveryByProduct.values()].some((option) => option.cost === null || option.regions.length > 0),
        currency,
        analyticsSource: parsed.data.analytics?.source,
        analyticsMedium: parsed.data.analytics?.medium,
        analyticsCampaign: parsed.data.analytics?.campaign,
        items: resolved.map(({ product, variant, quantity }) => ({ productName: variant ? `${product.name} · ${variant.name}` : product.name, quantity })),
        checkoutUrl,
      };
    const [managerResult, customerResult] = await Promise.allSettled([notifyManagers(notificationPayload), notifyCustomer(notificationPayload)]);
    if (managerResult.status === "fulfilled") managerNotified = managerResult.value;
    else {
      console.error("order_manager_notification_failed", { name: managerResult.reason instanceof Error ? managerResult.reason.name : "UnknownError" });
      await recordOperationalEvent({ kind: "notification_error", severity: "error", area: "telegram", path: "/api/orders", code: "manager_notification_failed" });
    }
    if (customerResult.status === "fulfilled") customerNotified = customerResult.value.delivered;
    else {
      console.error("order_customer_notification_failed", { name: customerResult.reason instanceof Error ? customerResult.reason.name : "UnknownError" });
      await recordOperationalEvent({ kind: "notification_error", severity: "error", area: "email", path: "/api/orders", code: "customer_notification_failed" });
    }
    return Response.json({ order: { orderNumber: number, paymentMethod: parsed.data.paymentMethod, status, totalAmount, currency, promoCode: appliedPromoCode, discountAmount, checkoutUrl, managerNotified, customerNotified } }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const errorCode = typeof error === "object" && error !== null && "code" in error ? String(error.code) : null;
    if (errorCode === "23505" && validatedRequestId) {
      try {
        const db = getDb();
        const [existing] = await db.select({ orderNumber: orders.orderNumber, status: orders.status, totalAmount: orders.totalAmount, currency: orders.currency, promoCode: orders.promoCode, discountAmount: orders.discountAmount }).from(orders).where(eq(orders.requestId, validatedRequestId)).limit(1);
        if (existing) return Response.json({ order: { ...existing, managerNotified: false, customerNotified: false } }, { status: 200, headers: { "Cache-Control": "no-store" } });
      } catch (lookupError) {
        console.error("duplicate_order_lookup_failed", { name: lookupError instanceof Error ? lookupError.name : "UnknownError" });
      }
    }
    if (error instanceof SyntaxError) return Response.json({ error: "Некорректный формат запроса" }, { status: 400 });
    if (error instanceof Error && error.message === "PRODUCT_UNAVAILABLE") return Response.json({ error: "Один из тарифов больше недоступен" }, { status: 409 });
    if (error instanceof Error && error.message === "PRODUCT_VARIANT_UNAVAILABLE") return Response.json({ error: "Выбранный вариант тарифа больше недоступен" }, { status: 409 });
    if (error instanceof Error && error.message === "INSUFFICIENT_STOCK") return Response.json({ error: "Выбранное количество превышает остаток" }, { status: 409 });
    if (error instanceof Error && error.message === "MIXED_CURRENCY") return Response.json({ error: "Оформите товары в разных валютах отдельными заказами" }, { status: 409 });
    if (error instanceof Error && error.message === "TOO_MANY_ESIM_UNITS") return Response.json({ error: "В одном заказе можно оформить не более 20 eSIM" }, { status: 409 });
    if (error instanceof Error && error.message === "DELIVERY_OPTION_UNAVAILABLE") return Response.json({ error: "Выберите доступный способ доставки для каждой физической SIM" }, { status: 409 });
    if (error instanceof Error && error.message === "DELIVERY_CURRENCY_MISMATCH") return Response.json({ error: "Способ доставки указан в другой валюте. Оформите заказ отдельно." }, { status: 409 });
    if (error instanceof Error && error.message === "DELIVERY_REQUIRES_MANAGER") return Response.json({ error: "Эту доставку должен подтвердить менеджер. Выберите оплату через менеджера." }, { status: 409 });
    if (error instanceof PromoCodeError) return Response.json({ error: error.message }, { status: 409 });
    if (error instanceof Error && error.message === "CRYPTO_PAYMENT_CREATION_FAILED") return Response.json({ error: "Платёжный провайдер временно недоступен. Заказ не оплачен." }, { status: 502 });
    console.error("order_creation_failed", { name: error instanceof Error ? error.name : "UnknownError" });
    await recordOperationalEvent({ kind: "api_error", severity: "critical", area: "checkout", path: "/api/orders", code: "order_creation_failed" });
    return Response.json({ error: "Не удалось создать заказ. Попробуйте ещё раз." }, { status: 500 });
  }
}
