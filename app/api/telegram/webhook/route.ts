import { and, asc, desc, eq, gte, inArray, isNull, like, sql } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db";
import { adminAuditLog, catalogProducts, categories, orderItems, orders, productCategories, productVariants, storeSettings } from "@/db/schema";
import { escapeHtml, sendTransactionalEmail } from "@/lib/email";
import { decryptFulfillmentSecret, encryptFulfillmentSecret } from "@/lib/fulfillment-secrets";
import { recordSlugRedirect } from "@/lib/slug-redirects";
import { sendOrderAnalytics } from "@/lib/server-analytics";
import { handleCatalogAdminCallback, handleCatalogAdminMessage } from "@/lib/telegram-catalog-admin";

const updateSchema = z.object({
  update_id: z.number().int(),
  message: z.object({
    message_id: z.number().int(),
    text: z.string().max(4096).optional(),
    chat: z.object({ id: z.number().int() }),
    from: z.object({ id: z.number().int() }).optional(),
    reply_to_message: z.object({ text: z.string().max(4096).optional() }).optional(),
  }).optional(),
  callback_query: z.object({
    id: z.string(),
    data: z.string().max(128).optional(),
    from: z.object({ id: z.number().int() }),
    message: z.object({ chat: z.object({ id: z.number().int() }) }).optional(),
  }).optional(),
}).passthrough();

type BotEnvironment = {
  TELEGRAM_BOT_TOKEN?: string;
  TELEGRAM_WEBHOOK_SECRET?: string;
  TELEGRAM_ADMIN_IDS?: string;
};

async function reportOrderAnalytics(orderId: string, status: "PAID" | "CANCELLED" | "REFUNDED") {
  try {
    await sendOrderAnalytics(orderId, status);
  } catch (error) {
    console.error("order_analytics_failed", { status, name: error instanceof Error ? error.name : "UnknownError" });
  }
}

function safeEqual(left: string, right: string) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return difference === 0;
}

type InlineButton = { text: string; callback_data?: string; url?: string };
type InlineKeyboard = { inline_keyboard: Array<Array<InlineButton>> };
type ReplyKeyboard = {
  keyboard: Array<Array<{ text: string }>>;
  resize_keyboard?: boolean;
  is_persistent?: boolean;
  one_time_keyboard?: boolean;
  selective?: boolean;
};
type ReplyMarkup = InlineKeyboard | ReplyKeyboard | { force_reply: true; selective: true; input_field_placeholder?: string };
const PAYMENT_REQUISITES_KEY = "manager_payment_requisites";

async function sendMessage(token: string, chatId: number, text: string, replyMarkup?: ReplyMarkup) {
  const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, ...(replyMarkup ? { reply_markup: replyMarkup } : {}) }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error("TELEGRAM_SEND_FAILED");
}

async function answerCallback(token: string, callbackId: string) {
  await fetch(`https://api.telegram.org/bot${token}/answerCallbackQuery`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ callback_query_id: callbackId }),
    signal: AbortSignal.timeout(10_000),
  });
}

async function deleteSensitiveMessage(token: string, chatId: number, messageId: number) {
  try {
    const response = await fetch(`https://api.telegram.org/bot${token}/deleteMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, message_id: messageId }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) console.warn("telegram_sensitive_message_delete_failed", { status: response.status });
  } catch (error) {
    console.warn("telegram_sensitive_message_delete_failed", { name: error instanceof Error ? error.name : "UnknownError" });
  }
}

function mainKeyboard(): InlineKeyboard {
  return { inline_keyboard: [
    [{ text: "📦 Товары", callback_data: "products:list" }, { text: "📂 Категории", callback_data: "categories:list" }],
    [{ text: "🌍 Страны", callback_data: "countries:list" }, { text: "📡 Операторы", callback_data: "operators:list" }],
    [{ text: "🛒 Заказы", callback_data: "orders:list" }, { text: "💳 Реквизиты", callback_data: "settings:payment" }],
    [{ text: "📈 Аналитика", callback_data: "analytics:period:7" }, { text: "📊 Статус", callback_data: "status" }],
  ] };
}

function persistentKeyboard(): ReplyKeyboard {
  return {
    keyboard: [
      [{ text: "📦 Товары" }, { text: "📂 Категории" }],
      [{ text: "🌍 Страны" }, { text: "📡 Операторы" }],
      [{ text: "🛒 Заказы" }, { text: "💳 Реквизиты" }],
      [{ text: "📈 Аналитика" }, { text: "📊 Статус магазина" }],
      [{ text: "🏠 Меню" }],
    ],
    resize_keyboard: true,
    is_persistent: true,
  };
}

const adminButtonCommands: Record<string, string> = {
  "📦 Товары": "/products",
  "📂 Категории": "/categories",
  "🌍 Страны": "/countries",
  "📡 Операторы": "/operators",
  "🛒 Заказы": "/orders",
  "💳 Реквизиты": "/payment_requisites",
  "📈 Аналитика": "/analytics",
  "📊 Статус магазина": "/status",
  "🏠 Меню": "/start",
};

async function sendAdminMenu(token: string, chatId: number) {
  await sendMessage(token, chatId, "Панель управления SIMKA", persistentKeyboard());
  await sendMessage(token, chatId, "Выберите раздел:", mainKeyboard());
}

function isEncryptionConfigError(error: unknown) {
  return error instanceof Error && error.message === "FULFILLMENT_ENCRYPTION_KEY_NOT_CONFIGURED";
}

function backKeyboard(): InlineKeyboard {
  return { inline_keyboard: [[{ text: "◀️ В меню", callback_data: "menu" }]] };
}

function orderBackKeyboard(orderNumber: string): InlineKeyboard {
  return { inline_keyboard: [[{ text: "◀️ К заказу", callback_data: `order:view:${orderNumber}` }]] };
}

function orderListKeyboard(list: Array<{ orderNumber: string; status: string }>): InlineKeyboard {
  return { inline_keyboard: [
    ...list.map((order) => [{ text: `${order.status === "WAITING_FOR_MANAGER" ? "🟡" : order.status === "PAID" ? "🟢" : "📦"} ${order.orderNumber}`, callback_data: `order:view:${order.orderNumber}` }]),
    [{ text: "◀️ В меню", callback_data: "menu" }],
  ] };
}

function analyticsKeyboard(selectedDays: number): InlineKeyboard {
  const button = (label: string, days: number) => ({ text: `${selectedDays === days ? "✅ " : ""}${label}`, callback_data: `analytics:period:${days}` });
  return { inline_keyboard: [
    [button("24 часа", 1), button("7 дней", 7), button("30 дней", 30)],
    [button("Всё время", 0)],
    [{ text: "🔄 Обновить", callback_data: `analytics:period:${selectedDays}` }],
    [{ text: "🛒 Последние заказы", callback_data: "orders:list" }],
    [{ text: "◀️ В меню", callback_data: "menu" }],
  ] };
}

const paidOrderStatuses = new Set(["PAID", "PROCESSING", "SHIPPED", "DELIVERED", "COMPLETED"]);
const activeOrderStatuses = new Set(["NEW", "WAITING_FOR_MANAGER", "WAITING_PAYMENT", "PAYMENT_PENDING", "PAID", "PROCESSING", "SHIPPED", "DELIVERED"]);
const analyticsStatusLabels: Record<string, string> = {
  NEW: "Новые", WAITING_FOR_MANAGER: "Ждут менеджера", WAITING_PAYMENT: "Ждут оплаты", PAYMENT_PENDING: "Платёж проверяется",
  PAID: "Оплачены", PROCESSING: "Выполняются", SHIPPED: "Отправлены", DELIVERED: "Доставлены", COMPLETED: "Завершены",
  CANCELLED: "Отменены", REFUNDED: "Возвраты", FAILED: "Ошибки",
};

async function sendAnalyticsSummary(db: ReturnType<typeof getDb>, token: string, chatId: number, days: number) {
  const normalizedDays = [0, 1, 7, 30].includes(days) ? days : 7;
  const selection = { id: orders.id, status: orders.status, totalAmount: orders.totalAmount, currency: orders.currency };
  const rows = normalizedDays
    ? await db.select(selection).from(orders).where(gte(orders.createdAt, new Date(Date.now() - normalizedDays * 86_400_000).toISOString()))
    : await db.select(selection).from(orders);
  const paid = rows.filter((order) => paidOrderStatuses.has(order.status));
  const active = await db.select({ id: orders.id }).from(orders).where(inArray(orders.status, [...activeOrderStatuses]));
  const cancelled = rows.filter((order) => order.status === "CANCELLED");
  const refunded = rows.filter((order) => order.status === "REFUNDED");
  const failed = rows.filter((order) => order.status === "FAILED");
  const paidIds = paid.map((order) => order.id);
  const soldItems = paidIds.length
    ? await db.select({ simType: orderItems.simType, quantity: orderItems.quantity }).from(orderItems).where(inArray(orderItems.orderId, paidIds))
    : [];
  const soldEsim = soldItems.filter((item) => item.simType === "eSIM").reduce((sum, item) => sum + item.quantity, 0);
  const soldSim = soldItems.filter((item) => item.simType === "SIM").reduce((sum, item) => sum + item.quantity, 0);
  const revenue = new Map<string, number>();
  for (const order of paid) revenue.set(order.currency, (revenue.get(order.currency) ?? 0) + order.totalAmount);
  const revenueLines = [...revenue].map(([currency, amount]) => `${amount.toLocaleString("ru-RU")} ${currency}`).join(" + ") || "0";
  const averageLines = [...revenue].map(([currency, amount]) => `${Math.round(amount / paid.filter((order) => order.currency === currency).length).toLocaleString("ru-RU")} ${currency}`).join(" + ") || "0";
  const statusCounts = new Map<string, number>();
  for (const order of rows) statusCounts.set(order.status, (statusCounts.get(order.status) ?? 0) + 1);
  const statusLines = [...statusCounts].sort((left, right) => right[1] - left[1]).map(([status, count]) => `• ${analyticsStatusLabels[status] ?? status}: ${count}`).join("\n") || "• Заказов пока нет";
  const period = normalizedDays === 0 ? "за всё время" : normalizedDays === 1 ? "за последние 24 часа" : `за последние ${normalizedDays} дней`;
  const conversion = rows.length ? (paid.length / rows.length * 100).toFixed(1).replace(".", ",") : "0";
  const text = [
    `📈 Аналитика SIMKA ${period}`,
    "",
    `🛒 Заказов создано: ${rows.length}`,
    `✅ Оплаченных: ${paid.length}`,
    `💰 Оборот: ${revenueLines}`,
    `🧾 Средний оплаченный заказ: ${averageLines}`,
    `📊 Конверсия заказ → оплата: ${conversion}%`,
    `⚙️ Активных сейчас: ${active.length}`,
    `❌ Отменено: ${cancelled.length}`,
    `↩️ Возвратов: ${refunded.length}`,
    `⚠️ Ошибок: ${failed.length}`,
    `📲 Продано eSIM: ${soldEsim}`,
    `📦 Продано SIM: ${soldSim}`,
    "",
    "Статусы:",
    statusLines,
    "",
    "Данные обновляются напрямую из базы магазина.",
  ].join("\n");
  await sendMessage(token, chatId, text, analyticsKeyboard(normalizedDays));
}

async function sendOrderDetails(db: ReturnType<typeof getDb>, token: string, chatId: number, orderNumber: string) {
  const [order] = await db.select().from(orders).where(eq(orders.orderNumber, orderNumber)).limit(1);
  if (!order) {
    await sendMessage(token, chatId, "Заказ не найден.", backKeyboard());
    return;
  }
  const items = await db.select({
    id: orderItems.id, productName: orderItems.productName, simType: orderItems.simType, quantity: orderItems.quantity,
    fulfillmentStatus: orderItems.fulfillmentStatus, deliveryMethod: orderItems.deliveryMethod, deliveryCost: orderItems.deliveryCost,
    deliveryCostConfirmed: orderItems.deliveryCostConfirmed, trackingNumber: orderItems.trackingNumber, trackingUrl: orderItems.trackingUrl,
    hasActivationCode: sql<boolean>`${orderItems.activationCodeEncrypted} IS NOT NULL`,
  }).from(orderItems).where(eq(orderItems.orderId, order.id));
  const lines = items.map((item) => [
    `• ${item.productName} × ${item.quantity}`,
    `  Исполнение: ${item.fulfillmentStatus}`,
    item.simType === "SIM" ? `  Доставка: ${item.deliveryMethod || "не задана"} · ${item.deliveryCostConfirmed ? `${item.deliveryCost.toLocaleString("ru-RU")} ${order.currency}` : "стоимость не подтверждена"}` : "",
    item.trackingNumber ? `  Трек: ${item.trackingNumber}${item.trackingUrl ? ` · ${item.trackingUrl}` : ""}` : "",
  ].filter(Boolean).join("\n")).join("\n");
  const actions: Array<Array<InlineButton>> = [];
  const pendingDeliveryCosts = items.filter((item) => item.simType === "SIM" && !item.deliveryCostConfirmed);
  if (order.status === "WAITING_FOR_MANAGER") {
    for (const item of pendingDeliveryCosts) actions.push([{ text: `💵 Стоимость доставки · ${item.productName.slice(0, 28)}`, callback_data: `fulfill:cost:${item.id.slice(0, 12)}` }]);
  }
  if (order.paymentMethod === "manager" && order.status === "WAITING_FOR_MANAGER" && pendingDeliveryCosts.length === 0) {
    actions.push([{ text: order.paymentInstructionsSentAt ? "📧 Повторить реквизиты" : "📧 Отправить реквизиты", callback_data: `order:requisites_prompt:${order.orderNumber}` }]);
    if (order.paymentInstructionsSentAt) actions.push([{ text: "✅ Подтвердить получение оплаты", callback_data: `order:paid_prompt:${order.orderNumber}` }]);
  }
  if (order.status === "PAID") actions.push([{ text: "⚙️ Начать выполнение", callback_data: `order:process:${order.orderNumber}` }]);
  if (order.status === "PROCESSING") {
    for (const item of items) {
      if (item.simType === "eSIM" && item.fulfillmentStatus === "PENDING") actions.push([{ text: `📲 Выдать eSIM · ${item.productName.slice(0, 30)}`, callback_data: `fulfill:esim:${item.id.slice(0, 12)}` }]);
      if (item.simType === "SIM" && item.fulfillmentStatus === "PENDING") actions.push([{ text: `📦 Указать отправку · ${item.productName.slice(0, 28)}`, callback_data: `fulfill:ship:${item.id.slice(0, 12)}` }]);
    }
  }
  if (!["CANCELLED", "REFUNDED", "FAILED"].includes(order.status)) {
    for (const item of items.filter((entry) => entry.simType === "eSIM" && ["READY", "SENT"].includes(entry.fulfillmentStatus) && entry.hasActivationCode)) {
      actions.push([{ text: `📧 Повторить eSIM-письмо · ${item.productName.slice(0, 23)}`, callback_data: `fulfill:resend:${item.id.slice(0, 12)}` }]);
    }
    for (const item of items.filter((entry) => entry.simType === "SIM" && ["SHIPPED", "DELIVERED", "COMPLETED"].includes(entry.fulfillmentStatus) && entry.trackingNumber)) {
      actions.push([{ text: `📧 Повторить трек-письмо · ${item.productName.slice(0, 24)}`, callback_data: `fulfill:shipmail:${item.id.slice(0, 12)}` }]);
    }
  }
  if (order.status === "SHIPPED") actions.push([{ text: "🚚 Отметить доставленным", callback_data: `order:deliver:${order.orderNumber}` }]);
  if (order.status === "DELIVERED") actions.push([{ text: "✅ Завершить заказ", callback_data: `order:complete:${order.orderNumber}` }]);
  if (["NEW", "WAITING_FOR_MANAGER", "WAITING_PAYMENT", "PAYMENT_PENDING", "PAID", "PROCESSING"].includes(order.status)) actions.push([{ text: "❌ Отменить заказ", callback_data: `order:cancel_prompt:${order.orderNumber}` }]);
  actions.push([{ text: "◀️ К заказам", callback_data: "orders:list" }]);
  const text = [
    `🛒 ${order.orderNumber}`,
    `Статус: ${order.status}`,
    `Клиент: ${order.customerName}`,
    `Email: ${order.customerEmail}`,
    order.customerContact ? `Контакт: ${order.customerContact}` : "",
    order.deliveryAddress ? `Доставка: ${order.deliveryAddress}` : "",
    order.customerComment ? `Комментарий: ${order.customerComment}` : "",
    `Оплата: ${order.paymentMethod === "manager" ? "через менеджера" : "криптовалюта"}`,
    order.paymentInstructionsSentAt ? `Реквизиты отправлены: ${order.paymentInstructionsSentAt}` : "",
    `Сумма: ${order.totalAmount.toLocaleString("ru-RU")} ${order.currency}`,
    "",
    lines,
  ].filter(Boolean).join("\n");
  await sendMessage(token, chatId, text, { inline_keyboard: actions });
}

async function audit(db: ReturnType<typeof getDb>, adminId: number, action: string, entityId: string | null, metadata: Record<string, unknown> = {}) {
  await db.insert(adminAuditLog).values({
    id: crypto.randomUUID(),
    adminTelegramId: String(adminId),
    action,
    entityType: action.split(".")[0] || "admin",
    entityId,
    metadata: JSON.stringify(metadata),
  });
}

async function resolveOrderItem(db: ReturnType<typeof getDb>, prefix: string) {
  if (!/^[0-9a-f-]{8,36}$/i.test(prefix)) return null;
  const matches = await db.select({
    itemId: orderItems.id,
    orderId: orderItems.orderId,
    productId: orderItems.productId,
    productName: orderItems.productName,
    simType: orderItems.simType,
    fulfillmentStatus: orderItems.fulfillmentStatus,
    deliveryMethod: orderItems.deliveryMethod,
    deliveryCost: orderItems.deliveryCost,
    deliveryCostConfirmed: orderItems.deliveryCostConfirmed,
    trackingNumber: orderItems.trackingNumber,
    trackingUrl: orderItems.trackingUrl,
    activationCodeEncrypted: orderItems.activationCodeEncrypted,
    fulfillmentInstructions: orderItems.fulfillmentInstructions,
    orderNumber: orders.orderNumber,
    orderStatus: orders.status,
    customerName: orders.customerName,
    customerEmail: orders.customerEmail,
    subtotalAmount: orders.subtotalAmount,
    deliveryAmount: orders.deliveryAmount,
    totalAmount: orders.totalAmount,
    currency: orders.currency,
  }).from(orderItems).innerJoin(orders, eq(orderItems.orderId, orders.id)).where(like(orderItems.id, `${prefix}%`)).limit(2);
  return matches.length === 1 ? matches[0] : null;
}

function validTrackingUrl(value: string) {
  if (!value || value === "-") return null;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

async function sendEsimDeliveryEmail(item: NonNullable<Awaited<ReturnType<typeof resolveOrderItem>>>, activationCode: string) {
  const instructions = item.fulfillmentInstructions || "Следуйте инструкции из карточки тарифа. Если возникнет вопрос, ответьте на это письмо.";
  return sendTransactionalEmail({
    to: item.customerEmail,
    subject: `eSIM по заказу ${item.orderNumber} — SIMKA`,
    text: `Здравствуйте, ${item.customerName}!\n\neSIM по заказу ${item.orderNumber} готова.\nТариф: ${item.productName}\n\nКод активации:\n${activationCode}\n\nИнструкция:\n${instructions}\n\nНе передавайте код другим людям. Добавляйте eSIM только через настройки устройства.`,
    html: `<div style="font-family:Arial,sans-serif;line-height:1.6;color:#10213a"><h1 style="font-size:24px">Ваша eSIM готова</h1><p>Здравствуйте, ${escapeHtml(item.customerName)}!</p><p>Заказ: <strong>${escapeHtml(item.orderNumber)}</strong><br>Тариф: ${escapeHtml(item.productName)}</p><p>Код активации:</p><pre style="overflow-wrap:anywhere;white-space:pre-wrap;border:1px solid #dbe5ef;border-radius:12px;background:#f6f9fc;padding:16px;font-size:15px">${escapeHtml(activationCode)}</pre><h2 style="font-size:18px">Инструкция</h2><p style="white-space:pre-line">${escapeHtml(instructions)}</p><p><strong>Не передавайте код другим людям.</strong> Добавляйте eSIM только через настройки устройства.</p></div>`,
  });
}

async function sendShippingEmail(item: NonNullable<Awaited<ReturnType<typeof resolveOrderItem>>>) {
  const trackingLine = item.trackingUrl ? `${item.trackingNumber}\n${item.trackingUrl}` : item.trackingNumber || "Уточняется";
  const trackingHtml = item.trackingUrl
    ? `<a href="${escapeHtml(item.trackingUrl)}">${escapeHtml(item.trackingNumber || "Открыть отслеживание")}</a>`
    : escapeHtml(item.trackingNumber || "Уточняется");
  return sendTransactionalEmail({
    to: item.customerEmail,
    subject: `SIM отправлена — заказ ${item.orderNumber}`,
    text: `Здравствуйте, ${item.customerName}!\n\nФизическая SIM по заказу ${item.orderNumber} отправлена.\nТовар: ${item.productName}\nСлужба/способ: ${item.deliveryMethod || "Уточняется"}\nТрек-номер: ${trackingLine}\n\nСохраните это письмо до получения отправления.`,
    html: `<div style="font-family:Arial,sans-serif;line-height:1.6;color:#10213a"><h1 style="font-size:24px">SIM отправлена</h1><p>Здравствуйте, ${escapeHtml(item.customerName)}!</p><p>Заказ: <strong>${escapeHtml(item.orderNumber)}</strong><br>Товар: ${escapeHtml(item.productName)}<br>Служба/способ: ${escapeHtml(item.deliveryMethod || "Уточняется")}<br>Трек-номер: ${trackingHtml}</p><p>Сохраните это письмо до получения отправления.</p></div>`,
  });
}

async function sendDeliveryQuoteEmail(item: NonNullable<Awaited<ReturnType<typeof resolveOrderItem>>>, totals: { deliveryAmount: number; totalAmount: number; currency: string }) {
  const total = `${totals.totalAmount.toLocaleString("ru-RU")} ${totals.currency}`;
  const delivery = `${totals.deliveryAmount.toLocaleString("ru-RU")} ${totals.currency}`;
  return sendTransactionalEmail({
    to: item.customerEmail,
    subject: `Итоговая стоимость заказа ${item.orderNumber} — SIMKA`,
    text: `Здравствуйте, ${item.customerName}!\n\nСтоимость доставки по заказу ${item.orderNumber} подтверждена.\nДоставка: ${delivery}\nИтоговая сумма заказа: ${total}\n\nМенеджер отправит актуальные реквизиты на этот email.`,
    html: `<div style="font-family:Arial,sans-serif;line-height:1.6;color:#10213a"><h1 style="font-size:24px">Стоимость доставки подтверждена</h1><p>Здравствуйте, ${escapeHtml(item.customerName)}!</p><p>Заказ: <strong>${escapeHtml(item.orderNumber)}</strong><br>Доставка: <strong>${escapeHtml(delivery)}</strong><br>Итоговая сумма: <strong>${escapeHtml(total)}</strong></p><p>Менеджер отправит актуальные реквизиты на этот email.</p></div>`,
  });
}

async function sendOrderStatusEmail(order: { customerEmail: string; customerName: string; orderNumber: string }, status: string) {
  const descriptions: Record<string, { subject: string; title: string; body: string }> = {
    PAID: { subject: "Оплата подтверждена", title: "Оплата получена", body: "Оплата подтверждена. Заказ передан на выполнение." },
    PROCESSING: { subject: "Заказ выполняется", title: "Начали выполнение", body: "Менеджер начал выдачу eSIM или подготовку физической SIM к отправке." },
    DELIVERED: { subject: "SIM доставлена", title: "Доставка отмечена завершённой", body: "Физическая SIM отмечена как доставленная. Если вы её не получили, сразу ответьте на это письмо." },
    COMPLETED: { subject: "Заказ выполнен", title: "Заказ завершён", body: "Все позиции заказа отмечены как выданные или доставленные." },
  };
  const message = descriptions[status];
  if (!message) return { delivered: false as const, reason: "not_configured" as const };
  return sendTransactionalEmail({
    to: order.customerEmail,
    subject: `${message.subject} — ${order.orderNumber}`,
    text: `Здравствуйте, ${order.customerName}!\n\n${message.body}\nЗаказ: ${order.orderNumber}`,
    html: `<div style="font-family:Arial,sans-serif;line-height:1.6;color:#10213a"><h1 style="font-size:24px">${escapeHtml(message.title)}</h1><p>Здравствуйте, ${escapeHtml(order.customerName)}!</p><p>${escapeHtml(message.body)}</p><p>Заказ: <strong>${escapeHtml(order.orderNumber)}</strong></p></div>`,
  });
}

async function sendPaymentRequisitesEmail(order: { customerEmail: string; customerName: string; orderNumber: string; totalAmount: number; currency: string }, requisites: string) {
  const amount = `${order.totalAmount.toLocaleString("ru-RU")} ${order.currency}`;
  return sendTransactionalEmail({
    to: order.customerEmail,
    subject: `Реквизиты для заказа ${order.orderNumber} — SIMKA`,
    text: `Здравствуйте, ${order.customerName}!\n\nИтоговая сумма заказа ${order.orderNumber}: ${amount}\n\nАктуальные реквизиты:\n${requisites}\n\nПосле оплаты ответьте на это письмо или сообщите менеджеру номер заказа. Не используйте реквизиты из других сообщений.`,
    html: `<div style="font-family:Arial,sans-serif;line-height:1.6;color:#10213a"><h1 style="font-size:24px">Реквизиты для оплаты</h1><p>Здравствуйте, ${escapeHtml(order.customerName)}!</p><p>Заказ: <strong>${escapeHtml(order.orderNumber)}</strong><br>Итоговая сумма: <strong>${escapeHtml(amount)}</strong></p><div style="white-space:pre-line;border:1px solid #dbe5ef;border-radius:12px;background:#f6f9fc;padding:16px">${escapeHtml(requisites)}</div><p>После оплаты ответьте на это письмо или сообщите менеджеру номер заказа. Не используйте реквизиты из других сообщений.</p></div>`,
  });
}

async function syncOrderFulfillmentStatus(db: ReturnType<typeof getDb>, orderId: string) {
  const [order, items] = await Promise.all([
    db.select({ status: orders.status }).from(orders).where(eq(orders.id, orderId)).limit(1),
    db.select({ simType: orderItems.simType, status: orderItems.fulfillmentStatus }).from(orderItems).where(eq(orderItems.orderId, orderId)),
  ]);
  if (order[0]?.status !== "PROCESSING" || items.length === 0) return;
  const esimReady = items.filter((item) => item.simType === "eSIM").every((item) => ["SENT", "DELIVERED", "COMPLETED"].includes(item.status));
  const physical = items.filter((item) => item.simType === "SIM");
  const physicalReady = physical.every((item) => ["SHIPPED", "DELIVERED", "COMPLETED"].includes(item.status));
  if (!esimReady || !physicalReady) return;
  const next = physical.length ? "SHIPPED" : "COMPLETED";
  await db.update(orders).set({ status: next, updatedAt: new Date().toISOString() }).where(and(eq(orders.id, orderId), eq(orders.status, "PROCESSING")));
}

async function handleFulfillmentReply(token: string, chatId: number, adminId: number, messageId: number, text: string, replyContext: string) {
  const db = getDb();
  if (replyContext.startsWith("[EDIT_PAYMENT_REQUISITES]")) {
    const requisites = text.trim();
    if (!requisites || requisites.length > 4000) { await sendMessage(token, chatId, "Реквизиты должны содержать от 1 до 4000 символов.", backKeyboard()); return true; }
    let encryptedValue: string;
    try {
      encryptedValue = await encryptFulfillmentSecret(requisites, `store-setting:${PAYMENT_REQUISITES_KEY}`);
    } catch (error) {
      if (isEncryptionConfigError(error)) {
        await sendMessage(token, chatId, "Сохранение реквизитов временно недоступно: администратору нужно добавить FULFILLMENT_ENCRYPTION_KEY в настройках Render (минимум 32 символа), затем повторить ввод.", backKeyboard());
        return true;
      }
      throw error;
    }
    await db.insert(storeSettings).values({ key: PAYMENT_REQUISITES_KEY, encryptedValue, updatedBy: String(adminId), updatedAt: new Date().toISOString() }).onConflictDoUpdate({ target: storeSettings.key, set: { encryptedValue, updatedBy: String(adminId), updatedAt: new Date().toISOString() } });
    await deleteSensitiveMessage(token, chatId, messageId);
    await audit(db, adminId, "settings.payment_requisites", PAYMENT_REQUISITES_KEY, { configured: true });
    await sendMessage(token, chatId, "Реквизиты зашифрованы и сохранены. Их можно отправлять клиенту кнопкой в карточке заказа.", { inline_keyboard: [[{ text: "💳 Открыть реквизиты", callback_data: "settings:payment" }], [{ text: "◀️ В меню", callback_data: "menu" }]] });
    return true;
  }
  const costReply = replyContext.match(/^\[DELIVERY_COST:([0-9a-f-]{36})\]/i);
  if (costReply) {
    const item = await resolveOrderItem(db, costReply[1]);
    const cost = Number(text.trim());
    if (!item || item.simType !== "SIM") { await sendMessage(token, chatId, "Строка заказа не найдена.", backKeyboard()); return true; }
    if (item.orderStatus !== "WAITING_FOR_MANAGER") { await sendMessage(token, chatId, `Стоимость нельзя менять в статусе ${item.orderStatus}.`, orderBackKeyboard(item.orderNumber)); return true; }
    if (item.deliveryCostConfirmed) { await sendMessage(token, chatId, "Стоимость этой доставки уже подтверждена. Старый запрос ввода больше не действует.", orderBackKeyboard(item.orderNumber)); return true; }
    if (!Number.isInteger(cost) || cost < 0 || cost > 100000000) { await sendMessage(token, chatId, "Введите целую сумму от 0 до 100000000 без пробелов и знаков валюты.", orderBackKeyboard(item.orderNumber)); return true; }
    const totals = await db.transaction(async (tx) => {
      const [lockedOrder] = await tx.select({ status: orders.status, subtotalAmount: orders.subtotalAmount, currency: orders.currency }).from(orders).where(eq(orders.id, item.orderId)).for("update").limit(1);
      if (!lockedOrder || lockedOrder.status !== "WAITING_FOR_MANAGER") return null;
      await tx.update(orderItems).set({ deliveryCost: cost, deliveryCostConfirmed: true, updatedAt: new Date().toISOString() }).where(eq(orderItems.id, item.itemId));
      const deliveryRows = await tx.select({ simType: orderItems.simType, deliveryCost: orderItems.deliveryCost, confirmed: orderItems.deliveryCostConfirmed }).from(orderItems).where(eq(orderItems.orderId, item.orderId));
      const deliveryAmount = deliveryRows.filter((row) => row.simType === "SIM").reduce((sum, row) => sum + row.deliveryCost, 0);
      const pending = deliveryRows.some((row) => row.simType === "SIM" && !row.confirmed);
      const totalAmount = lockedOrder.subtotalAmount + deliveryAmount;
      await tx.update(orders).set({ deliveryAmount, totalAmount, paymentInstructionsSentAt: null, updatedAt: new Date().toISOString() }).where(eq(orders.id, item.orderId));
      return { deliveryAmount, totalAmount, currency: lockedOrder.currency, pending };
    });
    if (!totals) { await sendMessage(token, chatId, "Статус заказа уже изменился. Стоимость не сохранена.", orderBackKeyboard(item.orderNumber)); return true; }
    let delivered = false;
    if (!totals.pending) delivered = (await sendDeliveryQuoteEmail(item, totals)).delivered;
    await audit(db, adminId, "order.delivery_cost", item.orderId, { itemId: item.itemId, cost, currency: totals.currency, customerEmailDelivered: delivered });
    await sendMessage(token, chatId, `Стоимость доставки сохранена: ${cost.toLocaleString("ru-RU")} ${totals.currency}.${totals.pending ? " В заказе ещё есть доставка без цены." : delivered ? " Клиенту отправлена итоговая сумма." : " Автоматическое письмо не доставлено — сообщите итог клиенту вручную."}`);
    await sendOrderDetails(db, token, chatId, item.orderNumber);
    return true;
  }

  const esimReply = replyContext.match(/^\[FULFILL_ESIM:([0-9a-f-]{36})\]/i);
  if (esimReply) {
    const item = await resolveOrderItem(db, esimReply[1]);
    if (!item || item.simType !== "eSIM") { await sendMessage(token, chatId, "Строка eSIM не найдена.", backKeyboard()); return true; }
    if (item.orderStatus !== "PROCESSING" || !["PENDING", "READY"].includes(item.fulfillmentStatus)) { await sendMessage(token, chatId, `Выдача недоступна: заказ ${item.orderStatus}, eSIM ${item.fulfillmentStatus}.`, orderBackKeyboard(item.orderNumber)); return true; }
    const separator = text.indexOf("|");
    const activationCode = (separator >= 0 ? text.slice(0, separator) : text).trim();
    let instructions = (separator >= 0 ? text.slice(separator + 1) : "").trim();
    if (!activationCode || activationCode.length > 4000 || instructions.length > 4000) { await sendMessage(token, chatId, "Код обязателен; код и инструкция — максимум по 4000 символов.", orderBackKeyboard(item.orderNumber)); return true; }
    if (!instructions) {
      const [product] = await db.select({ instructions: catalogProducts.instructions }).from(catalogProducts).where(eq(catalogProducts.id, item.productId)).limit(1);
      instructions = product?.instructions || "Следуйте инструкции из карточки тарифа.";
    }
    let encrypted: string;
    try {
      encrypted = await encryptFulfillmentSecret(activationCode, item.itemId);
    } catch (error) {
      if (isEncryptionConfigError(error)) {
        await sendMessage(token, chatId, "Выдача eSIM временно недоступна: администратору нужно добавить FULFILLMENT_ENCRYPTION_KEY в настройках Render (минимум 32 символа), затем повторить ввод.", orderBackKeyboard(item.orderNumber));
        return true;
      }
      throw error;
    }
    await db.update(orderItems).set({ activationCodeEncrypted: encrypted, fulfillmentInstructions: instructions, fulfillmentStatus: "READY", updatedAt: new Date().toISOString() }).where(eq(orderItems.id, item.itemId));
    await deleteSensitiveMessage(token, chatId, messageId);
    const readyItem = { ...item, activationCodeEncrypted: encrypted, fulfillmentInstructions: instructions, fulfillmentStatus: "READY" };
    const delivered = (await sendEsimDeliveryEmail(readyItem, activationCode)).delivered;
    if (delivered) await db.update(orderItems).set({ fulfillmentStatus: "SENT", fulfilledAt: new Date().toISOString(), updatedAt: new Date().toISOString() }).where(eq(orderItems.id, item.itemId));
    await syncOrderFulfillmentStatus(db, item.orderId);
    await audit(db, adminId, "order.esim_delivery", item.orderId, { itemId: item.itemId, delivered });
    await sendMessage(token, chatId, delivered ? "eSIM зашифрована, сохранена и отправлена клиенту по email." : "eSIM зашифрована и сохранена, но письмо не доставлено. После настройки почты нажмите «Повторить eSIM-письмо». ");
    await sendOrderDetails(db, token, chatId, item.orderNumber);
    return true;
  }

  const shipReply = replyContext.match(/^\[SHIP_ITEM:([0-9a-f-]{36})\]/i);
  if (shipReply) {
    const item = await resolveOrderItem(db, shipReply[1]);
    if (!item || item.simType !== "SIM") { await sendMessage(token, chatId, "Строка физической SIM не найдена.", backKeyboard()); return true; }
    if (item.orderStatus !== "PROCESSING" || item.fulfillmentStatus !== "PENDING" || !item.deliveryCostConfirmed) { await sendMessage(token, chatId, "Сначала подтвердите оплату и стоимость доставки, затем начните выполнение.", orderBackKeyboard(item.orderNumber)); return true; }
    const [trackingNumber = "", rawUrl = "", rawMethod = ""] = text.split("|").map((part) => part.trim());
    const trackingUrl = validTrackingUrl(rawUrl);
    if (!trackingNumber || trackingNumber.length > 160 || trackingUrl === undefined || rawMethod.length > 160) { await sendMessage(token, chatId, "Формат: трек-номер | URL отслеживания или - | служба доставки. Максимум 160 символов.", orderBackKeyboard(item.orderNumber)); return true; }
    await db.update(orderItems).set({ fulfillmentStatus: "SHIPPED", trackingNumber, trackingUrl, deliveryMethod: rawMethod || item.deliveryMethod, fulfilledAt: new Date().toISOString(), updatedAt: new Date().toISOString() }).where(eq(orderItems.id, item.itemId));
    const shipped = { ...item, fulfillmentStatus: "SHIPPED", trackingNumber, trackingUrl, deliveryMethod: rawMethod || item.deliveryMethod };
    const delivered = (await sendShippingEmail(shipped)).delivered;
    await syncOrderFulfillmentStatus(db, item.orderId);
    await audit(db, adminId, "order.shipment", item.orderId, { itemId: item.itemId, trackingNumber, customerEmailDelivered: delivered });
    await sendMessage(token, chatId, delivered ? "Отправка и трек-номер сохранены. Клиенту отправлено письмо." : "Отправка и трек-номер сохранены, но письмо клиенту не доставлено — сообщите трек вручную.");
    await sendOrderDetails(db, token, chatId, item.orderNumber);
    return true;
  }
  return false;
}

const editableCategoryFields = new Set([
  "name", "slug", "description", "image_url", "seo_title", "seo_description", "h1", "seo_text",
  "canonical_url", "og_title", "og_description", "og_image", "sort_order",
]);
const reservedCategorySlugs = new Set(["esim", "sim", "europe", "asia", "america"]);
const nullableCategoryFields = new Set(["image_url", "seo_title", "seo_description", "h1", "seo_text", "canonical_url", "og_title", "og_description", "og_image"]);

function validAdminUrl(value: string, allowRelative = false) {
  if (allowRelative && value.startsWith("/")) return true;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

const categoryFieldByCode = {
  n: "name",
  s: "slug",
  d: "description",
  im: "image_url",
  st: "seo_title",
  sd: "seo_description",
  h: "h1",
  sx: "seo_text",
  cu: "canonical_url",
  ot: "og_title",
  od: "og_description",
  oi: "og_image",
  so: "sort_order",
} as const;

function categoryKeyboard(list: Array<{ id: string; name: string }>): InlineKeyboard {
  const rows = list.slice(0, 80).map((category) => [{ text: `📁 ${category.name.slice(0, 54)}`, callback_data: `category:view:${category.id}` }]);
  rows.push([{ text: "➕ Создать категорию", callback_data: "category:create" }]);
  rows.push([{ text: "◀️ В меню", callback_data: "menu" }]);
  return { inline_keyboard: rows };
}

function categoryActionKeyboard(category: { id: string; isPublished: boolean; noindex: boolean; archivedAt: string | null }, productIds: Set<number>, products: Array<{ id: number; name: string }>): InlineKeyboard {
  const productButtons = products.slice(0, 80).map((product) => ({
    text: `${productIds.has(product.id) ? "✅ Снять" : "➕ Назначить"} ${product.id} · ${product.name.slice(0, 28)}`,
    callback_data: `ca:${category.id.slice(0, 12)}:${product.id}`,
  }));
  const productRows: Array<Array<InlineButton>> = [];
  for (let index = 0; index < productButtons.length; index += 2) productRows.push(productButtons.slice(index, index + 2));
  return { inline_keyboard: [
    [{ text: category.isPublished ? "⏸ Снять с публикации" : "▶️ Опубликовать", callback_data: `category:publish:${category.id}` }],
    [{ text: category.noindex ? "🔓 Разрешить индексацию" : "🔒 Закрыть индексацию", callback_data: `category:index:${category.id}` }],
    [{ text: category.archivedAt ? "♻️ Восстановить" : "📦 Архивировать", callback_data: `category:${category.archivedAt ? "restore" : "archive"}:${category.id}` }],
    [{ text: "🗂 Выбрать родительскую категорию", callback_data: `category:parents:${category.id}` }],
    [{ text: "✏️ Изменить текст / SEO", callback_data: `category:edit:${category.id}` }],
    ...productRows,
    [{ text: "🗑 Удалить категорию", callback_data: `category:delete_prompt:${category.id}` }],
    [{ text: "◀️ К списку", callback_data: "categories:list" }],
  ] };
}

function categoryEditKeyboard(categoryId: string): InlineKeyboard {
  const fields = [
    ["Название", "n"], ["Slug", "s"], ["Описание", "d"], ["Изображение", "im"],
    ["SEO title", "st"], ["SEO description", "sd"], ["H1", "h"], ["SEO-текст", "sx"],
    ["Canonical", "cu"], ["OG title", "ot"], ["OG description", "od"], ["OG image", "oi"],
    ["Порядок", "so"],
  ];
  const rows = fields.map(([label, fieldCode]) => [{ text: `✏️ ${label}`, callback_data: `category:field:${categoryId}:${fieldCode}` }]);
  rows.push([{ text: "◀️ К категории", callback_data: `category:view:${categoryId}` }]);
  return { inline_keyboard: rows };
}

async function sendCategoryDetails(db: ReturnType<typeof getDb>, token: string, chatId: number, categoryId: string) {
  const [category] = await db.select({ id: categories.id, parentId: categories.parentId, name: categories.name, slug: categories.slug, description: categories.description, isPublished: categories.isPublished, noindex: categories.noindex, archivedAt: categories.archivedAt, sortOrder: categories.sortOrder }).from(categories).where(eq(categories.id, categoryId)).limit(1);
  if (!category) {
    await sendMessage(token, chatId, "Категория не найдена.", backKeyboard());
    return;
  }
  const links = await db.select({ productId: productCategories.productId }).from(productCategories).where(eq(productCategories.categoryId, categoryId));
  const products = await db.select({ id: catalogProducts.id, name: catalogProducts.name }).from(catalogProducts).where(isNull(catalogProducts.archivedAt)).orderBy(asc(catalogProducts.sortOrder), asc(catalogProducts.id));
  const [parent] = category.parentId ? await db.select({ name: categories.name }).from(categories).where(eq(categories.id, category.parentId)).limit(1) : [];
  const productIds = new Set(links.map((link) => link.productId));
  const status = category.archivedAt ? "ARCHIVED" : category.isPublished ? "PUBLISHED" : "DRAFT";
  const description = category.description ? `${category.description.slice(0, 2999)}${category.description.length > 3000 ? "…" : ""}` : "Описание не задано.";
  const text = `📁 ${category.name.slice(0, 160)}\nSlug: ${category.slug}\nРодитель: ${parent?.name || "нет"}\nСтатус: ${status}\nИндексация: ${category.noindex ? "NOINDEX" : "INDEX"}\nПорядок: ${category.sortOrder}\nТовары: ${productIds.size ? [...productIds].join(", ") : "нет"}\n\n${description}`;
  await sendMessage(token, chatId, text, categoryActionKeyboard(category, productIds, products));
}

async function resolveCategoryByPrefix(db: ReturnType<typeof getDb>, prefix: string) {
  if (!/^[0-9a-f-]{8,36}$/i.test(prefix)) return null;
  const matches = await db.select({ id: categories.id, name: categories.name, parentId: categories.parentId }).from(categories).where(like(categories.id, `${prefix}%`)).limit(2);
  return matches.length === 1 ? matches[0] : null;
}

async function createsCategoryCycle(db: ReturnType<typeof getDb>, childId: string, proposedParentId: string) {
  const hierarchy = await db.select({ id: categories.id, parentId: categories.parentId }).from(categories);
  const parentById = new Map(hierarchy.map((item) => [item.id, item.parentId]));
  let cursor: string | null = proposedParentId;
  const visited = new Set<string>();
  while (cursor) {
    if (cursor === childId || visited.has(cursor)) return true;
    visited.add(cursor);
    cursor = parentById.get(cursor) ?? null;
  }
  return false;
}

async function handleCallback(token: string, chatId: number, adminId: number, data: string) {
  const db = getDb();
  const [scope, action, first, second] = data.split(":");
  if (data === "menu") {
    await sendAdminMenu(token, chatId);
    return;
  }
  if (await handleCatalogAdminCallback({ token, chatId, adminId }, data)) return;
  if (data === "status") {
    const recent = await db.select({ status: orders.status }).from(orders).orderBy(desc(orders.createdAt)).limit(100);
    const active = recent.filter((order) => !["COMPLETED", "CANCELLED", "REFUNDED", "FAILED"].includes(order.status)).length;
    await sendMessage(token, chatId, `SIMKA работает.\nЗаказов: ${recent.length}\nАктивных: ${active}`, backKeyboard());
    return;
  }
  if (scope === "analytics" && action === "period") {
    await sendAnalyticsSummary(db, token, chatId, Number(first));
    return;
  }
  if (scope === "settings" && action === "payment") {
    const [setting] = await db.select({ updatedAt: storeSettings.updatedAt, updatedBy: storeSettings.updatedBy }).from(storeSettings).where(eq(storeSettings.key, PAYMENT_REQUISITES_KEY)).limit(1);
    await sendMessage(token, chatId, setting ? `Платёжные реквизиты настроены.\nОбновлены: ${setting.updatedAt}\nАдминистратор: ${setting.updatedBy}\n\nПолное значение намеренно не показывается в сообщениях.` : "Платёжные реквизиты ещё не настроены. Без них кнопка отправки клиенту не сработает.", { inline_keyboard: [[{ text: setting ? "✏️ Заменить реквизиты" : "➕ Добавить реквизиты", callback_data: "settings:payment_edit" }], [{ text: "◀️ В меню", callback_data: "menu" }]] });
    return;
  }
  if (scope === "settings" && action === "payment_edit") {
    await sendMessage(token, chatId, "[EDIT_PAYMENT_REQUISITES]\nВведите актуальные реквизиты и понятное назначение платежа. Значение будет зашифровано перед сохранением и не будет показано в карточках бота.", { force_reply: true, selective: true, input_field_placeholder: "Банк, получатель, номер счёта, назначение" });
    return;
  }
  if (scope === "orders" && action === "list") {
    const recent = await db.select({ orderNumber: orders.orderNumber, status: orders.status, totalAmount: orders.totalAmount, currency: orders.currency }).from(orders).orderBy(desc(orders.createdAt)).limit(5);
    const lines = recent.length ? recent.map((order) => `${order.orderNumber} · ${order.status} · ${order.totalAmount.toLocaleString("ru-RU")} ${order.currency}`).join("\n") : "Заказов пока нет.";
    await sendMessage(token, chatId, `Последние заказы:\n\n${lines}`, orderListKeyboard(recent));
    return;
  }
  if (scope === "order" && action === "view" && first) {
    await sendOrderDetails(db, token, chatId, first);
    return;
  }
  if (scope === "order" && action === "requisites_prompt" && first) {
    const [order] = await db.select({ id: orders.id, paymentMethod: orders.paymentMethod, status: orders.status }).from(orders).where(eq(orders.orderNumber, first)).limit(1);
    if (!order || order.paymentMethod !== "manager" || order.status !== "WAITING_FOR_MANAGER") { await sendMessage(token, chatId, "Отправка реквизитов сейчас недоступна.", orderBackKeyboard(first)); return; }
    const pending = await db.select({ id: orderItems.id }).from(orderItems).where(and(eq(orderItems.orderId, order.id), eq(orderItems.simType, "SIM"), eq(orderItems.deliveryCostConfirmed, false))).limit(1);
    if (pending[0]) { await sendMessage(token, chatId, "Сначала укажите стоимость доставки всех физических SIM.", orderBackKeyboard(first)); return; }
    await sendMessage(token, chatId, `Отправить сохранённые реквизиты и итоговую сумму на email клиента по заказу ${first}?`, { inline_keyboard: [[{ text: "📧 Да, отправить", callback_data: `order:requisites_confirm:${first}` }], [{ text: "Отмена", callback_data: `order:view:${first}` }]] });
    return;
  }
  if (scope === "order" && action === "requisites_confirm" && first) {
    const [order] = await db.select({ id: orders.id, orderNumber: orders.orderNumber, paymentMethod: orders.paymentMethod, status: orders.status, customerName: orders.customerName, customerEmail: orders.customerEmail, totalAmount: orders.totalAmount, currency: orders.currency }).from(orders).where(eq(orders.orderNumber, first)).limit(1);
    if (!order || order.paymentMethod !== "manager" || order.status !== "WAITING_FOR_MANAGER") { await sendMessage(token, chatId, "Отправка реквизитов сейчас недоступна.", orderBackKeyboard(first)); return; }
    const pending = await db.select({ id: orderItems.id }).from(orderItems).where(and(eq(orderItems.orderId, order.id), eq(orderItems.simType, "SIM"), eq(orderItems.deliveryCostConfirmed, false))).limit(1);
    if (pending[0]) { await sendMessage(token, chatId, "Сначала укажите стоимость доставки всех физических SIM.", orderBackKeyboard(first)); return; }
    const [setting] = await db.select({ encryptedValue: storeSettings.encryptedValue }).from(storeSettings).where(eq(storeSettings.key, PAYMENT_REQUISITES_KEY)).limit(1);
    if (!setting) { await sendMessage(token, chatId, "Сначала добавьте платёжные реквизиты в разделе «💳 Реквизиты».", { inline_keyboard: [[{ text: "💳 Настроить", callback_data: "settings:payment" }], [{ text: "◀️ К заказу", callback_data: `order:view:${first}` }]] }); return; }
    const requisites = await decryptFulfillmentSecret(setting.encryptedValue, `store-setting:${PAYMENT_REQUISITES_KEY}`);
    const delivered = (await sendPaymentRequisitesEmail(order, requisites)).delivered;
    if (delivered) await db.update(orders).set({ paymentInstructionsSentAt: new Date().toISOString(), updatedAt: new Date().toISOString() }).where(eq(orders.id, order.id));
    await audit(db, adminId, "order.payment_requisites", order.id, { delivered });
    await sendMessage(token, chatId, delivered ? "Реквизиты и итоговая сумма отправлены клиенту по email." : "Письмо не доставлено. Проверьте RESEND_API_KEY и EMAIL_FROM; реквизиты остаются сохранены на backend.");
    await sendOrderDetails(db, token, chatId, order.orderNumber);
    return;
  }
  if (scope === "fulfill" && ["cost", "esim", "resend", "ship", "shipmail"].includes(action) && first) {
    const item = await resolveOrderItem(db, first);
    if (!item) { await sendMessage(token, chatId, "Строка заказа не найдена или идентификатор неоднозначен.", backKeyboard()); return; }
    if (action === "cost") {
      if (item.simType !== "SIM" || item.orderStatus !== "WAITING_FOR_MANAGER") { await sendMessage(token, chatId, "Стоимость доставки сейчас изменить нельзя.", orderBackKeyboard(item.orderNumber)); return; }
      await sendMessage(token, chatId, `[DELIVERY_COST:${item.itemId}]\nВведите итоговую стоимость доставки целым числом в ${item.currency}. Для бесплатной доставки отправьте 0.`, { force_reply: true, selective: true, input_field_placeholder: "Например: 500" });
      return;
    }
    if (action === "esim") {
      if (item.simType !== "eSIM" || item.orderStatus !== "PROCESSING") { await sendMessage(token, chatId, "Сначала подтвердите оплату и нажмите «Начать выполнение».", orderBackKeyboard(item.orderNumber)); return; }
      await sendMessage(token, chatId, `[FULFILL_ESIM:${item.itemId}]\nВведите код активации | инструкцию. Инструкцию можно не указывать — будет использована инструкция товара. Код шифруется перед сохранением и не показывается в карточке заказа.`, { force_reply: true, selective: true, input_field_placeholder: "Код активации | Инструкция" });
      return;
    }
    if (action === "resend") {
      if (item.simType !== "eSIM" || !["PROCESSING", "SHIPPED", "DELIVERED", "COMPLETED"].includes(item.orderStatus) || !item.activationCodeEncrypted) { await sendMessage(token, chatId, "Повторная отправка сейчас недоступна.", orderBackKeyboard(item.orderNumber)); return; }
      const activationCode = await decryptFulfillmentSecret(item.activationCodeEncrypted, item.itemId);
      const delivered = (await sendEsimDeliveryEmail(item, activationCode)).delivered;
      if (delivered) await db.update(orderItems).set({ fulfillmentStatus: "SENT", fulfilledAt: new Date().toISOString(), updatedAt: new Date().toISOString() }).where(eq(orderItems.id, item.itemId));
      await syncOrderFulfillmentStatus(db, item.orderId);
      await audit(db, adminId, "order.esim_resend", item.orderId, { itemId: item.itemId, delivered });
      await sendMessage(token, chatId, delivered ? "eSIM повторно отправлена клиенту." : "Письмо снова не доставлено. Проверьте RESEND_API_KEY и EMAIL_FROM.");
      await sendOrderDetails(db, token, chatId, item.orderNumber);
      return;
    }
    if (action === "ship") {
      if (item.simType !== "SIM" || item.orderStatus !== "PROCESSING" || !item.deliveryCostConfirmed) { await sendMessage(token, chatId, "Сначала подтвердите стоимость, оплату и начните выполнение.", orderBackKeyboard(item.orderNumber)); return; }
      await sendMessage(token, chatId, `[SHIP_ITEM:${item.itemId}]\nВведите: трек-номер | URL отслеживания или - | служба доставки`, { force_reply: true, selective: true, input_field_placeholder: "123456789 | https://… | СДЭК" });
      return;
    }
    if (action === "shipmail") {
      if (item.simType !== "SIM" || !["SHIPPED", "DELIVERED", "COMPLETED"].includes(item.fulfillmentStatus) || !item.trackingNumber) { await sendMessage(token, chatId, "Повторная отправка трек-номера недоступна.", orderBackKeyboard(item.orderNumber)); return; }
      const delivered = (await sendShippingEmail(item)).delivered;
      await audit(db, adminId, "order.shipment_resend", item.orderId, { itemId: item.itemId, delivered });
      await sendMessage(token, chatId, delivered ? "Трек-номер повторно отправлен клиенту." : "Письмо не доставлено. Проверьте почтовые настройки.");
      await sendOrderDetails(db, token, chatId, item.orderNumber);
      return;
    }
  }
  if (scope === "order" && action === "paid_prompt" && first) {
    const [order] = await db.select({ id: orders.id, paymentInstructionsSentAt: orders.paymentInstructionsSentAt }).from(orders).where(eq(orders.orderNumber, first)).limit(1);
    const pending = order ? await db.select({ id: orderItems.id }).from(orderItems).where(and(eq(orderItems.orderId, order.id), eq(orderItems.simType, "SIM"), eq(orderItems.deliveryCostConfirmed, false))).limit(1) : [];
    if (pending[0]) { await sendMessage(token, chatId, "Сначала укажите стоимость доставки всех физических SIM.", orderBackKeyboard(first)); return; }
    if (!order?.paymentInstructionsSentAt) { await sendMessage(token, chatId, "Сначала отправьте клиенту реквизиты кнопкой в карточке заказа.", orderBackKeyboard(first)); return; }
    await sendMessage(token, chatId, `Подтвердить фактическое получение оплаты по заказу ${first}?`, { inline_keyboard: [[{ text: "Да, деньги получены", callback_data: `order:paid_confirm:${first}` }], [{ text: "Отмена", callback_data: `order:view:${first}` }]] });
    return;
  }
  if (scope === "order" && action === "cancel_prompt" && first) {
    const [order] = await db.select({ status: orders.status }).from(orders).where(eq(orders.orderNumber, first)).limit(1);
    if (!order) { await sendMessage(token, chatId, "Заказ не найден.", backKeyboard()); return; }
    const paidWarning = ["PAID", "PROCESSING"].includes(order.status) ? "\n\nВнимание: заказ уже оплачен. Отмена не возвращает деньги автоматически — возврат нужно провести отдельно." : "";
    await sendMessage(token, chatId, `Точно отменить заказ ${first}?${paidWarning}`, { inline_keyboard: [[{ text: "❌ Да, отменить заказ", callback_data: `order:cancel_confirm:${first}` }], [{ text: "Не отменять", callback_data: `order:view:${first}` }]] });
    return;
  }
  if (scope === "order" && action === "cancel_confirm" && first) {
    const [order] = await db.select({ id: orders.id, orderNumber: orders.orderNumber, status: orders.status, customerName: orders.customerName, customerEmail: orders.customerEmail, inventoryReserved: orders.inventoryReserved }).from(orders).where(eq(orders.orderNumber, first)).limit(1);
    if (!order) { await sendMessage(token, chatId, "Заказ не найден.", backKeyboard()); return; }
    const cancellableStatuses = ["NEW", "WAITING_FOR_MANAGER", "WAITING_PAYMENT", "PAYMENT_PENDING", "PAID", "PROCESSING"];
    if (!cancellableStatuses.includes(order.status)) {
      await sendMessage(token, chatId, `Заказ в статусе ${order.status} отменить нельзя.`, { inline_keyboard: [[{ text: "◀️ К заказу", callback_data: `order:view:${order.orderNumber}` }]] });
      return;
    }
    const cancelledItems = await db.select({ productId: orderItems.productId, variantId: orderItems.variantId, quantity: orderItems.quantity, fulfillmentStatus: orderItems.fulfillmentStatus }).from(orderItems).where(eq(orderItems.orderId, order.id));
    if (cancelledItems.some((item) => ["SENT", "SHIPPED", "DELIVERED", "COMPLETED"].includes(item.fulfillmentStatus))) {
      await sendMessage(token, chatId, "Заказ уже частично выдан или отправлен. Простая отмена запрещена — оформите возврат отдельно.", orderBackKeyboard(order.orderNumber));
      return;
    }
    await db.transaction(async (tx) => {
      const changed = await tx.update(orders).set({ status: "CANCELLED", inventoryReserved: false, updatedAt: new Date().toISOString() }).where(and(eq(orders.id, order.id), eq(orders.status, order.status))).returning({ id: orders.id });
      if (!changed[0]) throw new Error("ORDER_STATUS_CHANGED");
      await tx.update(orderItems).set({ fulfillmentStatus: "CANCELLED", activationCodeEncrypted: null, fulfillmentInstructions: null, updatedAt: new Date().toISOString() }).where(eq(orderItems.orderId, order.id));
      const productQuantities = new Map<number, number>();
      const variantQuantities = new Map<number, number>();
      for (const item of order.inventoryReserved ? cancelledItems : []) {
        productQuantities.set(item.productId, (productQuantities.get(item.productId) ?? 0) + item.quantity);
        if (item.variantId) variantQuantities.set(item.variantId, (variantQuantities.get(item.variantId) ?? 0) + item.quantity);
      }
      for (const [productId, quantity] of productQuantities) {
        await tx.update(catalogProducts).set({
          stockQuantity: sql`${catalogProducts.stockQuantity} + ${quantity}`,
          available: sql`CASE WHEN ${catalogProducts.stockQuantity} = 0 THEN TRUE ELSE ${catalogProducts.available} END`,
          availabilityStatus: sql`CASE WHEN ${catalogProducts.stockQuantity} = 0 THEN 'IN_STOCK' ELSE ${catalogProducts.availabilityStatus} END`,
          updatedAt: new Date().toISOString(),
        }).where(and(eq(catalogProducts.id, productId), sql`${catalogProducts.stockQuantity} IS NOT NULL`));
      }
      for (const [variantId, quantity] of variantQuantities) {
        await tx.update(productVariants).set({
          stockQuantity: sql`${productVariants.stockQuantity} + ${quantity}`,
          available: sql`CASE WHEN ${productVariants.stockQuantity} = 0 THEN TRUE ELSE ${productVariants.available} END`,
          availabilityStatus: sql`CASE WHEN ${productVariants.stockQuantity} = 0 THEN 'IN_STOCK' ELSE ${productVariants.availabilityStatus} END`,
          updatedAt: new Date().toISOString(),
        }).where(and(eq(productVariants.id, variantId), sql`${productVariants.stockQuantity} IS NOT NULL`));
      }
    });
    await audit(db, adminId, "order.cancel", order.id, { orderNumber: order.orderNumber, from: order.status, to: "CANCELLED" });
    await reportOrderAnalytics(order.id, "CANCELLED");
    let cancellationEmailDelivered = false;
    try {
      const safeName = escapeHtml(order.customerName);
      const safeNumber = escapeHtml(order.orderNumber);
      const delivery = await sendTransactionalEmail({
        to: order.customerEmail,
        subject: `Заказ ${order.orderNumber} отменён — SIMKA`,
        text: `Здравствуйте, ${order.customerName}!\n\nЗаказ ${order.orderNumber} отменён. Если вы уже оплатили заказ, свяжитесь с поддержкой и укажите номер заказа — возврат обрабатывается отдельно.`,
        html: `<div style="font-family:Arial,sans-serif;line-height:1.6;color:#10213a"><h1 style="font-size:24px">Заказ отменён</h1><p>Здравствуйте, ${safeName}!</p><p>Заказ <strong>${safeNumber}</strong> отменён.</p><p>Если вы уже оплатили заказ, свяжитесь с поддержкой и укажите номер заказа — возврат обрабатывается отдельно.</p></div>`,
      });
      cancellationEmailDelivered = delivery.delivered;
    } catch (error) {
      console.error("order_cancellation_email_failed", { name: error instanceof Error ? error.name : "UnknownError" });
    }
    await audit(db, adminId, "order.cancellation_email", order.id, { delivered: cancellationEmailDelivered });
    await sendMessage(token, chatId, `Заказ ${order.orderNumber} отменён. Статус → CANCELLED.\n${cancellationEmailDelivered ? "Клиенту отправлено письмо об отмене." : "Автоматическое письмо клиенту не доставлено — сообщите об отмене вручную."}`, { inline_keyboard: [[{ text: "🛒 К списку заказов", callback_data: "orders:list" }], [{ text: "📄 Открыть заказ", callback_data: `order:view:${order.orderNumber}` }]] });
    return;
  }
  if (scope === "order" && ["paid_confirm", "process", "deliver", "complete"].includes(action) && first) {
    const [order] = await db.select({ id: orders.id, orderNumber: orders.orderNumber, paymentMethod: orders.paymentMethod, status: orders.status, customerName: orders.customerName, customerEmail: orders.customerEmail, paymentInstructionsSentAt: orders.paymentInstructionsSentAt }).from(orders).where(eq(orders.orderNumber, first)).limit(1);
    if (!order) { await sendMessage(token, chatId, "Заказ не найден.", backKeyboard()); return; }
    const transitions: Record<string, { from: string; to: string }> = {
      paid_confirm: { from: "WAITING_FOR_MANAGER", to: "PAID" },
      process: { from: "PAID", to: "PROCESSING" },
      deliver: { from: "SHIPPED", to: "DELIVERED" },
      complete: { from: "DELIVERED", to: "COMPLETED" },
    };
    const transition = transitions[action];
    if (action === "paid_confirm" && order.paymentMethod !== "manager") {
      await sendMessage(token, chatId, "Криптовалютную оплату может подтвердить только защищённый webhook платёжного провайдера.");
      return;
    }
    if (action === "paid_confirm" && !order.paymentInstructionsSentAt) {
      await sendMessage(token, chatId, "Сначала отправьте клиенту реквизиты кнопкой в карточке заказа.", orderBackKeyboard(order.orderNumber));
      return;
    }
    if (action === "paid_confirm") {
      const pendingCost = await db.select({ id: orderItems.id }).from(orderItems).where(and(eq(orderItems.orderId, order.id), eq(orderItems.simType, "SIM"), eq(orderItems.deliveryCostConfirmed, false))).limit(1);
      if (pendingCost[0]) { await sendMessage(token, chatId, "Сначала укажите стоимость доставки всех физических SIM.", orderBackKeyboard(order.orderNumber)); return; }
    }
    if (order.status !== transition.from) {
      await sendMessage(token, chatId, `Переход недоступен для статуса ${order.status}.`);
      return;
    }
    const changed = await db.update(orders).set({ status: transition.to, updatedAt: new Date().toISOString() }).where(and(eq(orders.id, order.id), eq(orders.status, transition.from))).returning({ id: orders.id });
    if (!changed[0]) { await sendMessage(token, chatId, "Статус заказа уже изменился. Откройте его заново.", orderBackKeyboard(order.orderNumber)); return; }
    if (action === "deliver") await db.update(orderItems).set({ fulfillmentStatus: "DELIVERED", fulfilledAt: new Date().toISOString(), updatedAt: new Date().toISOString() }).where(and(eq(orderItems.orderId, order.id), eq(orderItems.simType, "SIM")));
    if (action === "complete") await db.update(orderItems).set({ fulfillmentStatus: "COMPLETED", updatedAt: new Date().toISOString() }).where(eq(orderItems.orderId, order.id));
    const customerEmailDelivered = (await sendOrderStatusEmail(order, transition.to)).delivered;
    if (transition.to === "PAID") await reportOrderAnalytics(order.id, "PAID");
    await audit(db, adminId, `order.${action}`, order.id, { orderNumber: order.orderNumber, from: transition.from, to: transition.to, customerEmailDelivered });
    await sendOrderDetails(db, token, chatId, order.orderNumber);
    return;
  }
  if (scope === "categories" && action === "list") {
    const list = await db.select({ id: categories.id, name: categories.name }).from(categories).orderBy(categories.sortOrder, categories.name);
    await sendMessage(token, chatId, list.length ? "Выберите категорию:" : "Категорий пока нет. Создайте первую:", categoryKeyboard(list));
    return;
  }
  if (scope === "category" && action === "create") {
    await sendMessage(token, chatId, "[CREATE_CATEGORY]\nВведите данные новой категории:\nslug | Название | Описание", { force_reply: true, selective: true, input_field_placeholder: "slug | Название | Описание" });
    return;
  }
  if (scope === "category" && action === "edit" && first) {
    await sendMessage(token, chatId, "Выберите поле, которое хотите изменить:", categoryEditKeyboard(first));
    return;
  }
  if (scope === "category" && action === "parents" && first) {
    const [current, candidates] = await Promise.all([
      db.select({ id: categories.id }).from(categories).where(eq(categories.id, first)).limit(1),
      db.select({ id: categories.id, name: categories.name }).from(categories).where(isNull(categories.archivedAt)).orderBy(asc(categories.sortOrder), asc(categories.name)).limit(80),
    ]);
    if (!current[0]) { await sendMessage(token, chatId, "Категория не найдена.", backKeyboard()); return; }
    const rows: Array<Array<InlineButton>> = [[{ text: "Без родительской категории", callback_data: `cp:${first.slice(0, 12)}:root` }]];
    for (const candidate of candidates.filter((item) => item.id !== first)) {
      rows.push([{ text: `📁 ${candidate.name.slice(0, 40)}`, callback_data: `cp:${first.slice(0, 12)}:${candidate.id.slice(0, 12)}` }]);
    }
    rows.push([{ text: "◀️ К категории", callback_data: `category:view:${first}` }]);
    await sendMessage(token, chatId, "Выберите родительскую категорию:", { inline_keyboard: rows });
    return;
  }
  if (scope === "cp" && action && first) {
    const child = await resolveCategoryByPrefix(db, action);
    const parent = first === "root" ? null : await resolveCategoryByPrefix(db, first);
    if (!child || (first !== "root" && !parent)) { await sendMessage(token, chatId, "Категория не найдена или короткий идентификатор неоднозначен.", backKeyboard()); return; }
    if (parent && await createsCategoryCycle(db, child.id, parent.id)) {
      await sendMessage(token, chatId, "Такую связь создать нельзя: получится циклическая вложенность.", { inline_keyboard: [[{ text: "◀️ К категории", callback_data: `category:view:${child.id}` }]] });
      return;
    }
    await db.update(categories).set({ parentId: parent?.id ?? null, updatedAt: new Date().toISOString() }).where(eq(categories.id, child.id));
    await audit(db, adminId, "category.set_parent", child.id, { parentId: parent?.id ?? null });
    await sendCategoryDetails(db, token, chatId, child.id);
    return;
  }
  if (scope === "ca" && action && first) {
    const category = await resolveCategoryByPrefix(db, action);
    const productId = Number(first);
    const [product] = Number.isInteger(productId) ? await db.select({ id: catalogProducts.id }).from(catalogProducts).where(eq(catalogProducts.id, productId)).limit(1) : [];
    if (!category || !product) { await sendMessage(token, chatId, "Категория или товар не найдены.", backKeyboard()); return; }
    const [linked] = await db.select({ productId: productCategories.productId }).from(productCategories).where(and(eq(productCategories.categoryId, category.id), eq(productCategories.productId, productId))).limit(1);
    if (linked) await db.delete(productCategories).where(and(eq(productCategories.categoryId, category.id), eq(productCategories.productId, productId)));
    else await db.insert(productCategories).values({ categoryId: category.id, productId });
    await audit(db, adminId, linked ? "category.unassign" : "category.assign", category.id, { productId });
    await sendCategoryDetails(db, token, chatId, category.id);
    return;
  }
  if (scope === "category" && action === "field" && first && second) {
    const field = categoryFieldByCode[second as keyof typeof categoryFieldByCode];
    if (!field) return;
    await sendMessage(token, chatId, `[EDIT_CATEGORY:${first}:${field}]\nВведите новое значение поля ${field}:`, { force_reply: true, selective: true, input_field_placeholder: "Новое значение" });
    return;
  }
  if (scope === "category" && action === "delete_prompt" && first) {
    await sendMessage(token, chatId, "Точно удалить категорию? Это действие нельзя отменить.", { inline_keyboard: [[{ text: "Да, удалить", callback_data: `category:delete_confirm:${first}` }], [{ text: "Отмена", callback_data: `category:view:${first}` }]] });
    return;
  }
  if (scope === "category" && action === "view" && first) {
    await sendCategoryDetails(db, token, chatId, first);
    return;
  }
  if (scope === "category" && ["publish", "index", "archive", "restore", "delete_confirm", "assign", "unassign"].includes(action) && first) {
    const [category] = await db.select({ id: categories.id, slug: categories.slug, name: categories.name, isPublished: categories.isPublished, noindex: categories.noindex, archivedAt: categories.archivedAt }).from(categories).where(eq(categories.id, first)).limit(1);
    if (!category) { await sendMessage(token, chatId, "Категория не найдена.", backKeyboard()); return; }
    if (action === "publish") await db.update(categories).set({ isPublished: !category.isPublished, updatedAt: new Date().toISOString() }).where(eq(categories.id, first));
    if (action === "index") await db.update(categories).set({ noindex: !category.noindex, updatedAt: new Date().toISOString() }).where(eq(categories.id, first));
    if (action === "archive" || action === "restore") await db.update(categories).set({ archivedAt: action === "archive" ? new Date().toISOString() : null, isPublished: action === "archive" ? false : category.isPublished, updatedAt: new Date().toISOString() }).where(eq(categories.id, first));
    if (action === "delete_confirm") {
      const [linked] = await db.select({ productId: productCategories.productId }).from(productCategories).where(eq(productCategories.categoryId, first)).limit(1);
      if (linked) { await sendMessage(token, chatId, "Удаление запрещено: к категории привязаны товары.", { inline_keyboard: [[{ text: "◀️ К категории", callback_data: `category:view:${first}` }]] }); return; }
      const [child] = await db.select({ id: categories.id }).from(categories).where(eq(categories.parentId, first)).limit(1);
      if (child) { await sendMessage(token, chatId, "Удаление запрещено: у категории есть подкатегории.", { inline_keyboard: [[{ text: "◀️ К категории", callback_data: `category:view:${first}` }]] }); return; }
      await db.delete(categories).where(eq(categories.id, first));
      await audit(db, adminId, "category.delete", first, { slug: category.slug });
      await sendMessage(token, chatId, `Категория ${category.name} удалена.`, { inline_keyboard: [[{ text: "◀️ К списку", callback_data: "categories:list" }]] });
      return;
    }
    if ((action === "assign" || action === "unassign") && second) {
      const productId = Number(second);
      const [product] = Number.isInteger(productId) ? await db.select({ id: catalogProducts.id }).from(catalogProducts).where(eq(catalogProducts.id, productId)).limit(1) : [];
      if (!product) { await sendMessage(token, chatId, "Неизвестный товар."); return; }
      if (action === "assign") await db.insert(productCategories).values({ categoryId: first, productId }).onConflictDoNothing();
      else await db.delete(productCategories).where(and(eq(productCategories.categoryId, first), eq(productCategories.productId, productId)));
    }
    await audit(db, adminId, `category.${action}`, first, second ? { productId: Number(second) } : {});
    await sendCategoryDetails(db, token, chatId, first);
  }
}

export async function POST(request: Request) {
  const botEnv = process.env as BotEnvironment;
  const secret = botEnv.TELEGRAM_WEBHOOK_SECRET;
  const token = botEnv.TELEGRAM_BOT_TOKEN;
  if (!secret || !token) return new Response(null, { status: 503 });

  const suppliedSecret = request.headers.get("x-telegram-bot-api-secret-token") ?? "";
  if (!safeEqual(suppliedSecret, secret)) return new Response(null, { status: 401 });

  const contentLength = Number(request.headers.get("content-length") || 0);
  if (contentLength > 32_000) return new Response(null, { status: 413 });

  try {
    const parsed = updateSchema.safeParse(await request.json());
    if (!parsed.success) return Response.json({ ok: true });

    const message = parsed.data.message;
    const callback = parsed.data.callback_query;
    const from = message?.from ?? callback?.from;
    const chatId = message?.chat.id ?? callback?.message?.chat.id;
    if (!from || chatId === undefined) return Response.json({ ok: true });
    const allowedIds = new Set((botEnv.TELEGRAM_ADMIN_IDS ?? "").split(",").map((id) => id.trim()).filter(Boolean));
    if (!allowedIds.has(String(from.id))) return Response.json({ ok: true });

    if (callback) {
      await answerCallback(token, callback.id);
      if (callback.data) await handleCallback(token, chatId, from.id, callback.data);
      return Response.json({ ok: true });
    }

    let { text = "" } = message!;
    const replyContext = message?.reply_to_message?.text ?? "";
    if (await handleFulfillmentReply(token, chatId, from.id, message!.message_id, text, replyContext)) return Response.json({ ok: true });
    if (await handleCatalogAdminMessage({ token, chatId, adminId: from.id }, text, replyContext)) return Response.json({ ok: true });
    if (replyContext.startsWith("[CREATE_CATEGORY]")) {
      text = `/category_create ${text}`;
    } else {
      const editReply = replyContext.match(/^\[EDIT_CATEGORY:([^:]+):([^\]]+)\]/);
      if (editReply && editableCategoryFields.has(editReply[2])) {
        const db = getDb();
        const [category] = await db.select({ slug: categories.slug }).from(categories).where(eq(categories.id, editReply[1])).limit(1);
        if (!category) {
          await sendMessage(token, chatId, "Категория больше не существует.", backKeyboard());
          return Response.json({ ok: true });
        }
        text = `/category_set ${category.slug} ${editReply[2]} ${text}`;
      }
    }

    // Reply-keyboard labels are ordinary Telegram text messages. Convert them
    // to the same commands used by the existing handlers, but never while a
    // sensitive/admin input prompt is active.
    if (!replyContext) {
      const buttonCommand = adminButtonCommands[text.trim()];
      if (buttonCommand) text = buttonCommand;
    }

    const command = text.trim().split(/\s+/)[0].toLowerCase().split("@")[0];
    if (command === "/start" || command === "/help") {
      await sendAdminMenu(token, chatId);
    } else if (command === "/payment_requisites") {
      await handleCallback(token, chatId, from.id, "settings:payment");
    } else if (command === "/products") {
      await handleCatalogAdminCallback({ token, chatId, adminId: from.id }, "products:list");
    } else if (command === "/countries") {
      await handleCatalogAdminCallback({ token, chatId, adminId: from.id }, "countries:list");
    } else if (command === "/operators") {
      await handleCatalogAdminCallback({ token, chatId, adminId: from.id }, "operators:list");
    } else if (command === "/status") {
      const db = getDb();
      const recent = await db.select({ status: orders.status }).from(orders).orderBy(desc(orders.createdAt)).limit(100);
      const active = recent.filter((order) => !["COMPLETED", "CANCELLED", "REFUNDED", "FAILED"].includes(order.status)).length;
      await sendMessage(token, chatId, `SIMKA работает.\nЗаказов в последней выборке: ${recent.length}\nАктивных: ${active}`, backKeyboard());
    } else if (command === "/analytics") {
      await sendAnalyticsSummary(getDb(), token, chatId, 7);
    } else if (command === "/orders") {
      const db = getDb();
      const recent = await db.select({ orderNumber: orders.orderNumber, status: orders.status, totalAmount: orders.totalAmount, currency: orders.currency }).from(orders).orderBy(desc(orders.createdAt)).limit(5);
      const lines = recent.length ? recent.map((order) => `${order.orderNumber} · ${order.status} · ${order.totalAmount.toLocaleString("ru-RU")} ${order.currency}`).join("\n") : "Заказов пока нет.";
      await sendMessage(token, chatId, `Последние заказы:\n\n${lines}`, backKeyboard());
    } else if (command === "/paid") {
      const number = text.trim().split(/\s+/)[1]?.toUpperCase();
      if (!number) {
        await sendMessage(token, chatId, "Укажите номер: /paid SIM-YYYYMMDD-XXXXXXXX");
      } else {
        const db = getDb();
        const [order] = await db.select({ id: orders.id, status: orders.status, orderNumber: orders.orderNumber, paymentMethod: orders.paymentMethod, customerName: orders.customerName, customerEmail: orders.customerEmail, paymentInstructionsSentAt: orders.paymentInstructionsSentAt }).from(orders).where(eq(orders.orderNumber, number)).limit(1);
        if (!order) {
          await sendMessage(token, chatId, "Заказ не найден.");
        } else if (order.paymentMethod !== "manager") {
          await sendMessage(token, chatId, "Криптовалютную оплату может подтвердить только защищённый webhook платёжного провайдера.");
        } else if (order.status !== "WAITING_FOR_MANAGER") {
          await sendMessage(token, chatId, `Нельзя подтвердить заказ в статусе ${order.status}.`);
        } else if (!order.paymentInstructionsSentAt) {
          await sendMessage(token, chatId, "Сначала отправьте клиенту реквизиты кнопкой в карточке заказа.", orderBackKeyboard(order.orderNumber));
        } else {
          const pendingCost = await db.select({ id: orderItems.id }).from(orderItems).where(and(eq(orderItems.orderId, order.id), eq(orderItems.simType, "SIM"), eq(orderItems.deliveryCostConfirmed, false))).limit(1);
          if (pendingCost[0]) {
            await sendMessage(token, chatId, "Сначала укажите стоимость доставки всех физических SIM через карточку заказа.", orderBackKeyboard(order.orderNumber));
          } else {
            await db.update(orders).set({ status: "PAID", updatedAt: new Date().toISOString() }).where(eq(orders.id, order.id));
            const customerEmailDelivered = (await sendOrderStatusEmail(order, "PAID")).delivered;
            await reportOrderAnalytics(order.id, "PAID");
            await audit(db, from.id, "order.payment_confirmed", order.id, { orderNumber: order.orderNumber, method: "manager", customerEmailDelivered });
            await sendMessage(token, chatId, `Оплата подтверждена. Заказ ${order.orderNumber} → PAID.${customerEmailDelivered ? " Клиенту отправлено письмо." : " Письмо клиенту не доставлено."}`);
          }
        }
      }
    } else if (command === "/categories") {
      const db = getDb();
      const list = await db.select({ name: categories.name, slug: categories.slug, isPublished: categories.isPublished, noindex: categories.noindex, archivedAt: categories.archivedAt, sortOrder: categories.sortOrder }).from(categories).orderBy(categories.sortOrder, categories.name);
      const lines = list.length ? list.map((category) => `${category.sortOrder}. ${category.name} (${category.slug}) · ${category.archivedAt ? "ARCHIVED" : category.isPublished ? "PUBLISHED" : "DRAFT"} · ${category.noindex ? "NOINDEX" : "INDEX"}`).join("\n") : "Категорий пока нет.";
      await sendMessage(token, chatId, `Категории:\n\n${lines}`, mainKeyboard());
    } else if (command === "/category_create") {
      const parts = text.slice(command.length).trim().split("|").map((part) => part.trim());
      const [slug, name, description = ""] = parts;
      if (!slug || !name || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || slug.length > 120 || name.length > 160) {
        await sendMessage(token, chatId, "Формат: /category_create slug | Название | Описание\nSlug: латиница, цифры и дефисы.");
      } else if (reservedCategorySlugs.has(slug)) {
        await sendMessage(token, chatId, `Slug ${slug} зарезервирован системной категорией. Выберите другой slug.`);
      } else {
        const db = getDb();
        const [existing] = await db.select({ id: categories.id }).from(categories).where(eq(categories.slug, slug)).limit(1);
        if (existing) await sendMessage(token, chatId, `Категория со slug ${slug} уже существует.`);
        else {
          const id = crypto.randomUUID();
          await db.insert(categories).values({ id, slug, name, description, noindex: true, isPublished: false, sortOrder: 0 });
          await audit(db, from.id, "category.create", id, { slug, name });
          await sendMessage(token, chatId, `Категория создана: ${name} (${slug}). По умолчанию скрыта и закрыта от индексации.`, { inline_keyboard: [[{ text: "📂 Открыть список", callback_data: "categories:list" }]] });
        }
      }
    } else if (command === "/category_set") {
      const match = text.trim().match(/^\/category_set\s+(\S+)\s+(\S+)\s+([\s\S]+)$/i);
      if (!match || !editableCategoryFields.has(match[2])) {
        await sendMessage(token, chatId, "Формат: /category_set slug field value\nДопустимые field перечислены в /help.");
      } else {
        const [, slug, field, rawValue] = match;
        const db = getDb();
        const [category] = await db.select({ id: categories.id, slug: categories.slug }).from(categories).where(eq(categories.slug, slug)).limit(1);
        if (!category) await sendMessage(token, chatId, "Категория не найдена.");
        else {
          const trimmedValue = rawValue.trim();
          const value: string | number | null = field === "sort_order" ? Number(rawValue) : nullableCategoryFields.has(field) && trimmedValue === "-" ? null : trimmedValue;
          const numericValue = typeof value === "number" ? value : Number.NaN;
          if (field === "sort_order" && (!Number.isInteger(numericValue) || numericValue < 0 || numericValue > 100000)) {
            await sendMessage(token, chatId, "sort_order должен быть целым числом от 0 до 100000.");
          } else if (field === "slug" && (typeof value !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value) || value.length > 120)) {
            await sendMessage(token, chatId, "Slug должен содержать только латинские буквы, цифры и дефисы.");
          } else if (field === "slug" && typeof value === "string" && reservedCategorySlugs.has(value)) {
            await sendMessage(token, chatId, `Slug ${value} зарезервирован системной категорией.`);
          } else if (field === "name" && (typeof value !== "string" || !value || value.length > 160)) {
            await sendMessage(token, chatId, "Название должно содержать от 1 до 160 символов.");
          } else if (["seo_title", "h1", "og_title"].includes(field) && typeof value === "string" && value.length > 300) {
            await sendMessage(token, chatId, "Значение слишком длинное: максимум 300 символов.");
          } else if (["seo_description", "og_description"].includes(field) && typeof value === "string" && value.length > 1000) {
            await sendMessage(token, chatId, "Описание слишком длинное: максимум 1000 символов.");
          } else if (["description", "seo_text"].includes(field) && typeof value === "string" && value.length > 4000) {
            await sendMessage(token, chatId, "Текст слишком длинный: максимум 4000 символов.");
          } else if (["image_url", "og_image"].includes(field) && typeof value === "string" && !validAdminUrl(value)) {
            await sendMessage(token, chatId, "Укажите полный URL изображения с http:// или https:// либо отправьте - для очистки.");
          } else if (field === "canonical_url" && typeof value === "string" && !validAdminUrl(value, true)) {
            await sendMessage(token, chatId, "Canonical должен быть полным http(s)-URL или относительным путём, начинающимся с /.");
          } else {
            const [conflict] = field === "slug" && typeof value === "string" ? await db.select({ id: categories.id }).from(categories).where(eq(categories.slug, value)).limit(1) : [];
            if (conflict && conflict.id !== category.id) await sendMessage(token, chatId, `Категория со slug ${value} уже существует.`);
            else {
              const update: Record<string, unknown> = { updatedAt: new Date().toISOString(), [field.replaceAll("_", "")] : value };
              const columnMap: Record<string, string> = { image_url: "imageUrl", seo_title: "seoTitle", seo_description: "seoDescription", seo_text: "seoText", canonical_url: "canonicalUrl", og_title: "ogTitle", og_description: "ogDescription", og_image: "ogImage", sort_order: "sortOrder" };
              const key = columnMap[field] ?? field;
              delete update[field.replaceAll("_", "")];
              update[key] = value;
              await db.update(categories).set(update as typeof categories.$inferInsert).where(eq(categories.id, category.id));
              if (field === "slug" && typeof value === "string") await recordSlugRedirect("category", category.id, category.slug, value);
              await audit(db, from.id, "category.update", category.id, { field, value });
              await sendMessage(token, chatId, `Категория ${slug}: поле ${field} обновлено.`);
            }
          }
        }
      }
    } else if (command === "/category_publish" || command === "/category_index") {
      const args = text.trim().split(/\s+/);
      const slug = args[1];
      const choice = args[2]?.toLowerCase();
      const isPublish = command === "/category_publish";
      const valid = isPublish ? ["on", "off"] : ["index", "noindex"];
      if (!slug || !valid.includes(choice)) {
        await sendMessage(token, chatId, isPublish ? "Формат: /category_publish slug on|off" : "Формат: /category_index slug index|noindex");
      } else {
        const db = getDb();
        const [category] = await db.select({ id: categories.id }).from(categories).where(eq(categories.slug, slug)).limit(1);
        if (!category) await sendMessage(token, chatId, "Категория не найдена.");
        else {
          const update = isPublish ? { isPublished: choice === "on", updatedAt: new Date().toISOString() } : { noindex: choice === "noindex", updatedAt: new Date().toISOString() };
          await db.update(categories).set(update).where(eq(categories.id, category.id));
          await audit(db, from.id, isPublish ? "category.publish" : "category.indexation", category.id, { value: choice });
          await sendMessage(token, chatId, `Категория ${slug}: ${isPublish ? (choice === "on" ? "опубликована" : "снята с публикации") : (choice === "index" ? "открыта для индексации" : "закрыта от индексации")}.`);
        }
      }
    } else if (["/category_archive", "/category_restore"].includes(command)) {
      const slug = text.trim().split(/\s+/)[1];
      if (!slug) await sendMessage(token, chatId, `Формат: ${command} slug`);
      else {
        const db = getDb();
        const [category] = await db.select({ id: categories.id }).from(categories).where(eq(categories.slug, slug)).limit(1);
        if (!category) await sendMessage(token, chatId, "Категория не найдена.");
        else {
          const archived = command === "/category_archive";
          await db.update(categories).set({ archivedAt: archived ? new Date().toISOString() : null, isPublished: archived ? false : undefined, updatedAt: new Date().toISOString() }).where(eq(categories.id, category.id));
          await audit(db, from.id, archived ? "category.archive" : "category.restore", category.id);
          await sendMessage(token, chatId, archived ? `Категория ${slug} архивирована.` : `Категория ${slug} восстановлена.`);
        }
      }
    } else if (command === "/category_delete") {
      const slug = text.trim().split(/\s+/)[1];
      if (!slug) await sendMessage(token, chatId, "Формат: /category_delete slug");
      else {
        const db = getDb();
        const [category] = await db.select({ id: categories.id }).from(categories).where(eq(categories.slug, slug)).limit(1);
        if (!category) await sendMessage(token, chatId, "Категория не найдена.");
        else {
          const [linked] = await db.select({ productId: productCategories.productId }).from(productCategories).where(eq(productCategories.categoryId, category.id)).limit(1);
          if (linked) await sendMessage(token, chatId, "Нельзя удалить категорию: к ней привязаны товары. Сначала используйте /category_unassign.");
          else {
            const [child] = await db.select({ id: categories.id }).from(categories).where(eq(categories.parentId, category.id)).limit(1);
            if (child) await sendMessage(token, chatId, "Нельзя удалить категорию: у неё есть подкатегории.");
            else {
              await db.delete(categories).where(eq(categories.id, category.id));
              await audit(db, from.id, "category.delete", category.id, { slug });
              await sendMessage(token, chatId, `Категория ${slug} удалена.`);
            }
          }
        }
      }
    } else if (command === "/category_assign" || command === "/category_unassign") {
      const args = text.trim().split(/\s+/);
      const slug = args[1];
      const productId = Number(args[2]);
      if (!slug || !Number.isInteger(productId)) {
        await sendMessage(token, chatId, `Формат: ${command} slug productId`);
      } else {
        const db = getDb();
        const [product] = await db.select({ id: catalogProducts.id }).from(catalogProducts).where(eq(catalogProducts.id, productId)).limit(1);
        const [category] = await db.select({ id: categories.id }).from(categories).where(eq(categories.slug, slug)).limit(1);
        if (!product) await sendMessage(token, chatId, "Товар не найден.");
        else if (!category) await sendMessage(token, chatId, "Категория не найдена.");
        else if (command === "/category_assign") {
          await db.insert(productCategories).values({ categoryId: category.id, productId }).onConflictDoNothing();
          await audit(db, from.id, "category.assign_product", category.id, { productId });
          await sendMessage(token, chatId, `Товар ${productId} назначен категории ${slug}.`);
        } else {
          await db.delete(productCategories).where(and(eq(productCategories.categoryId, category.id), eq(productCategories.productId, productId)));
          await audit(db, from.id, "category.unassign_product", category.id, { productId });
          await sendMessage(token, chatId, `Товар ${productId} снят с категории ${slug}.`);
        }
      }
    } else {
      await sendMessage(token, chatId, "Неизвестная команда. Откройте меню кнопкой /start.");
    }
    return Response.json({ ok: true });
  } catch (error) {
    console.error("telegram_webhook_failed", { name: error instanceof Error ? error.name : "UnknownError" });
    return new Response(null, { status: 500 });
  }
}
