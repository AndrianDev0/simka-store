import { createHash } from "node:crypto";
import { and, asc, desc, eq, gte, inArray, isNull, like, lt, notInArray, or, sql } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db";
import { adminAuditLog, catalogProducts, categories, countries, customerAccounts, customerPasswordResets, customerSessions, operationalEvents, orderItems, orders, productCategories, productVariants, promoCodes, searchAnalytics, storeSettings } from "@/db/schema";
import { formatPercentage, formatRelativeChange, percentage } from "@/lib/analytics-comparison";
import { createEncryptedDatabaseBackup } from "@/lib/database-backup";
import { csvCell } from "@/lib/csv";
import { escapeHtml, getEmailConfigurationStatus, sendTransactionalEmail } from "@/lib/email";
import { getEmailValidationError } from "@/lib/email-validation";
import { decryptFulfillmentSecret, encryptFulfillmentSecret } from "@/lib/fulfillment-secrets";
import { releaseReservedInventory } from "@/lib/order-inventory";
import { recordOperationalEvent } from "@/lib/operational-events";
import { isIgnoredOperationalPath } from "@/lib/operational-event-shape";
import { isValidPromoCodeFormat, normalizePromoCode } from "@/lib/promo-codes";
import { formatSalesByCurrency } from "@/lib/sales-analytics";
import { SITE_ORIGIN } from "@/lib/seo";
import { recordSlugRedirect } from "@/lib/slug-redirects";
import { sendOrderAnalytics } from "@/lib/server-analytics";
import { handleCatalogAdminCallback, handleCatalogAdminMessage } from "@/lib/telegram-catalog-admin";
import {
  resolveTelegramRole,
  telegramCallbackPermission,
  telegramCommandPermission,
  telegramReplyPermission,
  telegramRoleCan,
  telegramRoleLabels,
  type TelegramPermission,
  type TelegramRole,
} from "@/lib/telegram-rbac";

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
  TELEGRAM_ADMIN_ROLES?: string;
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

async function sendDocument(token: string, chatId: number, data: Buffer, filename: string, caption: string, mimeType = "application/json") {
  const form = new FormData();
  form.set("chat_id", String(chatId));
  form.set("caption", caption);
  form.set("document", new Blob([new Uint8Array(data)], { type: mimeType }), filename);
  const response = await fetch(`https://api.telegram.org/bot${token}/sendDocument`, { method: "POST", body: form, signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error("TELEGRAM_DOCUMENT_SEND_FAILED");
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

function mainKeyboard(role: TelegramRole): InlineKeyboard {
  const rows: InlineKeyboard["inline_keyboard"] = [];
  if (telegramRoleCan(role, "catalog.read")) {
    rows.push([{ text: "📦 Товары", callback_data: "products:list" }, { text: "📂 Категории", callback_data: "categories:list" }]);
    rows.push([{ text: "🌍 Страны", callback_data: "countries:list" }, { text: "📡 Операторы", callback_data: "operators:list" }]);
  }
  const operations: InlineButton[] = [];
  if (telegramRoleCan(role, "orders.read")) operations.push({ text: "🛒 Заказы", callback_data: "orders:list" });
  if (telegramRoleCan(role, "settings.read")) operations.push({ text: "💳 Реквизиты", callback_data: "settings:payment" });
  if (operations.length) rows.push(operations);
  const peopleAndEmail: InlineButton[] = [];
  if (telegramRoleCan(role, "customers.read")) peopleAndEmail.push({ text: "👥 Клиенты", callback_data: "customers:list" });
  if (telegramRoleCan(role, "settings.read")) peopleAndEmail.push({ text: "✉️ Почта", callback_data: "settings:email" });
  if (peopleAndEmail.length) rows.push(peopleAndEmail);
  const insights: InlineButton[] = [];
  if (telegramRoleCan(role, "analytics.read")) insights.push({ text: "📈 Аналитика", callback_data: "analytics:period:7" });
  if (telegramRoleCan(role, "promocodes.read")) insights.push({ text: "🎟 Промокоды", callback_data: "promocodes:list" });
  if (telegramRoleCan(role, "operations.read")) insights.push({ text: "📊 Статус", callback_data: "status" });
  for (let index = 0; index < insights.length; index += 2) rows.push(insights.slice(index, index + 2));
  const control: InlineButton[] = [];
  if (telegramRoleCan(role, "operations.read")) control.push({ text: "⚠️ Ошибки", callback_data: "errors:period:24" });
  if (telegramRoleCan(role, "audit.read")) control.push({ text: "📋 Журнал действий", callback_data: "audit:list:0" });
  if (control.length) rows.push(control);
  if (telegramRoleCan(role, "backup.create")) rows.push([{ text: "🗄 Резервная копия", callback_data: "backup:prompt" }]);
  return { inline_keyboard: rows };
}

function persistentKeyboard(role: TelegramRole): ReplyKeyboard {
  const rows: ReplyKeyboard["keyboard"] = [];
  if (telegramRoleCan(role, "catalog.read")) {
    rows.push([{ text: "📦 Товары" }, { text: "📂 Категории" }]);
    rows.push([{ text: "🌍 Страны" }, { text: "📡 Операторы" }]);
  }
  const operations: Array<{ text: string }> = [];
  if (telegramRoleCan(role, "orders.read")) operations.push({ text: "🛒 Заказы" });
  if (telegramRoleCan(role, "settings.read")) operations.push({ text: "💳 Реквизиты" });
  if (operations.length) rows.push(operations);
  const peopleAndEmail: Array<{ text: string }> = [];
  if (telegramRoleCan(role, "customers.read")) peopleAndEmail.push({ text: "👥 Клиенты" });
  if (telegramRoleCan(role, "settings.read")) peopleAndEmail.push({ text: "✉️ Почта" });
  if (peopleAndEmail.length) rows.push(peopleAndEmail);
  const insights: Array<{ text: string }> = [];
  if (telegramRoleCan(role, "analytics.read")) insights.push({ text: "📈 Аналитика" });
  if (telegramRoleCan(role, "promocodes.read")) insights.push({ text: "🎟 Промокоды" });
  if (telegramRoleCan(role, "operations.read")) insights.push({ text: "📊 Статус магазина" });
  for (let index = 0; index < insights.length; index += 2) rows.push(insights.slice(index, index + 2));
  const control: Array<{ text: string }> = [];
  if (telegramRoleCan(role, "operations.read")) control.push({ text: "⚠️ Ошибки" });
  if (telegramRoleCan(role, "audit.read")) control.push({ text: "📋 Журнал действий" });
  if (control.length) rows.push(control);
  if (telegramRoleCan(role, "backup.create")) rows.push([{ text: "🗄 Резервная копия" }]);
  rows.push([{ text: "🏠 Меню" }]);
  return {
    keyboard: rows,
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
  "👥 Клиенты": "/customers",
  "💳 Реквизиты": "/payment_requisites",
  "📈 Аналитика": "/analytics",
  "🎟 Промокоды": "/promocodes",
  "📊 Статус магазина": "/status",
  "📋 Журнал действий": "/audit",
  "⚠️ Ошибки": "/errors",
  "🗄 Резервная копия": "/backup",
  "✉️ Почта": "/email",
  "🏠 Меню": "/start",
};

async function sendAdminMenu(token: string, chatId: number, role: TelegramRole) {
  await sendMessage(token, chatId, `Панель управления SIMKA\nРоль: ${telegramRoleLabels[role]}`, persistentKeyboard(role));
  await sendMessage(token, chatId, "Выберите доступный раздел:", mainKeyboard(role));
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

function orderListKeyboard(list: Array<{ orderNumber: string; status: string }>, page = 0, filter = "active", hasNext = false): InlineKeyboard {
  const navigation: Array<InlineButton> = [];
  if (page > 0) navigation.push({ text: "⬅️", callback_data: `orders:list:${page - 1}:${filter}` });
  navigation.push({ text: `${page + 1}`, callback_data: `orders:list:${page}:${filter}` });
  if (hasNext) navigation.push({ text: "➡️", callback_data: `orders:list:${page + 1}:${filter}` });
  return { inline_keyboard: [
    ...list.map((order) => [{ text: `${order.status === "WAITING_FOR_MANAGER" ? "🟡" : order.status === "PAID" ? "🟢" : "📦"} ${order.orderNumber}`, callback_data: `order:view:${order.orderNumber}` }]),
    [{ text: `${filter === "active" ? "✅ " : ""}Активные`, callback_data: "orders:list:0:active" }, { text: `${filter === "all" ? "✅ " : ""}Все`, callback_data: "orders:list:0:all" }],
    [{ text: `${filter === "PAID" ? "✅ " : ""}Оплачены`, callback_data: "orders:list:0:PAID" }, { text: `${filter === "CANCELLED" ? "✅ " : ""}Отменены`, callback_data: "orders:list:0:CANCELLED" }],
    [{ text: `${filter === "REFUNDED" ? "✅ " : ""}Возвраты`, callback_data: "orders:list:0:REFUNDED" }, { text: `${filter === "FAILED" ? "✅ " : ""}Ошибки`, callback_data: "orders:list:0:FAILED" }],
    navigation,
    [{ text: "🔎 Найти по номеру", callback_data: "orders:search" }],
    [{ text: "◀️ В меню", callback_data: "menu" }],
  ] };
}

async function sendOrdersPage(db: ReturnType<typeof getDb>, token: string, chatId: number, requestedPage = 0, requestedFilter = "active") {
  const pageSize = 6;
  const page = Number.isInteger(requestedPage) && requestedPage >= 0 ? Math.min(requestedPage, 10000) : 0;
  const allowedFilters = new Set(["active", "all", "PAID", "CANCELLED", "REFUNDED", "FAILED"]);
  const filter = allowedFilters.has(requestedFilter) ? requestedFilter : "active";
  const selection = { orderNumber: orders.orderNumber, status: orders.status, totalAmount: orders.totalAmount, currency: orders.currency };
  const query = db.select(selection).from(orders);
  const rows = filter === "all"
    ? await query.orderBy(desc(orders.createdAt)).limit(pageSize + 1).offset(page * pageSize)
    : await query.where(filter === "active" ? inArray(orders.status, [...activeOrderStatuses]) : eq(orders.status, filter)).orderBy(desc(orders.createdAt)).limit(pageSize + 1).offset(page * pageSize);
  const hasNext = rows.length > pageSize;
  const list = rows.slice(0, pageSize);
  const labels: Record<string, string> = { active: "активные", all: "все", PAID: "оплаченные", CANCELLED: "отменённые", REFUNDED: "возвраты", FAILED: "ошибки" };
  const lines = list.length ? list.map((order) => `${order.orderNumber} · ${order.status} · ${order.totalAmount.toLocaleString("ru-RU")} ${order.currency}`).join("\n") : "В этой группе заказов нет.";
  await sendMessage(token, chatId, `Заказы: ${labels[filter]} · страница ${page + 1}\n\n${lines}`, orderListKeyboard(list, page, filter, hasNext));
}

async function sendCustomersPage(db: ReturnType<typeof getDb>, token: string, chatId: number, requestedPage = 0) {
  const pageSize = 6;
  const page = Number.isInteger(requestedPage) && requestedPage >= 0 ? Math.min(requestedPage, 10000) : 0;
  const rows = await db.select({ id: customerAccounts.id, name: customerAccounts.name, email: customerAccounts.email, isBlocked: customerAccounts.isBlocked }).from(customerAccounts).orderBy(desc(customerAccounts.createdAt)).limit(pageSize + 1).offset(page * pageSize);
  const hasNext = rows.length > pageSize;
  const list = rows.slice(0, pageSize);
  const navigation: Array<InlineButton> = [];
  if (page > 0) navigation.push({ text: "⬅️", callback_data: `customers:list:${page - 1}` });
  navigation.push({ text: `${page + 1}`, callback_data: `customers:list:${page}` });
  if (hasNext) navigation.push({ text: "➡️", callback_data: `customers:list:${page + 1}` });
  const keyboard: InlineKeyboard = { inline_keyboard: [
    ...list.map((customer) => [{ text: `${customer.isBlocked ? "⛔" : "👤"} ${customer.name.slice(0, 24)}`, callback_data: `customer:view:${customer.id}` }]),
    navigation,
    [{ text: "🔎 Найти по email", callback_data: "customers:search" }],
    [{ text: "◀️ В меню", callback_data: "menu" }],
  ] };
  const lines = list.length ? list.map((customer) => `${customer.isBlocked ? "⛔" : "✅"} ${customer.name} · ${customer.email}`).join("\n") : "Клиентов пока нет.";
  await sendMessage(token, chatId, `Клиенты · страница ${page + 1}\n\n${lines}`, keyboard);
}

async function sendCustomerDetails(db: ReturnType<typeof getDb>, token: string, chatId: number, customerId: string, role: TelegramRole) {
  const [customer] = await db.select({ id: customerAccounts.id, name: customerAccounts.name, email: customerAccounts.email, contact: customerAccounts.contact, isBlocked: customerAccounts.isBlocked, blockedAt: customerAccounts.blockedAt, createdAt: customerAccounts.createdAt }).from(customerAccounts).where(eq(customerAccounts.id, customerId)).limit(1);
  if (!customer) { await sendMessage(token, chatId, "Клиент не найден.", backKeyboard()); return; }
  const [customerOrders, sessions] = await Promise.all([
    db.select({ orderNumber: orders.orderNumber, status: orders.status, totalAmount: orders.totalAmount, currency: orders.currency }).from(orders).where(eq(orders.customerAccountId, customer.id)).orderBy(desc(orders.createdAt)).limit(5),
    db.select({ id: customerSessions.id }).from(customerSessions).where(eq(customerSessions.accountId, customer.id)),
  ]);
  const orderLines = customerOrders.length ? customerOrders.map((order) => `• ${order.orderNumber} · ${order.status} · ${order.totalAmount.toLocaleString("ru-RU")} ${order.currency}`).join("\n") : "• Заказов нет";
  const actions: InlineKeyboard["inline_keyboard"] = [];
  if (telegramRoleCan(role, "customers.write")) {
    actions.push(customer.isBlocked
      ? [{ text: "✅ Разблокировать", callback_data: `customer:unblock:${customer.id}` }]
      : [{ text: "⛔ Заблокировать", callback_data: `customer:block_prompt:${customer.id}` }]);
    actions.push([{ text: "🚪 Завершить все сессии", callback_data: `customer:logout_prompt:${customer.id}` }]);
    actions.push([{ text: "✏️ Изменить имя", callback_data: `customer:edit:${customer.id}:name` }, { text: "✏️ Изменить контакт", callback_data: `customer:edit:${customer.id}:contact` }]);
    actions.push([{ text: "✏️ Изменить email", callback_data: `customer:edit:${customer.id}:email` }]);
  }
  if (telegramRoleCan(role, "customers.export")) actions.push([{ text: "📤 Экспорт данных", callback_data: `customer:export:${customer.id}` }]);
  if (telegramRoleCan(role, "customers.delete")) actions.push([{ text: "🗑 Удалить аккаунт", callback_data: `customer:delete_prompt:${customer.id}` }]);
  actions.push([{ text: "◀️ К клиентам", callback_data: "customers:list" }]);
  const privateAccountLines = role === "support"
    ? []
    : [
        `Активных/сохранённых сессий: ${sessions.length}`,
        `Регистрация: ${customer.createdAt}`,
      ];
  await sendMessage(token, chatId, [
    `👤 ${customer.name}`,
    `Email: ${customer.email}`,
    `Контакт: ${customer.contact || "не указан"}`,
    `Статус: ${customer.isBlocked ? `ЗАБЛОКИРОВАН${customer.blockedAt ? ` (${customer.blockedAt})` : ""}` : "активен"}`,
    ...privateAccountLines,
    "",
    "Последние заказы:",
    orderLines,
  ].join("\n"), { inline_keyboard: actions });
}

const successfulPromoStatuses = new Set(["PAID", "PROCESSING", "SHIPPED", "DELIVERED", "COMPLETED"]);

function promoDiscountLabel(promo: { discountType: string; discountValue: number; currency: string }) {
  return promo.discountType === "percent" ? `${promo.discountValue}%` : `${promo.discountValue.toLocaleString("ru-RU")} ${promo.currency}`;
}

async function sendPromoCodes(db: ReturnType<typeof getDb>, token: string, chatId: number, role: TelegramRole) {
  const list = await db.select().from(promoCodes).orderBy(desc(promoCodes.createdAt)).limit(50);
  const rows: InlineKeyboard["inline_keyboard"] = list.map((promo) => [{ text: `${promo.active ? "🟢" : "⚪"} ${promo.code} · ${promoDiscountLabel(promo)}`, callback_data: `promocodes:view:${promo.id}` }]);
  if (telegramRoleCan(role, "promocodes.write")) rows.push([{ text: "➕ Создать промокод", callback_data: "promocodes:create" }]);
  rows.push([{ text: "📊 Общая аналитика", callback_data: "promocodes:analytics" }]);
  rows.push([{ text: "◀️ В меню", callback_data: "menu" }]);
  await sendMessage(token, chatId, list.length ? `Промокоды: ${list.length}\n\n🟢 активен · ⚪ отключён` : "Промокодов пока нет.", { inline_keyboard: rows });
}

async function sendPromoDetails(db: ReturnType<typeof getDb>, token: string, chatId: number, promoId: string, role: TelegramRole) {
  const [promo] = await db.select().from(promoCodes).where(eq(promoCodes.id, promoId)).limit(1);
  if (!promo) { await sendMessage(token, chatId, "Промокод не найден.", backKeyboard()); return; }
  const promoOrders = await db.select({ status: orders.status, totalAmount: orders.totalAmount, discountAmount: orders.discountAmount }).from(orders).where(eq(orders.promoCode, promo.code));
  const paid = promoOrders.filter((order) => successfulPromoStatuses.has(order.status));
  const revenue = paid.reduce((sum, order) => sum + order.totalAmount, 0);
  const paidDiscount = paid.reduce((sum, order) => sum + order.discountAmount, 0);
  const actions: InlineKeyboard["inline_keyboard"] = [];
  if (telegramRoleCan(role, "promocodes.write")) actions.push([{ text: promo.active ? "⏸ Отключить" : "▶️ Включить", callback_data: `promocodes:toggle:${promo.id}` }]);
  actions.push([{ text: "◀️ К промокодам", callback_data: "promocodes:list" }]);
  await sendMessage(token, chatId, [
    `🎟 ${promo.code}`,
    `Статус: ${promo.active ? "активен" : "отключён"}`,
    `Скидка: ${promoDiscountLabel(promo)}`,
    `Минимальная сумма: ${promo.minOrderAmount.toLocaleString("ru-RU")} ${promo.currency}`,
    `Лимит: ${promo.usageLimit ?? "без ограничений"}`,
    `Начало: ${promo.startsAt ? new Date(promo.startsAt).toLocaleDateString("ru-RU") : "сразу"}`,
    `Окончание: ${promo.endsAt ? new Date(promo.endsAt).toLocaleDateString("ru-RU") : "без срока"}`,
    "",
    `Заказов с кодом: ${promoOrders.length}`,
    `Оплаченных заказов: ${paid.length}`,
    `Оборот: ${revenue.toLocaleString("ru-RU")} ${promo.currency}`,
    `Скидок в оплаченных: ${paidDiscount.toLocaleString("ru-RU")} ${promo.currency}`,
  ].join("\n"), { inline_keyboard: actions });
}

async function sendPromoAnalytics(db: ReturnType<typeof getDb>, token: string, chatId: number) {
  const [list, promoOrders] = await Promise.all([
    db.select().from(promoCodes).orderBy(desc(promoCodes.createdAt)).limit(50),
    db.select({ promoCode: orders.promoCode, status: orders.status, totalAmount: orders.totalAmount, discountAmount: orders.discountAmount, currency: orders.currency }).from(orders).where(sql`${orders.promoCode} IS NOT NULL`),
  ]);
  const lines = list.map((promo) => {
    const related = promoOrders.filter((order) => order.promoCode === promo.code);
    const paid = related.filter((order) => successfulPromoStatuses.has(order.status));
    const revenue = paid.reduce((sum, order) => sum + order.totalAmount, 0);
    const discounts = paid.reduce((sum, order) => sum + order.discountAmount, 0);
    return `${promo.active ? "🟢" : "⚪"} ${promo.code}: ${related.length} заказов · ${paid.length} оплачено · оборот ${revenue.toLocaleString("ru-RU")} ${promo.currency} · скидки ${discounts.toLocaleString("ru-RU")} ${promo.currency}`;
  });
  await sendMessage(token, chatId, ["📊 Аналитика промокодов", "", ...(lines.length ? lines : ["Пока нет данных."])].join("\n"), { inline_keyboard: [[{ text: "◀️ К промокодам", callback_data: "promocodes:list" }]] });
}

function analyticsKeyboard(selectedDays: number, role: TelegramRole): InlineKeyboard {
  const button = (label: string, days: number) => ({ text: `${selectedDays === days ? "✅ " : ""}${label}`, callback_data: `analytics:period:${days}` });
  const rows: InlineKeyboard["inline_keyboard"] = [
    [button("24 часа", 1), button("7 дней", 7), button("30 дней", 30)],
    [button("Всё время", 0)],
    [{ text: "🔄 Обновить", callback_data: `analytics:period:${selectedDays}` }],
    [{ text: "📦 По товарам", callback_data: `analytics:products:${selectedDays}` }, { text: "🌍 По странам", callback_data: `analytics:countries:${selectedDays}` }],
    [{ text: "🔎 Внутренний поиск", callback_data: `analytics:search:${selectedDays}` }],
  ];
  if (telegramRoleCan(role, "analytics.export")) rows.push([{ text: "📥 Скачать CSV", callback_data: `analytics:csv:${selectedDays}` }]);
  if (telegramRoleCan(role, "orders.read")) rows.push([{ text: "🛒 Последние заказы", callback_data: "orders:list" }]);
  rows.push([{ text: "◀️ В меню", callback_data: "menu" }]);
  return { inline_keyboard: rows };
}

async function sendAnalyticsCsv(db: ReturnType<typeof getDb>, token: string, chatId: number, adminId: number, days: number) {
  const normalizedDays = [0, 1, 7, 30].includes(days) ? days : 7;
  const selection = {
    orderNumber: orders.orderNumber,
    createdAt: orders.createdAt,
    status: orders.status,
    paidAt: orders.paidAt,
    paymentMethod: orders.paymentMethod,
    subtotalAmount: orders.subtotalAmount,
    promoCode: orders.promoCode,
    discountAmount: orders.discountAmount,
    deliveryAmount: orders.deliveryAmount,
    totalAmount: orders.totalAmount,
    currency: orders.currency,
    source: orders.analyticsSource,
    medium: orders.analyticsMedium,
    campaign: orders.analyticsCampaign,
  };
  const rows = normalizedDays
    ? await db.select(selection).from(orders).where(sql`${orders.createdAt}::timestamptz >= ${new Date(Date.now() - normalizedDays * 86_400_000).toISOString()}::timestamptz`).orderBy(desc(orders.createdAt)).limit(5_000)
    : await db.select(selection).from(orders).orderBy(desc(orders.createdAt)).limit(5_000);
  const header = ["order_number", "created_at_utc", "paid_at_utc", "status", "payment_method", "subtotal", "promo_code", "discount", "delivery", "total", "currency", "utm_source", "utm_medium", "utm_campaign"];
  const csv = [header.map(csvCell).join(","), ...rows.map((row) => [row.orderNumber, row.createdAt, row.paidAt, row.status, row.paymentMethod, row.subtotalAmount, row.promoCode, row.discountAmount, row.deliveryAmount, row.totalAmount, row.currency, row.source, row.medium, row.campaign].map(csvCell).join(","))].join("\r\n");
  const suffix = normalizedDays ? `${normalizedDays}d` : "all";
  await sendDocument(token, chatId, Buffer.from(`\uFEFF${csv}`, "utf8"), `simka-orders-${suffix}-${new Date().toISOString().slice(0, 10)}.csv`, `Обезличенный отчёт SIMKA ${analyticsPeriod(normalizedDays)} · строк: ${rows.length}${rows.length === 5_000 ? " (показаны последние 5000)" : ""}.`, "text/csv; charset=utf-8");
  await audit(db, adminId, "analytics.export", null, { days: normalizedDays, rows: rows.length, format: "csv" });
}

function analyticsPeriod(days: number) {
  return days === 0 ? "за всё время" : days === 1 ? "за последние 24 часа" : `за последние ${days} дней`;
}

async function sendProductAnalytics(db: ReturnType<typeof getDb>, token: string, chatId: number, days: number) {
  const normalizedDays = [0, 1, 7, 30].includes(days) ? days : 7;
  const paidStatuses = [...paidOrderStatuses];
  const conditions = [inArray(orders.status, paidStatuses)];
  if (normalizedDays) conditions.push(sql`COALESCE(${orders.paidAt}, ${orders.createdAt})::timestamptz >= ${new Date(Date.now() - normalizedDays * 86_400_000).toISOString()}::timestamptz`);
  const rows = await db.select({ productName: orderItems.productName, sku: orderItems.sku, quantity: orderItems.quantity, unitPrice: orderItems.unitPrice, currency: orders.currency }).from(orderItems).innerJoin(orders, eq(orderItems.orderId, orders.id)).where(and(...conditions));
  const lines = formatSalesByCurrency(rows.map((row) => ({ label: row.sku || row.productName, currency: row.currency, quantity: row.quantity, revenue: row.unitPrice * row.quantity })), "Оплаченных товаров пока нет.");
  await sendMessage(token, chatId, `📦 Продажи по товарам ${analyticsPeriod(normalizedDays)}\n\n${lines}`, { inline_keyboard: [[{ text: "📈 Общая аналитика", callback_data: `analytics:period:${normalizedDays}` }], [{ text: "◀️ В меню", callback_data: "menu" }]] });
}

async function sendCountryAnalytics(db: ReturnType<typeof getDb>, token: string, chatId: number, days: number) {
  const normalizedDays = [0, 1, 7, 30].includes(days) ? days : 7;
  const conditions = [inArray(orders.status, [...paidOrderStatuses])];
  if (normalizedDays) conditions.push(sql`COALESCE(${orders.paidAt}, ${orders.createdAt})::timestamptz >= ${new Date(Date.now() - normalizedDays * 86_400_000).toISOString()}::timestamptz`);
  const rows = await db.select({ country: countries.name, quantity: orderItems.quantity, revenue: sql<number>`${orderItems.unitPrice} * ${orderItems.quantity}`, currency: orders.currency }).from(orderItems).innerJoin(orders, eq(orderItems.orderId, orders.id)).innerJoin(catalogProducts, eq(orderItems.productId, catalogProducts.id)).innerJoin(countries, eq(catalogProducts.countryId, countries.id)).where(and(...conditions));
  const lines = formatSalesByCurrency(rows.map((row) => ({ label: row.country, currency: row.currency, quantity: row.quantity, revenue: Number(row.revenue) || 0 })), "Оплаченных продаж по странам пока нет.");
  await sendMessage(token, chatId, `🌍 Продажи по странам ${analyticsPeriod(normalizedDays)}\n\n${lines}`, { inline_keyboard: [[{ text: "📈 Общая аналитика", callback_data: `analytics:period:${normalizedDays}` }], [{ text: "◀️ В меню", callback_data: "menu" }]] });
}

async function sendSearchAnalytics(db: ReturnType<typeof getDb>, token: string, chatId: number, adminId: number, days: number) {
  const normalizedDays = [0, 1, 7, 30].includes(days) ? days : 7;
  const boundary = normalizedDays ? new Date(Date.now() - normalizedDays * 86_400_000).toISOString() : null;
  const baseQuery = db.select({ query: searchAnalytics.query, searches: searchAnalytics.searches, noResultSearches: searchAnalytics.noResultSearches, totalResults: searchAnalytics.totalResults }).from(searchAnalytics);
  const rows = boundary ? await baseQuery.where(gte(searchAnalytics.lastSeenAt, boundary)) : await baseQuery;
  const grouped = new Map<string, { searches: number; noResults: number; totalResults: number }>();
  for (const row of rows) {
    const current = grouped.get(row.query) || { searches: 0, noResults: 0, totalResults: 0 };
    current.searches += row.searches;
    current.noResults += row.noResultSearches;
    current.totalResults += row.totalResults;
    grouped.set(row.query, current);
  }
  const totals = [...grouped.values()].reduce((sum, row) => ({ searches: sum.searches + row.searches, noResults: sum.noResults + row.noResults }), { searches: 0, noResults: 0 });
  const lines = [...grouped.entries()].sort((left, right) => right[1].searches - left[1].searches).slice(0, 20).map(([query, value], index) => {
    const average = value.searches ? (value.totalResults / value.searches).toFixed(1).replace(".", ",") : "0";
    return `${index + 1}. ${query}\n   ${value.searches} запр. · без результатов: ${value.noResults} · среднее: ${average}`;
  }).join("\n\n") || "Посковых запросов за период пока нет.";
  await sendMessage(token, chatId, `🔎 Внутренний поиск ${analyticsPeriod(normalizedDays)}\n\nВсего поисков: ${totals.searches}\nБез результатов: ${totals.noResults}\n\n${lines}`, { inline_keyboard: [[{ text: "📈 Общая аналитика", callback_data: `analytics:period:${normalizedDays}` }], [{ text: "🔄 Обновить", callback_data: `analytics:search:${normalizedDays}` }], [{ text: "◀️ В меню", callback_data: "menu" }]] });
  await audit(db, adminId, "analytics.search.view", null, { days: normalizedDays, searches: totals.searches });
}

async function sendOperationalErrors(db: ReturnType<typeof getDb>, token: string, chatId: number, adminId: number, hours: number) {
  const normalizedHours = hours === 168 ? 168 : 24;
  const boundary = new Date(Date.now() - normalizedHours * 60 * 60 * 1000).toISOString();
  const rows = (await db.select({
    kind: operationalEvents.kind,
    severity: operationalEvents.severity,
    area: operationalEvents.area,
    path: operationalEvents.path,
    code: operationalEvents.code,
    count: operationalEvents.count,
    lastSeenAt: operationalEvents.lastSeenAt,
  }).from(operationalEvents).where(gte(operationalEvents.lastSeenAt, boundary)).orderBy(desc(operationalEvents.lastSeenAt)).limit(100))
    .filter((row) => !isIgnoredOperationalPath(row.path))
    .slice(0, 20);
  const total = rows.reduce((sum, row) => sum + row.count, 0);
  const critical = rows.filter((row) => row.severity === "critical").reduce((sum, row) => sum + row.count, 0);
  const lines = rows.map((row, index) => [
    `${index + 1}. ${row.severity === "critical" ? "🔴" : row.severity === "error" ? "🟠" : "🟡"} ${row.code} · ×${row.count}`,
    `${row.area} · ${row.path}`,
    `Последнее: ${row.lastSeenAt} UTC`,
  ].join("\n")).join("\n\n") || "Технических ошибок за период не зафиксировано.";
  await sendMessage(token, chatId, `⚠️ Технические ошибки за ${normalizedHours === 24 ? "24 часа" : "7 дней"}\nВсего событий: ${total}\nКритических: ${critical}\n\n${lines}`, { inline_keyboard: [[{ text: `${normalizedHours === 24 ? "✅ " : ""}24 часа`, callback_data: "errors:period:24" }, { text: `${normalizedHours === 168 ? "✅ " : ""}7 дней`, callback_data: "errors:period:168" }], [{ text: "🔄 Обновить", callback_data: `errors:period:${normalizedHours}` }], [{ text: "◀️ В меню", callback_data: "menu" }]] });
  await audit(db, adminId, "errors.view", null, { hours: normalizedHours, events: total });
}

const paidOrderStatuses = new Set(["PAID", "PROCESSING", "SHIPPED", "DELIVERED", "COMPLETED"]);
const activeOrderStatuses = new Set(["NEW", "WAITING_FOR_MANAGER", "WAITING_PAYMENT", "PAYMENT_PENDING", "PAID", "PROCESSING", "SHIPPED", "DELIVERED"]);
const terminalOrderStatuses = ["COMPLETED", "CANCELLED", "REFUNDED", "FAILED"];
const analyticsStatusLabels: Record<string, string> = {
  NEW: "Новые", WAITING_FOR_MANAGER: "Ждут менеджера", WAITING_PAYMENT: "Ждут оплаты", PAYMENT_PENDING: "Платёж проверяется",
  PAID: "Оплачены", PROCESSING: "Выполняются", SHIPPED: "Отправлены", DELIVERED: "Доставлены", COMPLETED: "Завершены",
  CANCELLED: "Отменены", REFUNDED: "Возвраты", FAILED: "Ошибки",
};

async function sendAnalyticsSummary(db: ReturnType<typeof getDb>, token: string, chatId: number, days: number, role: TelegramRole) {
  const normalizedDays = [0, 1, 7, 30].includes(days) ? days : 7;
  const selection = { id: orders.id, status: orders.status, totalAmount: orders.totalAmount, currency: orders.currency, promoCode: orders.promoCode, discountAmount: orders.discountAmount, analyticsSource: orders.analyticsSource, analyticsMedium: orders.analyticsMedium, analyticsCampaign: orders.analyticsCampaign };
  const now = Date.now();
  const currentBoundary = normalizedDays ? new Date(now - normalizedDays * 86_400_000).toISOString() : null;
  const previousBoundary = normalizedDays ? new Date(now - normalizedDays * 2 * 86_400_000).toISOString() : null;
  const paymentTime = sql`COALESCE(${orders.paidAt}, ${orders.createdAt})::timestamptz`;
  const [rows, previousRows, paid, previousPaid, active] = await Promise.all([
    currentBoundary
      ? db.select(selection).from(orders).where(sql`${orders.createdAt}::timestamptz >= ${currentBoundary}::timestamptz`)
      : db.select(selection).from(orders),
    currentBoundary && previousBoundary
      ? db.select(selection).from(orders).where(and(sql`${orders.createdAt}::timestamptz >= ${previousBoundary}::timestamptz`, sql`${orders.createdAt}::timestamptz < ${currentBoundary}::timestamptz`))
      : Promise.resolve([]),
    currentBoundary
      ? db.select(selection).from(orders).where(and(inArray(orders.status, [...paidOrderStatuses]), sql`${paymentTime} >= ${currentBoundary}::timestamptz`))
      : db.select(selection).from(orders).where(inArray(orders.status, [...paidOrderStatuses])),
    currentBoundary && previousBoundary
      ? db.select(selection).from(orders).where(and(inArray(orders.status, [...paidOrderStatuses]), sql`${paymentTime} >= ${previousBoundary}::timestamptz`, sql`${paymentTime} < ${currentBoundary}::timestamptz`))
      : Promise.resolve([]),
    db.select({ id: orders.id }).from(orders).where(inArray(orders.status, [...activeOrderStatuses])),
  ]);
  const cohortPaid = rows.filter((order) => paidOrderStatuses.has(order.status));
  const previousCohortPaid = previousRows.filter((order) => paidOrderStatuses.has(order.status));
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
  const previousRevenue = new Map<string, number>();
  for (const order of previousPaid) previousRevenue.set(order.currency, (previousRevenue.get(order.currency) ?? 0) + order.totalAmount);
  const revenueLines = [...revenue].map(([currency, amount]) => `${amount.toLocaleString("ru-RU")} ${currency}`).join(" + ") || "0";
  const averageLines = [...revenue].map(([currency, amount]) => `${Math.round(amount / paid.filter((order) => order.currency === currency).length).toLocaleString("ru-RU")} ${currency}`).join(" + ") || "0";
  const promoPaid = paid.filter((order) => order.promoCode);
  const promoDiscounts = new Map<string, number>();
  for (const order of promoPaid) promoDiscounts.set(order.currency, (promoDiscounts.get(order.currency) ?? 0) + order.discountAmount);
  const promoDiscountLines = [...promoDiscounts].map(([currency, amount]) => `${amount.toLocaleString("ru-RU")} ${currency}`).join(" + ") || "0";
  const sourceCounts = new Map<string, number>();
  for (const order of paid) {
    const source = order.analyticsSource ? `${order.analyticsSource}${order.analyticsMedium ? ` / ${order.analyticsMedium}` : ""}` : "Прямой заход / не указан";
    sourceCounts.set(source, (sourceCounts.get(source) ?? 0) + 1);
  }
  const sourceLines = [...sourceCounts].sort((left, right) => right[1] - left[1]).slice(0, 5).map(([source, count]) => `• ${source}: ${count}`).join("\n") || "• Данных об источниках пока нет";
  const statusCounts = new Map<string, number>();
  for (const order of rows) statusCounts.set(order.status, (statusCounts.get(order.status) ?? 0) + 1);
  const statusLines = [...statusCounts].sort((left, right) => right[1] - left[1]).map(([status, count]) => `• ${analyticsStatusLabels[status] ?? status}: ${count}`).join("\n") || "• Заказов пока нет";
  const period = normalizedDays === 0 ? "за всё время" : normalizedDays === 1 ? "за последние 24 часа" : `за последние ${normalizedDays} дней`;
  const conversion = percentage(cohortPaid.length, rows.length);
  const previousConversion = percentage(previousCohortPaid.length, previousRows.length);
  const comparisonLines = normalizedDays ? [
    "",
    `📉 Сравнение с предыдущим таким же периодом:`,
    `• Заказы: ${rows.length} против ${previousRows.length} (${formatRelativeChange(rows.length, previousRows.length)})`,
    `• Оплаченные: ${paid.length} против ${previousPaid.length} (${formatRelativeChange(paid.length, previousPaid.length)})`,
    `• Конверсия: ${formatPercentage(conversion)} против ${formatPercentage(previousConversion)}`,
    ...[...new Set([...revenue.keys(), ...previousRevenue.keys()])].sort().map((currency) => {
      const currentAmount = revenue.get(currency) ?? 0;
      const previousAmount = previousRevenue.get(currency) ?? 0;
      return `• Оборот ${currency}: ${currentAmount.toLocaleString("ru-RU")} против ${previousAmount.toLocaleString("ru-RU")} (${formatRelativeChange(currentAmount, previousAmount)})`;
    }),
  ] : [];
  const text = [
    `📈 Аналитика SIMKA ${period}`,
    "",
    `🛒 Заказов создано: ${rows.length}`,
    `✅ Оплачено за период: ${paid.length}`,
    `💰 Оборот: ${revenueLines}`,
    `🧾 Средний оплаченный заказ: ${averageLines}`,
    `🎟 Оплачено с промокодом: ${promoPaid.length} · скидки ${promoDiscountLines}`,
    `📊 Конверсия созданных заказов → оплата: ${formatPercentage(conversion)}`,
    `⚙️ Активных сейчас: ${active.length}`,
    `❌ Отменено: ${cancelled.length}`,
    `↩️ Возвратов: ${refunded.length}`,
    `⚠️ Ошибок: ${failed.length}`,
    `📲 Продано eSIM: ${soldEsim}`,
    `📦 Продано SIM: ${soldSim}`,
    "",
    "Источники оплаченных заказов:",
    sourceLines,
    "",
    "Статусы:",
    statusLines,
    ...comparisonLines,
    "",
    "Данные обновляются напрямую из базы магазина. Для старых оплат без точной даты используется дата заказа.",
  ].join("\n");
  await sendMessage(token, chatId, text, analyticsKeyboard(normalizedDays, role));
}

async function sendOrderDetails(db: ReturnType<typeof getDb>, token: string, chatId: number, orderNumber: string, role: TelegramRole) {
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
  const canWrite = telegramRoleCan(role, "orders.write");
  if (canWrite && order.status === "WAITING_FOR_MANAGER") {
    for (const item of pendingDeliveryCosts) actions.push([{ text: `💵 Стоимость доставки · ${item.productName.slice(0, 28)}`, callback_data: `fulfill:cost:${item.id.slice(0, 12)}` }]);
  }
  if (canWrite && order.paymentMethod === "manager" && order.status === "WAITING_FOR_MANAGER" && pendingDeliveryCosts.length === 0) {
    actions.push([{ text: order.paymentInstructionsSentAt ? "📧 Повторить реквизиты" : "📧 Отправить реквизиты", callback_data: `order:requisites_prompt:${order.orderNumber}` }]);
    if (order.paymentInstructionsSentAt) actions.push([{ text: "✅ Подтвердить получение оплаты", callback_data: `order:paid_prompt:${order.orderNumber}` }]);
  }
  if (canWrite && order.status === "PAID") actions.push([{ text: "⚙️ Начать выполнение", callback_data: `order:process:${order.orderNumber}` }]);
  if (canWrite && order.status === "PROCESSING") {
    for (const item of items) {
      if (item.simType === "eSIM" && item.fulfillmentStatus === "PENDING") actions.push([{ text: `📲 Выдать eSIM · ${item.productName.slice(0, 30)}`, callback_data: `fulfill:esim:${item.id.slice(0, 12)}` }]);
      if (item.simType === "SIM" && item.fulfillmentStatus === "PENDING") actions.push([{ text: `📦 Указать отправку · ${item.productName.slice(0, 28)}`, callback_data: `fulfill:ship:${item.id.slice(0, 12)}` }]);
    }
  }
  if (canWrite && !["CANCELLED", "REFUNDED", "FAILED"].includes(order.status)) {
    for (const item of items.filter((entry) => entry.simType === "eSIM" && ["READY", "SENT"].includes(entry.fulfillmentStatus) && entry.hasActivationCode)) {
      actions.push([{ text: `📧 Повторить eSIM-письмо · ${item.productName.slice(0, 23)}`, callback_data: `fulfill:resend:${item.id.slice(0, 12)}` }]);
    }
    for (const item of items.filter((entry) => entry.simType === "SIM" && ["SHIPPED", "DELIVERED", "COMPLETED"].includes(entry.fulfillmentStatus) && entry.trackingNumber)) {
      actions.push([{ text: `📧 Повторить трек-письмо · ${item.productName.slice(0, 24)}`, callback_data: `fulfill:shipmail:${item.id.slice(0, 12)}` }]);
    }
  }
  if (canWrite && order.status === "SHIPPED") actions.push([{ text: "🚚 Отметить доставленным", callback_data: `order:deliver:${order.orderNumber}` }]);
  if (canWrite && order.status === "DELIVERED") actions.push([{ text: "✅ Завершить заказ", callback_data: `order:complete:${order.orderNumber}` }]);
  if (canWrite && ["NEW", "WAITING_FOR_MANAGER", "WAITING_PAYMENT", "PAYMENT_PENDING", "PAID", "PROCESSING"].includes(order.status)) actions.push([{ text: "❌ Отменить заказ", callback_data: `order:cancel_prompt:${order.orderNumber}` }]);
  if (canWrite && ["NEW", "WAITING_FOR_MANAGER", "WAITING_PAYMENT", "PAYMENT_PENDING"].includes(order.status)) actions.push([{ text: "⚠️ Закрыть с ошибкой", callback_data: `order:fail_prompt:${order.orderNumber}` }]);
  if (canWrite && ["PAID", "PROCESSING", "SHIPPED", "DELIVERED", "COMPLETED"].includes(order.status)) actions.push([{ text: "↩️ Отметить возврат", callback_data: `order:refund_prompt:${order.orderNumber}` }]);
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
    order.paidAt ? `Оплата подтверждена: ${order.paidAt}` : "",
    `Товары: ${order.subtotalAmount.toLocaleString("ru-RU")} ${order.currency}`,
    order.promoCode ? `Промокод: ${order.promoCode} · скидка ${order.discountAmount.toLocaleString("ru-RU")} ${order.currency}` : "",
    order.deliveryAmount ? `Доставка: ${order.deliveryAmount.toLocaleString("ru-RU")} ${order.currency}` : "",
    `Итого: ${order.totalAmount.toLocaleString("ru-RU")} ${order.currency}`,
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

function auditMetadataSummary(value: string) {
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    const text = Object.entries(parsed).map(([key, item]) => {
      const rendered = typeof item === "string" ? item : JSON.stringify(item);
      return `${key}=${rendered}`;
    }).join(", ").replace(/[\r\n]+/g, " ");
    return text.length > 180 ? `${text.slice(0, 177)}…` : text;
  } catch {
    return "";
  }
}

async function sendAuditPage(db: ReturnType<typeof getDb>, token: string, chatId: number, adminId: number, requestedPage = 0) {
  const pageSize = 8;
  const [{ total }] = await db.select({ total: sql<number>`count(*)::int` }).from(adminAuditLog);
  const pageCount = Math.max(1, Math.ceil(Number(total) / pageSize));
  const page = Math.min(Math.max(0, Number.isFinite(requestedPage) ? Math.trunc(requestedPage) : 0), pageCount - 1);
  const entries = await db.select({
    adminTelegramId: adminAuditLog.adminTelegramId,
    action: adminAuditLog.action,
    entityType: adminAuditLog.entityType,
    entityId: adminAuditLog.entityId,
    metadata: adminAuditLog.metadata,
    createdAt: adminAuditLog.createdAt,
  }).from(adminAuditLog).orderBy(desc(adminAuditLog.createdAt)).limit(pageSize).offset(page * pageSize);
  const lines = entries.map((entry, index) => {
    const metadata = auditMetadataSummary(entry.metadata);
    return [
      `${page * pageSize + index + 1}. ${entry.createdAt} UTC`,
      `Админ ${entry.adminTelegramId} · ${entry.action}`,
      entry.entityId ? `${entry.entityType}: ${entry.entityId}` : entry.entityType,
      metadata || "",
    ].filter(Boolean).join("\n");
  }).join("\n\n") || "Журнал пока пуст.";
  const navigation: Array<InlineButton> = [];
  if (page > 0) navigation.push({ text: "⬅️", callback_data: `audit:list:${page - 1}` });
  navigation.push({ text: `${page + 1}/${pageCount}`, callback_data: `audit:list:${page}` });
  if (page + 1 < pageCount) navigation.push({ text: "➡️", callback_data: `audit:list:${page + 1}` });
  await sendMessage(token, chatId, `📋 Журнал действий\nВсего записей: ${Number(total)}\n\n${lines}`, { inline_keyboard: [navigation, [{ text: "🔄 Обновить", callback_data: `audit:list:${page}` }], [{ text: "◀️ В меню", callback_data: "menu" }]] });
  await audit(db, adminId, "audit.view", null, { page });
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

async function sendEsimDeliveryEmail(item: NonNullable<Awaited<ReturnType<typeof resolveOrderItem>>>, activationCode: string, idempotencyKey = `esim-delivery/${item.itemId}`) {
  const instructions = item.fulfillmentInstructions || "Следуйте инструкции из карточки тарифа. Если возникнет вопрос, ответьте на это письмо.";
  return sendTransactionalEmail({
    to: item.customerEmail,
    subject: `eSIM по заказу ${item.orderNumber} — SIMKA`,
    text: `Здравствуйте, ${item.customerName}!\n\neSIM по заказу ${item.orderNumber} готова.\nТариф: ${item.productName}\n\nКод активации:\n${activationCode}\n\nИнструкция:\n${instructions}\n\nНе передавайте код другим людям. Добавляйте eSIM только через настройки устройства.`,
    html: `<div style="font-family:Arial,sans-serif;line-height:1.6;color:#10213a"><h1 style="font-size:24px">Ваша eSIM готова</h1><p>Здравствуйте, ${escapeHtml(item.customerName)}!</p><p>Заказ: <strong>${escapeHtml(item.orderNumber)}</strong><br>Тариф: ${escapeHtml(item.productName)}</p><p>Код активации:</p><pre style="overflow-wrap:anywhere;white-space:pre-wrap;border:1px solid #dbe5ef;border-radius:12px;background:#f6f9fc;padding:16px;font-size:15px">${escapeHtml(activationCode)}</pre><h2 style="font-size:18px">Инструкция</h2><p style="white-space:pre-line">${escapeHtml(instructions)}</p><p><strong>Не передавайте код другим людям.</strong> Добавляйте eSIM только через настройки устройства.</p></div>`,
    idempotencyKey,
  });
}

async function sendShippingEmail(item: NonNullable<Awaited<ReturnType<typeof resolveOrderItem>>>, idempotencyKey = `sim-shipped/${item.itemId}`) {
  const trackingLine = item.trackingUrl ? `${item.trackingNumber}\n${item.trackingUrl}` : item.trackingNumber || "Уточняется";
  const trackingHtml = item.trackingUrl
    ? `<a href="${escapeHtml(item.trackingUrl)}">${escapeHtml(item.trackingNumber || "Открыть отслеживание")}</a>`
    : escapeHtml(item.trackingNumber || "Уточняется");
  return sendTransactionalEmail({
    to: item.customerEmail,
    subject: `SIM отправлена — заказ ${item.orderNumber}`,
    text: `Здравствуйте, ${item.customerName}!\n\nФизическая SIM по заказу ${item.orderNumber} отправлена.\nТовар: ${item.productName}\nСлужба/способ: ${item.deliveryMethod || "Уточняется"}\nТрек-номер: ${trackingLine}\n\nСохраните это письмо до получения отправления.`,
    html: `<div style="font-family:Arial,sans-serif;line-height:1.6;color:#10213a"><h1 style="font-size:24px">SIM отправлена</h1><p>Здравствуйте, ${escapeHtml(item.customerName)}!</p><p>Заказ: <strong>${escapeHtml(item.orderNumber)}</strong><br>Товар: ${escapeHtml(item.productName)}<br>Служба/способ: ${escapeHtml(item.deliveryMethod || "Уточняется")}<br>Трек-номер: ${trackingHtml}</p><p>Сохраните это письмо до получения отправления.</p></div>`,
    idempotencyKey,
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
    idempotencyKey: `delivery-quote/${item.orderId}/${totals.deliveryAmount}/${totals.totalAmount}`,
  });
}

async function sendOrderStatusEmail(order: { customerEmail: string; customerName: string; orderNumber: string }, status: string) {
  const descriptions: Record<string, { subject: string; title: string; body: string }> = {
    PAID: { subject: "Оплата подтверждена", title: "Оплата получена", body: "Оплата подтверждена. Заказ передан на выполнение." },
    PROCESSING: { subject: "Заказ выполняется", title: "Начали выполнение", body: "Менеджер начал выдачу eSIM или подготовку физической SIM к отправке." },
    DELIVERED: { subject: "SIM доставлена", title: "Доставка отмечена завершённой", body: "Физическая SIM отмечена как доставленная. Если вы её не получили, сразу ответьте на это письмо." },
    COMPLETED: { subject: "Заказ выполнен", title: "Заказ завершён", body: "Все позиции заказа отмечены как выданные или доставленные." },
    REFUNDED: { subject: "Возврат подтверждён", title: "Средства возвращены", body: "Менеджер отметил возврат средств по заказу как выполненный. Срок зачисления зависит от способа оплаты." },
    FAILED: { subject: "Заказ не выполнен", title: "Заказ закрыт с ошибкой", body: "Заказ закрыт из-за ошибки до подтверждения оплаты. Деньги по этому заказу не были отмечены как полученные. Если вы уже оплатили, срочно свяжитесь с поддержкой." },
  };
  const message = descriptions[status];
  if (!message) return { delivered: false as const, reason: "not_configured" as const };
  return sendTransactionalEmail({
    to: order.customerEmail,
    subject: `${message.subject} — ${order.orderNumber}`,
    text: `Здравствуйте, ${order.customerName}!\n\n${message.body}\nЗаказ: ${order.orderNumber}`,
    html: `<div style="font-family:Arial,sans-serif;line-height:1.6;color:#10213a"><h1 style="font-size:24px">${escapeHtml(message.title)}</h1><p>Здравствуйте, ${escapeHtml(order.customerName)}!</p><p>${escapeHtml(message.body)}</p><p>Заказ: <strong>${escapeHtml(order.orderNumber)}</strong></p></div>`,
    idempotencyKey: `order-status/${order.orderNumber}/${status}`,
  });
}

async function sendPaymentRequisitesEmail(order: { customerEmail: string; customerName: string; orderNumber: string; totalAmount: number; currency: string }, requisites: string) {
  const amount = `${order.totalAmount.toLocaleString("ru-RU")} ${order.currency}`;
  return sendTransactionalEmail({
    to: order.customerEmail,
    subject: `Реквизиты для заказа ${order.orderNumber} — SIMKA`,
    text: `Здравствуйте, ${order.customerName}!\n\nИтоговая сумма заказа ${order.orderNumber}: ${amount}\n\nАктуальные реквизиты:\n${requisites}\n\nПосле оплаты ответьте на это письмо или сообщите менеджеру номер заказа. Не используйте реквизиты из других сообщений.`,
    html: `<div style="font-family:Arial,sans-serif;line-height:1.6;color:#10213a"><h1 style="font-size:24px">Реквизиты для оплаты</h1><p>Здравствуйте, ${escapeHtml(order.customerName)}!</p><p>Заказ: <strong>${escapeHtml(order.orderNumber)}</strong><br>Итоговая сумма: <strong>${escapeHtml(amount)}</strong></p><div style="white-space:pre-line;border:1px solid #dbe5ef;border-radius:12px;background:#f6f9fc;padding:16px">${escapeHtml(requisites)}</div><p>После оплаты ответьте на это письмо или сообщите менеджеру номер заказа. Не используйте реквизиты из других сообщений.</p></div>`,
    idempotencyKey: `payment-requisites/${order.orderNumber}/${order.totalAmount}`,
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

async function handleFulfillmentReply(token: string, chatId: number, adminId: number, messageId: number, text: string, replyContext: string, role: TelegramRole) {
  const db = getDb();
  if (replyContext.startsWith("[FIND_ORDER]")) {
    const orderNumber = text.trim().toUpperCase();
    if (!/^[A-Z0-9-]{4,64}$/.test(orderNumber)) {
      await sendMessage(token, chatId, "Введите номер заказа из букв, цифр и дефисов.", backKeyboard());
      return true;
    }
    await audit(db, adminId, "order.search", null, { orderNumber });
    await sendOrderDetails(db, token, chatId, orderNumber, role);
    return true;
  }
  if (replyContext.startsWith("[FIND_CUSTOMER]")) {
    const email = text.trim().toLowerCase();
    const emailError = getEmailValidationError(email);
    if (emailError) {
      await sendMessage(token, chatId, emailError, backKeyboard());
      return true;
    }
    const [customer] = await db.select({ id: customerAccounts.id }).from(customerAccounts).where(eq(customerAccounts.email, email)).limit(1);
    await audit(db, adminId, "customer.search", customer?.id ?? null, { found: Boolean(customer) });
    if (!customer) { await sendMessage(token, chatId, "Клиент с таким email не найден.", { inline_keyboard: [[{ text: "🔎 Искать ещё", callback_data: "customers:search" }], [{ text: "◀️ К клиентам", callback_data: "customers:list" }]] }); return true; }
    await sendCustomerDetails(db, token, chatId, customer.id, role);
    return true;
  }
  const blockCustomerReply = replyContext.match(/^\[BLOCK_CUSTOMER:([0-9a-f-]{36})\]/i);
  if (blockCustomerReply) {
    const reason = text.trim();
    if (!reason || reason.length > 500) { await sendMessage(token, chatId, "Укажите причину от 1 до 500 символов.", backKeyboard()); return true; }
    const now = new Date().toISOString();
    const [changed] = await db.update(customerAccounts).set({ isBlocked: true, blockedAt: now, blockedReason: reason, updatedAt: now }).where(eq(customerAccounts.id, blockCustomerReply[1])).returning({ id: customerAccounts.id });
    if (!changed) { await sendMessage(token, chatId, "Клиент не найден.", backKeyboard()); return true; }
    const sessions = await db.delete(customerSessions).where(eq(customerSessions.accountId, changed.id)).returning({ id: customerSessions.id });
    await db.delete(customerPasswordResets).where(eq(customerPasswordResets.accountId, changed.id));
    await audit(db, adminId, "customer.block", changed.id, { sessionsRevoked: sessions.length, reason });
    await sendMessage(token, chatId, `Клиент заблокирован. Завершено сессий: ${sessions.length}.`);
    await sendCustomerDetails(db, token, chatId, changed.id, role);
    return true;
  }
  const editCustomerReply = replyContext.match(/^\[EDIT_CUSTOMER:([0-9a-f-]{36}):(name|contact|email)\]/i);
  if (editCustomerReply) {
    const id = editCustomerReply[1];
    const field = editCustomerReply[2];
    const value = text.trim();
    const normalizedValue = field === "contact" && value === "-" ? "" : value;
    if (field === "name" && (normalizedValue.length < 2 || normalizedValue.length > 100)) { await sendMessage(token, chatId, "Имя должно быть от 2 до 100 символов.", backKeyboard()); return true; }
    if (field === "contact" && normalizedValue.length > 100) { await sendMessage(token, chatId, "Контакт должен быть не длиннее 100 символов.", backKeyboard()); return true; }
    if (field === "email") { const emailError = getEmailValidationError(normalizedValue); if (emailError) { await sendMessage(token, chatId, emailError, backKeyboard()); return true; } }
    if (field === "email") {
      const duplicate = await db.select({ id: customerAccounts.id }).from(customerAccounts).where(and(eq(customerAccounts.email, normalizedValue.toLowerCase()), sql`${customerAccounts.id} <> ${id}`)).limit(1);
      if (duplicate[0]) { await sendMessage(token, chatId, "Этот email уже занят другим аккаунтом.", { inline_keyboard: [[{ text: "◀️ К клиенту", callback_data: `customer:view:${id}` }]] }); return true; }
    }
    const update = field === "email" ? { email: normalizedValue.toLowerCase(), updatedAt: new Date().toISOString() } : field === "name" ? { name: normalizedValue, updatedAt: new Date().toISOString() } : { contact: normalizedValue, updatedAt: new Date().toISOString() };
    const [changed] = await db.update(customerAccounts).set(update).where(eq(customerAccounts.id, id)).returning({ id: customerAccounts.id });
    if (!changed) { await sendMessage(token, chatId, "Клиент не найден.", backKeyboard()); return true; }
    await audit(db, adminId, "customer.edit", id, { field });
    await sendCustomerDetails(db, token, chatId, id, role);
    return true;
  }
  if (replyContext.startsWith("[CREATE_PROMO]")) {
    const parts = text.split("|").map((part) => part.trim());
    if (parts.length !== 8) {
      await sendMessage(token, chatId, "Нужно 8 полей через |:\nКОД | percent/fixed | значение | минимальная сумма | лимит или - | валюта | начало или - | окончание или -", { inline_keyboard: [[{ text: "◀️ К промокодам", callback_data: "promocodes:list" }]] });
      return true;
    }
    const [rawCode, rawType, rawValue, rawMinimum, rawLimit, rawCurrency, rawStart, rawEnd] = parts;
    const code = normalizePromoCode(rawCode);
    const discountType = rawType.toLowerCase();
    const discountValue = Number(rawValue);
    const minOrderAmount = Number(rawMinimum);
    const usageLimit = rawLimit === "-" ? null : Number(rawLimit);
    const currency = rawCurrency.toUpperCase();
    const datePattern = /^\d{4}-\d{2}-\d{2}$/;
    const startsAt = rawStart === "-" ? null : datePattern.test(rawStart) ? `${rawStart}T00:00:00.000Z` : "invalid";
    const endsAt = rawEnd === "-" ? null : datePattern.test(rawEnd) ? `${rawEnd}T23:59:59.999Z` : "invalid";
    const invalid = !isValidPromoCodeFormat(code)
      || !["percent", "fixed"].includes(discountType)
      || !Number.isInteger(discountValue) || discountValue <= 0 || (discountType === "percent" && discountValue >= 100)
      || !Number.isInteger(minOrderAmount) || minOrderAmount < 0
      || (usageLimit !== null && (!Number.isInteger(usageLimit) || usageLimit <= 0))
      || !/^[A-Z]{3,8}$/.test(currency)
      || startsAt === "invalid" || endsAt === "invalid"
      || Boolean(startsAt && endsAt && startsAt > endsAt);
    if (invalid) {
      await sendMessage(token, chatId, "Проверьте данные. Код: 3–32 латинских символа/цифры. Процент: 1–99. Суммы и лимит — целые положительные числа. Даты: YYYY-MM-DD или -.", { inline_keyboard: [[{ text: "◀️ К промокодам", callback_data: "promocodes:list" }]] });
      return true;
    }
    try {
      const [created] = await db.insert(promoCodes).values({ id: crypto.randomUUID(), code, discountType: discountType as "percent" | "fixed", discountValue, minOrderAmount, usageLimit, currency, active: true, startsAt, endsAt, createdBy: String(adminId) }).returning({ id: promoCodes.id });
      await audit(db, adminId, "promocode.create", created.id, { code, discountType, discountValue, currency, minOrderAmount, usageLimit, startsAt, endsAt });
      await sendMessage(token, chatId, `Промокод ${code} создан.`);
      await sendPromoDetails(db, token, chatId, created.id, role);
    } catch (error) {
      const duplicate = typeof error === "object" && error !== null && "code" in error && String(error.code) === "23505";
      await sendMessage(token, chatId, duplicate ? `Промокод ${code} уже существует.` : "Не удалось создать промокод.", { inline_keyboard: [[{ text: "◀️ К промокодам", callback_data: "promocodes:list" }]] });
    }
    return true;
  }
  if (replyContext.startsWith("[TEST_EMAIL]")) {
    const email = text.trim().toLowerCase();
    const emailError = getEmailValidationError(email);
    if (emailError) {
      await sendMessage(token, chatId, emailError, backKeyboard());
      return true;
    }
    const sentAt = new Date();
    const delivery = await sendTransactionalEmail({
      to: email,
      subject: "Проверка почты SIMKA",
      text: `Почтовая отправка SIMKA работает.\n\nТест выполнен: ${sentAt.toLocaleString("ru-RU", { timeZone: "UTC" })} UTC.`,
      html: `<div style="font-family:Arial,sans-serif;line-height:1.6;color:#10213a"><h1 style="font-size:24px">Почта SIMKA работает</h1><p>Это безопасное тестовое письмо из панели администратора.</p><p>Тест выполнен: <strong>${escapeHtml(sentAt.toLocaleString("ru-RU", { timeZone: "UTC" }))} UTC</strong>.</p></div>`,
      idempotencyKey: `admin-email-test/${adminId}/${sentAt.getTime()}`,
    });
    await audit(db, adminId, "settings.email_test", "transactional_email", { delivered: delivery.delivered, reason: delivery.reason ?? null });
    await sendMessage(token, chatId, delivery.delivered ? `Тестовое письмо принято почтовым сервисом и отправлено на ${email}. Проверьте «Входящие» и «Спам».` : delivery.reason === "not_configured" ? "Почта ещё не настроена: добавьте RESEND_API_KEY и EMAIL_FROM в Render." : "Resend отклонил письмо или временно недоступен. Проверьте подтверждение домена и журнал Resend.", { inline_keyboard: [[{ text: "✉️ Проверить ещё раз", callback_data: "settings:email_test" }], [{ text: "◀️ В меню", callback_data: "menu" }]] });
    return true;
  }
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
      const [lockedOrder] = await tx.select({ status: orders.status, subtotalAmount: orders.subtotalAmount, discountAmount: orders.discountAmount, currency: orders.currency }).from(orders).where(eq(orders.id, item.orderId)).for("update").limit(1);
      if (!lockedOrder || lockedOrder.status !== "WAITING_FOR_MANAGER") return null;
      await tx.update(orderItems).set({ deliveryCost: cost, deliveryCostConfirmed: true, updatedAt: new Date().toISOString() }).where(eq(orderItems.id, item.itemId));
      const deliveryRows = await tx.select({ simType: orderItems.simType, deliveryCost: orderItems.deliveryCost, confirmed: orderItems.deliveryCostConfirmed }).from(orderItems).where(eq(orderItems.orderId, item.orderId));
      const deliveryAmount = deliveryRows.filter((row) => row.simType === "SIM").reduce((sum, row) => sum + row.deliveryCost, 0);
      const pending = deliveryRows.some((row) => row.simType === "SIM" && !row.confirmed);
      const totalAmount = lockedOrder.subtotalAmount - lockedOrder.discountAmount + deliveryAmount;
      await tx.update(orders).set({ deliveryAmount, totalAmount, paymentInstructionsSentAt: null, updatedAt: new Date().toISOString() }).where(eq(orders.id, item.orderId));
      return { deliveryAmount, totalAmount, currency: lockedOrder.currency, pending };
    });
    if (!totals) { await sendMessage(token, chatId, "Статус заказа уже изменился. Стоимость не сохранена.", orderBackKeyboard(item.orderNumber)); return true; }
    let delivered = false;
    if (!totals.pending) delivered = (await sendDeliveryQuoteEmail(item, totals)).delivered;
    await audit(db, adminId, "order.delivery_cost", item.orderId, { itemId: item.itemId, cost, currency: totals.currency, customerEmailDelivered: delivered });
    await sendMessage(token, chatId, `Стоимость доставки сохранена: ${cost.toLocaleString("ru-RU")} ${totals.currency}.${totals.pending ? " В заказе ещё есть доставка без цены." : delivered ? " Клиенту отправлена итоговая сумма." : " Автоматическое письмо не доставлено — сообщите итог клиенту вручную."}`);
    await sendOrderDetails(db, token, chatId, item.orderNumber, role);
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
    await sendOrderDetails(db, token, chatId, item.orderNumber, role);
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
    await sendOrderDetails(db, token, chatId, item.orderNumber, role);
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

function categoryActionKeyboard(category: { id: string; slug: string; isPublished: boolean; noindex: boolean; archivedAt: string | null }, productIds: Set<number>, products: Array<{ id: number; name: string }>): InlineKeyboard {
  const productButtons = products.slice(0, 80).map((product) => ({
    text: `${productIds.has(product.id) ? "✅ Снять" : "➕ Назначить"} ${product.id} · ${product.name.slice(0, 28)}`,
    callback_data: `ca:${category.id.slice(0, 12)}:${product.id}`,
  }));
  const productRows: Array<Array<InlineButton>> = [];
  for (let index = 0; index < productButtons.length; index += 2) productRows.push(productButtons.slice(index, index + 2));
  return { inline_keyboard: [
    ...(category.isPublished && !category.archivedAt ? [[{ text: "🌐 Открыть на сайте", url: `${SITE_ORIGIN}/category/${encodeURIComponent(category.slug)}` }]] : []),
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

async function handleCallback(token: string, chatId: number, adminId: number, data: string, role: TelegramRole) {
  const db = getDb();
  const [scope, action, first, second] = data.split(":");
  if (data === "menu") {
    await sendAdminMenu(token, chatId, role);
    return;
  }
  if (await handleCatalogAdminCallback({ token, chatId, adminId }, data)) return;
  if (scope === "promocodes" && action === "list") {
    await sendPromoCodes(db, token, chatId, role);
    return;
  }
  if (scope === "promocodes" && action === "analytics") {
    await sendPromoAnalytics(db, token, chatId);
    return;
  }
  if (scope === "promocodes" && action === "view" && first) {
    await sendPromoDetails(db, token, chatId, first, role);
    return;
  }
  if (scope === "promocodes" && action === "create") {
    await sendMessage(token, chatId, "[CREATE_PROMO]\nВведите данные через |:\nКОД | percent/fixed | значение | минимальная сумма | лимит или - | валюта | начало или - | окончание или -\n\nПример:\nWELCOME10 | percent | 10 | 1000 | 100 | RUB | - | 2026-12-31", { force_reply: true, selective: true, input_field_placeholder: "WELCOME10 | percent | 10 | 1000 | 100 | RUB | - | 2026-12-31" });
    return;
  }
  if (scope === "promocodes" && action === "toggle" && first) {
    const [promo] = await db.select({ id: promoCodes.id, code: promoCodes.code, active: promoCodes.active }).from(promoCodes).where(eq(promoCodes.id, first)).limit(1);
    if (!promo) { await sendMessage(token, chatId, "Промокод не найден.", backKeyboard()); return; }
    await db.update(promoCodes).set({ active: !promo.active, updatedAt: new Date().toISOString() }).where(eq(promoCodes.id, promo.id));
    await audit(db, adminId, "promocode.toggle", promo.id, { code: promo.code, active: !promo.active });
    await sendPromoDetails(db, token, chatId, promo.id, role);
    return;
  }
  if (data === "status") {
    const staleBoundary = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const [recent, stale, lowStock, errorTotals] = await Promise.all([
      db.select({ status: orders.status }).from(orders).orderBy(desc(orders.createdAt)).limit(100),
      db.select({ id: orders.id }).from(orders).where(and(inArray(orders.status, [...activeOrderStatuses]), lt(orders.updatedAt, staleBoundary))).limit(100),
      db.select({ id: catalogProducts.id }).from(catalogProducts).where(and(eq(catalogProducts.publicationStatus, "PUBLISHED"), or(eq(catalogProducts.available, false), sql`${catalogProducts.stockQuantity} IS NOT NULL AND ${catalogProducts.stockQuantity} <= 3`))).limit(100),
      db.select({ path: operationalEvents.path, count: operationalEvents.count }).from(operationalEvents).where(gte(operationalEvents.lastSeenAt, staleBoundary)),
    ]);
    const active = recent.filter((order) => !["COMPLETED", "CANCELLED", "REFUNDED", "FAILED"].includes(order.status)).length;
    const email = getEmailConfigurationStatus();
    const visibleErrorTotal = errorTotals.filter((row) => !isIgnoredOperationalPath(row.path)).reduce((sum, row) => sum + row.count, 0);
    const statusActions: InlineKeyboard["inline_keyboard"] = [
      [{ text: "🔄 Обновить", callback_data: "status" }],
      [{ text: "⚠️ Открыть ошибки", callback_data: "errors:period:24" }],
    ];
    if (telegramRoleCan(role, "settings.read")) {
      statusActions.push([{ text: "✉️ Проверить почту", callback_data: "settings:email" }]);
    }
    statusActions.push([{ text: "◀️ В меню", callback_data: "menu" }]);
    await sendMessage(token, chatId, `SIMKA работает.\nБаза данных: доступна\nЗаказов в выборке: ${recent.length}\nАктивных: ${active}\nБез движения более 24 часов: ${stale.length}\nМало товара / нет в наличии: ${lowStock.length}\nТехнических ошибок за 24 часа: ${visibleErrorTotal}\nПочта: ${email.configured ? "настроена" : `не настроена (${email.missing.join(", ")})`}`, { inline_keyboard: statusActions });
    return;
  }
  if (scope === "analytics" && action === "period") {
    await sendAnalyticsSummary(db, token, chatId, Number(first), role);
    return;
  }
  if (scope === "analytics" && action === "products") {
    await sendProductAnalytics(db, token, chatId, Number(first));
    return;
  }
  if (scope === "analytics" && action === "countries") {
    await sendCountryAnalytics(db, token, chatId, Number(first));
    return;
  }
  if (scope === "analytics" && action === "search") {
    await sendSearchAnalytics(db, token, chatId, adminId, Number(first));
    return;
  }
  if (scope === "analytics" && action === "csv") {
    await sendAnalyticsCsv(db, token, chatId, adminId, Number(first));
    return;
  }
  if (scope === "errors" && action === "period") {
    await sendOperationalErrors(db, token, chatId, adminId, Number(first));
    return;
  }
  if (scope === "audit" && action === "list") {
    await sendAuditPage(db, token, chatId, adminId, Number(first || 0));
    return;
  }
  if (scope === "backup" && action === "prompt") {
    await sendMessage(token, chatId, "Создать зашифрованную копию базы и отправить её в этот администраторский чат? Файл содержит персональные данные и должен храниться закрыто.", { inline_keyboard: [[{ text: "🗄 Создать копию", callback_data: "backup:confirm" }], [{ text: "Отмена", callback_data: "menu" }]] });
    return;
  }
  if (scope === "backup" && action === "confirm") {
    await sendMessage(token, chatId, "Создаю согласованную копию базы. Это может занять несколько секунд…");
    try {
      const backup = await createEncryptedDatabaseBackup();
      const filename = `simka-backup-${backup.createdAt.replace(/[:.]/g, "-")}.json.enc`;
      await sendDocument(token, chatId, backup.data, filename, `Зашифрованная копия SIMKA · ${backup.tableCount} таблиц · ${Math.ceil(backup.byteCount / 1024)} КБ. Для расшифровки нужен текущий BACKUP_ENCRYPTION_KEY или FULFILLMENT_ENCRYPTION_KEY.`);
      await audit(db, adminId, "database.backup", null, { tableCount: backup.tableCount, byteCount: backup.byteCount });
    } catch (error) {
      console.error("database_backup_failed", { name: error instanceof Error ? error.message : "UnknownError" });
      await sendMessage(token, chatId, error instanceof Error && error.message === "BACKUP_TOO_LARGE" ? "Копия превышает безопасный лимит Telegram. Для большого магазина понадобится внешнее хранилище на основном сервере." : "Не удалось создать резервную копию. Проверьте базу и ключ шифрования.", backKeyboard());
    }
    return;
  }
  if (scope === "settings" && action === "payment") {
    const [setting] = await db.select({ updatedAt: storeSettings.updatedAt, updatedBy: storeSettings.updatedBy }).from(storeSettings).where(eq(storeSettings.key, PAYMENT_REQUISITES_KEY)).limit(1);
    await sendMessage(token, chatId, setting ? `Платёжные реквизиты настроены.\nОбновлены: ${setting.updatedAt}\nАдминистратор: ${setting.updatedBy}\n\nПолное значение намеренно не показывается в сообщениях.` : "Платёжные реквизиты ещё не настроены. Без них кнопка отправки клиенту не сработает.", { inline_keyboard: [[{ text: setting ? "✏️ Заменить реквизиты" : "➕ Добавить реквизиты", callback_data: "settings:payment_edit" }], [{ text: "◀️ В меню", callback_data: "menu" }]] });
    return;
  }
  if (scope === "settings" && action === "email") {
    const email = getEmailConfigurationStatus();
    await sendMessage(token, chatId, email.configured ? `Почтовая отправка настроена.\nОтправитель: ${email.from}\n\nПроверьте реальную доставку тестовым письмом.` : `Почтовая отправка не настроена.\nНе хватает: ${email.missing.join(", ")}\n\nДобавьте переменные в Render и дождитесь нового deploy.`, { inline_keyboard: [[{ text: "📨 Отправить тест", callback_data: "settings:email_test" }], [{ text: "◀️ В меню", callback_data: "menu" }]] });
    return;
  }
  if (scope === "settings" && action === "email_test") {
    await sendMessage(token, chatId, "[TEST_EMAIL]\nВведите email, на который отправить безопасное тестовое письмо.", { force_reply: true, selective: true, input_field_placeholder: "name@example.com" });
    return;
  }
  if (scope === "settings" && action === "payment_edit") {
    await sendMessage(token, chatId, "[EDIT_PAYMENT_REQUISITES]\nВведите актуальные реквизиты и понятное назначение платежа. Значение будет зашифровано перед сохранением и не будет показано в карточках бота.", { force_reply: true, selective: true, input_field_placeholder: "Банк, получатель, номер счёта, назначение" });
    return;
  }
  if (scope === "orders" && action === "list") {
    await sendOrdersPage(db, token, chatId, Number(first || 0), second || "active");
    return;
  }
  if (scope === "orders" && action === "search") {
    await sendMessage(token, chatId, "[FIND_ORDER]\nВведите полный номер заказа.", { force_reply: true, selective: true, input_field_placeholder: "Например: SIMKA-123456" });
    return;
  }
  if (scope === "customers" && action === "list") {
    await sendCustomersPage(db, token, chatId, Number(first || 0));
    return;
  }
  if (scope === "customers" && action === "search") {
    await sendMessage(token, chatId, "[FIND_CUSTOMER]\nВведите email клиента.", { force_reply: true, selective: true, input_field_placeholder: "name@example.com" });
    return;
  }
  if (scope === "customer" && action === "view" && first) {
    await sendCustomerDetails(db, token, chatId, first, role);
    return;
  }
  if (scope === "customer" && action === "block_prompt" && first) {
    await sendMessage(token, chatId, `[BLOCK_CUSTOMER:${first}]\nУкажите причину блокировки. Все сессии клиента будут завершены.`, { force_reply: true, selective: true, input_field_placeholder: "Причина блокировки" });
    return;
  }
  if (scope === "customer" && action === "edit" && first && ["name", "contact", "email"].includes(second || "")) {
    const labels: Record<string, string> = { name: "новое имя", contact: "новый контакт или - чтобы очистить", email: "новый email" };
    await sendMessage(token, chatId, `[EDIT_CUSTOMER:${first}:${second}]\nВведите ${labels[second!]}.`, { force_reply: true, selective: true, input_field_placeholder: labels[second!] });
    return;
  }
  if (scope === "customer" && action === "unblock" && first) {
    const [changed] = await db.update(customerAccounts).set({ isBlocked: false, blockedAt: null, blockedReason: null, updatedAt: new Date().toISOString() }).where(eq(customerAccounts.id, first)).returning({ id: customerAccounts.id });
    if (!changed) { await sendMessage(token, chatId, "Клиент не найден.", backKeyboard()); return; }
    await audit(db, adminId, "customer.unblock", changed.id);
    await sendCustomerDetails(db, token, chatId, changed.id, role);
    return;
  }
  if (scope === "customer" && action === "logout_prompt" && first) {
    await sendMessage(token, chatId, "Завершить все входы этого клиента на всех устройствах?", { inline_keyboard: [[{ text: "🚪 Да, завершить", callback_data: `customer:logout_confirm:${first}` }], [{ text: "Отмена", callback_data: `customer:view:${first}` }]] });
    return;
  }
  if (scope === "customer" && action === "logout_confirm" && first) {
    const revoked = await db.delete(customerSessions).where(eq(customerSessions.accountId, first)).returning({ id: customerSessions.id });
    await audit(db, adminId, "customer.sessions_revoke", first, { sessionsRevoked: revoked.length });
    await sendMessage(token, chatId, `Завершено сессий: ${revoked.length}.`);
    await sendCustomerDetails(db, token, chatId, first, role);
    return;
  }
  if (scope === "customer" && action === "export" && first) {
    const [customer, customerOrders] = await Promise.all([
      db.select({ name: customerAccounts.name, email: customerAccounts.email, contact: customerAccounts.contact, isBlocked: customerAccounts.isBlocked, createdAt: customerAccounts.createdAt, updatedAt: customerAccounts.updatedAt }).from(customerAccounts).where(eq(customerAccounts.id, first)).limit(1),
      db.select({ orderNumber: orders.orderNumber, status: orders.status, totalAmount: orders.totalAmount, currency: orders.currency, createdAt: orders.createdAt }).from(orders).where(eq(orders.customerAccountId, first)).orderBy(desc(orders.createdAt)).limit(20),
    ]);
    if (!customer[0]) { await sendMessage(token, chatId, "Клиент не найден.", backKeyboard()); return; }
    const exportText = ["ЭКСПОРТ ДАННЫХ КЛИЕНТА", `Имя: ${customer[0].name}`, `Email: ${customer[0].email}`, `Контакт: ${customer[0].contact || "—"}`, `Заблокирован: ${customer[0].isBlocked ? "да" : "нет"}`, `Создан: ${customer[0].createdAt}`, `Обновлён: ${customer[0].updatedAt}`, "", "Последние 20 заказов:", ...(customerOrders.length ? customerOrders.map((order) => `${order.createdAt} · ${order.orderNumber} · ${order.status} · ${order.totalAmount} ${order.currency}`) : ["Заказов нет"])].join("\n");
    await audit(db, adminId, "customer.export", first, { ordersIncluded: customerOrders.length });
    await sendMessage(token, chatId, exportText, { inline_keyboard: [[{ text: "◀️ К клиенту", callback_data: `customer:view:${first}` }]] });
    return;
  }
  if (scope === "customer" && action === "delete_prompt" && first) {
    await sendMessage(token, chatId, "Удалить аккаунт, пароль, сбросы и все сессии? Действие доступно только после завершения или отмены активных заказов. Завершённые заказы сохранятся по требованиям учёта в обезличенном виде.", { inline_keyboard: [[{ text: "🗑 Да, удалить аккаунт", callback_data: `customer:delete_confirm:${first}` }], [{ text: "Отмена", callback_data: `customer:view:${first}` }]] });
    return;
  }
  if (scope === "customer" && action === "delete_confirm" && first) {
    const [customer] = await db.select({ email: customerAccounts.email }).from(customerAccounts).where(eq(customerAccounts.id, first)).limit(1);
    if (!customer) { await sendMessage(token, chatId, "Аккаунт уже удалён.", { inline_keyboard: [[{ text: "◀️ К клиентам", callback_data: "customers:list" }]] }); return; }
    const [activeOrder] = await db.select({ id: orders.id }).from(orders).where(and(eq(orders.customerAccountId, first), notInArray(orders.status, terminalOrderStatuses))).limit(1);
    if (activeOrder) {
      await sendMessage(token, chatId, "Удаление заблокировано: у клиента есть активный заказ. Сначала завершите или отмените его.", { inline_keyboard: [[{ text: "◀️ К клиенту", callback_data: `customer:view:${first}` }]] });
      return;
    }
    const ownedOrders = await db.select({ id: orders.id }).from(orders).where(eq(orders.customerAccountId, first));
    const orderIds = ownedOrders.map((order) => order.id);
    const now = new Date().toISOString();
    await db.transaction(async (tx) => {
      if (orderIds.length) {
        await tx.update(orderItems).set({
          activationCodeEncrypted: null,
          fulfillmentInstructions: null,
          trackingNumber: null,
          trackingUrl: null,
          updatedAt: now,
        }).where(inArray(orderItems.orderId, orderIds));
        await tx.update(orders).set({
          customerAccountId: null,
          customerName: "Удалённый клиент",
          customerEmail: `deleted-${crypto.randomUUID()}@invalid.local`,
          customerContact: "",
          deliveryAddress: null,
          customerComment: "",
          analyticsClientId: null,
          updatedAt: now,
        }).where(eq(orders.customerAccountId, first));
      }
      await tx.delete(customerAccounts).where(eq(customerAccounts.id, first));
    });
    await audit(db, adminId, "customer.delete", first, { emailHash: createHash("sha256").update(customer.email).digest("hex") });
    await sendMessage(token, chatId, "Аккаунт клиента удалён. Персональные данные и данные выдачи очищены, история завершённых заказов сохранена в обезличенном виде.", { inline_keyboard: [[{ text: "◀️ К клиентам", callback_data: "customers:list" }]] });
    return;
  }
  if (scope === "order" && action === "view" && first) {
    await sendOrderDetails(db, token, chatId, first, role);
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
    await sendOrderDetails(db, token, chatId, order.orderNumber, role);
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
      const delivered = (await sendEsimDeliveryEmail(item, activationCode, `esim-resend/${item.itemId}/${Date.now()}`)).delivered;
      if (delivered) await db.update(orderItems).set({ fulfillmentStatus: "SENT", fulfilledAt: new Date().toISOString(), updatedAt: new Date().toISOString() }).where(eq(orderItems.id, item.itemId));
      await syncOrderFulfillmentStatus(db, item.orderId);
      await audit(db, adminId, "order.esim_resend", item.orderId, { itemId: item.itemId, delivered });
      await sendMessage(token, chatId, delivered ? "eSIM повторно отправлена клиенту." : "Письмо снова не доставлено. Проверьте RESEND_API_KEY и EMAIL_FROM.");
      await sendOrderDetails(db, token, chatId, item.orderNumber, role);
      return;
    }
    if (action === "ship") {
      if (item.simType !== "SIM" || item.orderStatus !== "PROCESSING" || !item.deliveryCostConfirmed) { await sendMessage(token, chatId, "Сначала подтвердите стоимость, оплату и начните выполнение.", orderBackKeyboard(item.orderNumber)); return; }
      await sendMessage(token, chatId, `[SHIP_ITEM:${item.itemId}]\nВведите: трек-номер | URL отслеживания или - | служба доставки`, { force_reply: true, selective: true, input_field_placeholder: "123456789 | https://… | СДЭК" });
      return;
    }
    if (action === "shipmail") {
      if (item.simType !== "SIM" || !["SHIPPED", "DELIVERED", "COMPLETED"].includes(item.fulfillmentStatus) || !item.trackingNumber) { await sendMessage(token, chatId, "Повторная отправка трек-номера недоступна.", orderBackKeyboard(item.orderNumber)); return; }
      const delivered = (await sendShippingEmail(item, `shipment-resend/${item.itemId}/${Date.now()}`)).delivered;
      await audit(db, adminId, "order.shipment_resend", item.orderId, { itemId: item.itemId, delivered });
      await sendMessage(token, chatId, delivered ? "Трек-номер повторно отправлен клиенту." : "Письмо не доставлено. Проверьте почтовые настройки.");
      await sendOrderDetails(db, token, chatId, item.orderNumber, role);
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
        idempotencyKey: `order-cancelled/${order.id}`,
      });
      cancellationEmailDelivered = delivery.delivered;
    } catch (error) {
      console.error("order_cancellation_email_failed", { name: error instanceof Error ? error.name : "UnknownError" });
    }
    await audit(db, adminId, "order.cancellation_email", order.id, { delivered: cancellationEmailDelivered });
    await sendMessage(token, chatId, `Заказ ${order.orderNumber} отменён. Статус → CANCELLED.\n${cancellationEmailDelivered ? "Клиенту отправлено письмо об отмене." : "Автоматическое письмо клиенту не доставлено — сообщите об отмене вручную."}`, { inline_keyboard: [[{ text: "🛒 К списку заказов", callback_data: "orders:list" }], [{ text: "📄 Открыть заказ", callback_data: `order:view:${order.orderNumber}` }]] });
    return;
  }
  if (scope === "order" && action === "fail_prompt" && first) {
    const [order] = await db.select({ status: orders.status }).from(orders).where(eq(orders.orderNumber, first)).limit(1);
    if (!order) { await sendMessage(token, chatId, "Заказ не найден.", backKeyboard()); return; }
    if (!["NEW", "WAITING_FOR_MANAGER", "WAITING_PAYMENT", "PAYMENT_PENDING"].includes(order.status)) { await sendMessage(token, chatId, `Статус ${order.status} нельзя закрыть как ошибку.`, orderBackKeyboard(first)); return; }
    await sendMessage(token, chatId, `Закрыть неоплаченный заказ ${first} с ошибкой и вернуть зарезервированный остаток?`, { inline_keyboard: [[{ text: "⚠️ Да, закрыть", callback_data: `order:fail_confirm:${first}` }], [{ text: "Не закрывать", callback_data: `order:view:${first}` }]] });
    return;
  }
  if (scope === "order" && action === "fail_confirm" && first) {
    const [order] = await db.select({ id: orders.id, orderNumber: orders.orderNumber, status: orders.status, customerName: orders.customerName, customerEmail: orders.customerEmail }).from(orders).where(eq(orders.orderNumber, first)).limit(1);
    if (!order) { await sendMessage(token, chatId, "Заказ не найден.", backKeyboard()); return; }
    const allowed = ["NEW", "WAITING_FOR_MANAGER", "WAITING_PAYMENT", "PAYMENT_PENDING"];
    const changed = await releaseReservedInventory(order.id, "FAILED", allowed);
    if (!changed) { await sendMessage(token, chatId, "Заказ уже изменился или резерв отсутствует. Обновите карточку.", orderBackKeyboard(first)); return; }
    await db.update(orderItems).set({ fulfillmentStatus: "FAILED", activationCodeEncrypted: null, fulfillmentInstructions: null, updatedAt: new Date().toISOString() }).where(eq(orderItems.orderId, order.id));
    const customerEmailDelivered = (await sendOrderStatusEmail(order, "FAILED")).delivered;
    await audit(db, adminId, "order.fail", order.id, { from: order.status, to: "FAILED", customerEmailDelivered });
    await sendMessage(token, chatId, `Заказ ${order.orderNumber} закрыт со статусом FAILED. Резерв товара возвращён.${customerEmailDelivered ? " Клиент уведомлён по email." : " Письмо клиенту не доставлено."}`);
    await sendOrderDetails(db, token, chatId, order.orderNumber, role);
    return;
  }
  if (scope === "order" && action === "refund_prompt" && first) {
    const [order] = await db.select({ status: orders.status }).from(orders).where(eq(orders.orderNumber, first)).limit(1);
    if (!order) { await sendMessage(token, chatId, "Заказ не найден.", backKeyboard()); return; }
    if (!["PAID", "PROCESSING", "SHIPPED", "DELIVERED", "COMPLETED"].includes(order.status)) { await sendMessage(token, chatId, `Возврат недоступен для статуса ${order.status}.`, orderBackKeyboard(first)); return; }
    await sendMessage(token, chatId, `Подтвердите, что деньги по заказу ${first} уже фактически возвращены клиенту. Эта кнопка сама не переводит деньги.`, { inline_keyboard: [[{ text: "↩️ Деньги возвращены", callback_data: `order:refund_confirm:${first}` }], [{ text: "Отмена", callback_data: `order:view:${first}` }]] });
    return;
  }
  if (scope === "order" && action === "refund_confirm" && first) {
    const refundable = ["PAID", "PROCESSING", "SHIPPED", "DELIVERED", "COMPLETED"];
    const [order] = await db.select({ id: orders.id, orderNumber: orders.orderNumber, status: orders.status, customerName: orders.customerName, customerEmail: orders.customerEmail }).from(orders).where(eq(orders.orderNumber, first)).limit(1);
    if (!order || !refundable.includes(order.status)) { await sendMessage(token, chatId, "Заказ уже изменился или возврат недоступен.", orderBackKeyboard(first)); return; }
    const [changed] = await db.update(orders).set({ status: "REFUNDED", updatedAt: new Date().toISOString() }).where(and(eq(orders.id, order.id), eq(orders.status, order.status))).returning({ id: orders.id });
    if (!changed) { await sendMessage(token, chatId, "Статус заказа уже изменился. Обновите карточку.", orderBackKeyboard(first)); return; }
    await db.update(orderItems).set({ fulfillmentStatus: "REFUNDED", updatedAt: new Date().toISOString() }).where(eq(orderItems.orderId, order.id));
    const customerEmailDelivered = (await sendOrderStatusEmail(order, "REFUNDED")).delivered;
    await reportOrderAnalytics(order.id, "REFUNDED");
    await audit(db, adminId, "order.refund", order.id, { from: order.status, to: "REFUNDED", customerEmailDelivered, inventoryRestocked: false });
    await sendMessage(token, chatId, `Заказ ${order.orderNumber} отмечен как REFUNDED.${customerEmailDelivered ? " Клиент уведомлён по email." : " Письмо клиенту не доставлено."}\nОстаток автоматически не увеличен: возвращённый товар нужно проверить вручную.`);
    await sendOrderDetails(db, token, chatId, order.orderNumber, role);
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
    const changedAt = new Date().toISOString();
    const changed = await db.update(orders).set({ status: transition.to, ...(transition.to === "PAID" ? { paidAt: changedAt } : {}), updatedAt: changedAt }).where(and(eq(orders.id, order.id), eq(orders.status, transition.from))).returning({ id: orders.id });
    if (!changed[0]) { await sendMessage(token, chatId, "Статус заказа уже изменился. Откройте его заново.", orderBackKeyboard(order.orderNumber)); return; }
    if (action === "deliver") await db.update(orderItems).set({ fulfillmentStatus: "DELIVERED", fulfilledAt: new Date().toISOString(), updatedAt: new Date().toISOString() }).where(and(eq(orderItems.orderId, order.id), eq(orderItems.simType, "SIM")));
    if (action === "complete") await db.update(orderItems).set({ fulfillmentStatus: "COMPLETED", updatedAt: new Date().toISOString() }).where(eq(orderItems.orderId, order.id));
    const customerEmailDelivered = (await sendOrderStatusEmail(order, transition.to)).delivered;
    if (transition.to === "PAID") await reportOrderAnalytics(order.id, "PAID");
    await audit(db, adminId, `order.${action}`, order.id, { orderNumber: order.orderNumber, from: transition.from, to: transition.to, customerEmailDelivered });
    await sendOrderDetails(db, token, chatId, order.orderNumber, role);
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
    if (action === "publish") {
      if (category.archivedAt) { await sendMessage(token, chatId, "Сначала восстановите категорию из архива.", { inline_keyboard: [[{ text: "◀️ К категории", callback_data: `category:view:${first}` }]] }); return; }
      await db.update(categories).set({ isPublished: !category.isPublished, updatedAt: new Date().toISOString() }).where(eq(categories.id, first));
    }
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

async function denyTelegramAccess(token: string, chatId: number, adminId: number, role: TelegramRole, permission: TelegramPermission, target: string) {
  await Promise.allSettled([
    audit(getDb(), adminId, "access.denied", null, { role, permission, target: target.slice(0, 128) }),
    sendMessage(token, chatId, `Доступ закрыт.\nВаша роль: ${telegramRoleLabels[role]}\nДля этого действия нужны другие права.`, backKeyboard()),
  ]);
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
    const role = resolveTelegramRole(from.id, botEnv.TELEGRAM_ADMIN_IDS, botEnv.TELEGRAM_ADMIN_ROLES);
    if (!role) return Response.json({ ok: true });

    if (callback) {
      await answerCallback(token, callback.id);
      if (callback.data) {
        const permission = telegramCallbackPermission(callback.data);
        if (permission && !telegramRoleCan(role, permission)) {
          await denyTelegramAccess(token, chatId, from.id, role, permission, callback.data);
          return Response.json({ ok: true });
        }
        await handleCallback(token, chatId, from.id, callback.data, role);
      }
      return Response.json({ ok: true });
    }

    let { text = "" } = message!;
    const replyContext = message?.reply_to_message?.text ?? "";
    const replyPermission = telegramReplyPermission(replyContext);
    if (replyPermission && !telegramRoleCan(role, replyPermission)) {
      await denyTelegramAccess(token, chatId, from.id, role, replyPermission, replyContext);
      return Response.json({ ok: true });
    }
    if (await handleFulfillmentReply(token, chatId, from.id, message!.message_id, text, replyContext, role)) return Response.json({ ok: true });
    if (telegramRoleCan(role, "catalog.write") && await handleCatalogAdminMessage({ token, chatId, adminId: from.id }, text, replyContext)) return Response.json({ ok: true });
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
    const commandPermission = telegramCommandPermission(command);
    if (commandPermission && !telegramRoleCan(role, commandPermission)) {
      await denyTelegramAccess(token, chatId, from.id, role, commandPermission, command);
      return Response.json({ ok: true });
    }
    if (command === "/start" || command === "/help") {
      await sendAdminMenu(token, chatId, role);
    } else if (command === "/payment_requisites") {
      await handleCallback(token, chatId, from.id, "settings:payment", role);
    } else if (command === "/email") {
      await handleCallback(token, chatId, from.id, "settings:email", role);
    } else if (command === "/products") {
      await handleCatalogAdminCallback({ token, chatId, adminId: from.id }, "products:list");
    } else if (command === "/countries") {
      await handleCatalogAdminCallback({ token, chatId, adminId: from.id }, "countries:list");
    } else if (command === "/operators") {
      await handleCatalogAdminCallback({ token, chatId, adminId: from.id }, "operators:list");
    } else if (command === "/status") {
      await handleCallback(token, chatId, from.id, "status", role);
    } else if (command === "/backup") {
      await handleCallback(token, chatId, from.id, "backup:prompt", role);
    } else if (command === "/audit") {
      await sendAuditPage(getDb(), token, chatId, from.id);
    } else if (command === "/errors") {
      await sendOperationalErrors(getDb(), token, chatId, from.id, 24);
    } else if (command === "/analytics") {
      await sendAnalyticsSummary(getDb(), token, chatId, 7, role);
    } else if (command === "/promocodes") {
      await sendPromoCodes(getDb(), token, chatId, role);
    } else if (command === "/customers") {
      await sendCustomersPage(getDb(), token, chatId);
    } else if (command === "/orders") {
      await sendOrdersPage(getDb(), token, chatId);
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
            const paidAt = new Date().toISOString();
            const [changed] = await db.update(orders).set({ status: "PAID", paidAt, updatedAt: paidAt }).where(and(eq(orders.id, order.id), eq(orders.status, "WAITING_FOR_MANAGER"))).returning({ id: orders.id });
            if (!changed) { await sendMessage(token, chatId, "Статус заказа уже изменился. Откройте его заново.", orderBackKeyboard(order.orderNumber)); return; }
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
      await sendMessage(token, chatId, `Категории:\n\n${lines}`, mainKeyboard(role));
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
    await recordOperationalEvent({ kind: "api_error", severity: "critical", area: "telegram", path: "/api/telegram/webhook", code: "telegram_webhook_failed" });
    return new Response(null, { status: 500 });
  }
}
