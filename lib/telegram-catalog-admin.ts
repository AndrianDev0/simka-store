import { and, asc, eq, isNull, like } from "drizzle-orm";
import { getDb } from "@/db";
import {
  adminAuditLog,
  catalogProducts,
  categories,
  countries,
  operators,
  orderItems,
  productCategories,
  productImages,
  productVariants,
} from "@/db/schema";
import { recordSlugRedirect } from "@/lib/slug-redirects";

type Db = ReturnType<typeof getDb>;
type InlineButton = { text: string; callback_data?: string; url?: string };
type InlineKeyboard = { inline_keyboard: Array<Array<InlineButton>> };
type ReplyMarkup = InlineKeyboard | { force_reply: true; selective: true; input_field_placeholder?: string };

type HandlerContext = {
  token: string;
  chatId: number;
  adminId: number;
};

const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const currencyPattern = /^[A-Z]{3}$/;

async function sendMessage(token: string, chatId: number, text: string, replyMarkup?: ReplyMarkup) {
  const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, ...(replyMarkup ? { reply_markup: replyMarkup } : {}) }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error("TELEGRAM_SEND_FAILED");
}

async function audit(db: Db, adminId: number, action: string, entityId: string | null, metadata: Record<string, unknown> = {}) {
  await db.insert(adminAuditLog).values({
    id: crypto.randomUUID(),
    adminTelegramId: String(adminId),
    action,
    entityType: action.split(".")[0] || "catalog",
    entityId,
    metadata: JSON.stringify(metadata),
  });
}

function back(callbackData: string, label = "◀️ Назад"): InlineKeyboard {
  return { inline_keyboard: [[{ text: label, callback_data: callbackData }]] };
}

function clip(value: string | null | undefined, max = 700) {
  if (!value) return "не задано";
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}

function rowsOfTwo(buttons: InlineButton[]) {
  const rows: Array<Array<InlineButton>> = [];
  for (let index = 0; index < buttons.length; index += 2) rows.push(buttons.slice(index, index + 2));
  return rows;
}

function parseInteger(value: string, min: number, max: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= min && parsed <= max ? parsed : null;
}

function parseBoolean(value: string) {
  const normalized = value.trim().toLowerCase();
  if (["on", "yes", "true", "1", "да", "вкл"].includes(normalized)) return true;
  if (["off", "no", "false", "0", "нет", "выкл"].includes(normalized)) return false;
  return null;
}

function parseNullableUrl(value: string, allowRelative = false) {
  const normalized = value.trim();
  if (!normalized || normalized === "-") return null;
  if (allowRelative && normalized.startsWith("/")) return normalized;
  try {
    const url = new URL(normalized);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

function parseJsonObject(value: string) {
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, string | number | boolean | null> : null;
  } catch {
    return null;
  }
}

function parseFaq(value: string) {
  if (!value.trim() || value.trim() === "-") return [];
  const entries = value.split(/\r?\n/).map((line) => line.split("|").map((part) => part.trim())).filter((parts) => parts.length >= 2 && parts[0] && parts.slice(1).join(" | "));
  return entries.length ? entries.map(([question, ...answer]) => ({ question, answer: answer.join(" | ") })) : null;
}

async function resolveCategoryByPrefix(db: Db, prefix: string) {
  if (!/^[0-9a-f-]{8,36}$/i.test(prefix)) return null;
  const matches = await db.select({ id: categories.id, name: categories.name }).from(categories).where(like(categories.id, `${prefix}%`)).limit(2);
  return matches.length === 1 ? matches[0] : null;
}

async function listCountries(db: Db, token: string, chatId: number) {
  const list = await db.select({ id: countries.id, name: countries.name, publicationStatus: countries.publicationStatus }).from(countries).orderBy(asc(countries.sortOrder), asc(countries.name)).limit(80);
  const rows = list.map((country) => [{ text: `${country.publicationStatus === "PUBLISHED" ? "🌍" : "📝"} ${country.name.slice(0, 52)}`, callback_data: `country:view:${country.id}` }]);
  rows.push([{ text: "➕ Создать страну", callback_data: "country:create" }]);
  rows.push([{ text: "◀️ В меню", callback_data: "menu" }]);
  await sendMessage(token, chatId, list.length ? "Страны каталога:" : "Стран пока нет.", { inline_keyboard: rows });
}

async function showCountry(db: Db, token: string, chatId: number, countryId: number) {
  const [country] = await db.select().from(countries).where(eq(countries.id, countryId)).limit(1);
  if (!country) { await sendMessage(token, chatId, "Страна не найдена.", back("countries:list")); return; }
  const [operatorCount, productCount] = await Promise.all([
    db.select({ id: operators.id }).from(operators).where(eq(operators.countryId, country.id)),
    db.select({ id: catalogProducts.id }).from(catalogProducts).where(eq(catalogProducts.countryId, country.id)),
  ]);
  const text = [
    `${country.flag || "🌍"} ${country.name}`,
    `ID: ${country.id} · Slug: ${country.slug}`,
    `ISO: ${country.isoCode || "—"} · Регион: ${country.region || "—"}`,
    `Статус: ${country.publicationStatus} · Индексация: ${country.noindex ? "NOINDEX" : "INDEX"}`,
    `Порядок: ${country.sortOrder}`,
    `Операторы: ${operatorCount.length} · Товары: ${productCount.length}`,
    "",
    clip(country.description),
  ].join("\n");
  await sendMessage(token, chatId, text, { inline_keyboard: [
    [{ text: country.publicationStatus === "PUBLISHED" ? "⏸ Снять с публикации" : "▶️ Опубликовать", callback_data: `country:publish:${country.id}` }],
    [{ text: country.noindex ? "🔓 Разрешить индексацию" : "🔒 Закрыть индексацию", callback_data: `country:index:${country.id}` }],
    [{ text: country.archivedAt ? "♻️ Восстановить" : "📦 Архивировать", callback_data: `country:${country.archivedAt ? "restore" : "archive"}:${country.id}` }],
    [{ text: "✏️ Изменить данные / SEO", callback_data: `country:edit:${country.id}` }],
    [{ text: "🗑 Удалить", callback_data: `country:delete_prompt:${country.id}` }],
    [{ text: "◀️ К странам", callback_data: "countries:list" }],
  ] });
}

const countryFields = {
  n: ["Название", "name"], sl: ["Slug", "slug"], iso: ["ISO-код", "isoCode"], f: ["Флаг", "flag"], r: ["Регион", "region"],
  d: ["Описание", "description"], im: ["Изображение", "imageUrl"], st: ["SEO title", "seoTitle"], sd: ["SEO description", "seoDescription"],
  h: ["H1", "h1"], sx: ["SEO-текст", "seoText"], cu: ["Canonical", "canonicalUrl"], faq: ["FAQ", "faq"], so: ["Порядок", "sortOrder"],
} as const;

function countryEditKeyboard(id: number): InlineKeyboard {
  return { inline_keyboard: [
    ...rowsOfTwo(Object.entries(countryFields).map(([code, [label]]) => ({ text: `✏️ ${label}`, callback_data: `country:field:${id}:${code}` }))),
    [{ text: "◀️ К стране", callback_data: `country:view:${id}` }],
  ] };
}

async function listOperators(db: Db, token: string, chatId: number) {
  const list = await db.select({ id: operators.id, name: operators.name, publicationStatus: operators.publicationStatus, country: countries.name }).from(operators).innerJoin(countries, eq(operators.countryId, countries.id)).orderBy(asc(countries.name), asc(operators.sortOrder), asc(operators.name)).limit(80);
  const rows = list.map((operator) => [{ text: `${operator.publicationStatus === "PUBLISHED" ? "📡" : "📝"} ${`${operator.country} · ${operator.name}`.slice(0, 52)}`, callback_data: `operator:view:${operator.id}` }]);
  rows.push([{ text: "➕ Создать оператора", callback_data: "operator:create" }]);
  rows.push([{ text: "◀️ В меню", callback_data: "menu" }]);
  await sendMessage(token, chatId, list.length ? "Операторы каталога:" : "Операторов пока нет.", { inline_keyboard: rows });
}

async function showOperator(db: Db, token: string, chatId: number, operatorId: number) {
  const [operator] = await db.select({ id: operators.id, countryId: operators.countryId, country: countries.name, name: operators.name, slug: operators.slug, description: operators.description, logoUrl: operators.logoUrl, publicationStatus: operators.publicationStatus, sortOrder: operators.sortOrder, archivedAt: operators.archivedAt }).from(operators).innerJoin(countries, eq(operators.countryId, countries.id)).where(eq(operators.id, operatorId)).limit(1);
  if (!operator) { await sendMessage(token, chatId, "Оператор не найден.", back("operators:list")); return; }
  const linked = await db.select({ id: catalogProducts.id }).from(catalogProducts).where(eq(catalogProducts.operatorId, operator.id));
  await sendMessage(token, chatId, [`📡 ${operator.name}`, `ID: ${operator.id} · Slug: ${operator.slug}`, `Страна: ${operator.country} (ID ${operator.countryId})`, `Статус: ${operator.publicationStatus}`, `Порядок: ${operator.sortOrder} · Товары: ${linked.length}`, "", clip(operator.description)].join("\n"), { inline_keyboard: [
    [{ text: operator.publicationStatus === "PUBLISHED" ? "⏸ Снять с публикации" : "▶️ Опубликовать", callback_data: `operator:publish:${operator.id}` }],
    [{ text: operator.archivedAt ? "♻️ Восстановить" : "📦 Архивировать", callback_data: `operator:${operator.archivedAt ? "restore" : "archive"}:${operator.id}` }],
    [{ text: "✏️ Изменить", callback_data: `operator:edit:${operator.id}` }],
    [{ text: "🗑 Удалить", callback_data: `operator:delete_prompt:${operator.id}` }],
    [{ text: "◀️ К операторам", callback_data: "operators:list" }],
  ] });
}

const operatorFields = {
  n: ["Название", "name"], sl: ["Slug", "slug"], co: ["ID страны", "countryId"], d: ["Описание", "description"],
  lg: ["Логотип", "logoUrl"], so: ["Порядок", "sortOrder"],
} as const;

function operatorEditKeyboard(id: number): InlineKeyboard {
  return { inline_keyboard: [
    ...rowsOfTwo(Object.entries(operatorFields).map(([code, [label]]) => ({ text: `✏️ ${label}`, callback_data: `operator:field:${id}:${code}` }))),
    [{ text: "◀️ К оператору", callback_data: `operator:view:${id}` }],
  ] };
}

async function listProducts(db: Db, token: string, chatId: number) {
  const list = await db.select({ id: catalogProducts.id, name: catalogProducts.name, publicationStatus: catalogProducts.publicationStatus, available: catalogProducts.available }).from(catalogProducts).orderBy(asc(catalogProducts.sortOrder), asc(catalogProducts.id)).limit(80);
  const rows = list.map((product) => [{ text: `${product.publicationStatus === "PUBLISHED" ? product.available ? "🟢" : "🟠" : "📝"} ${product.id} · ${product.name.slice(0, 40)}`, callback_data: `product:view:${product.id}` }]);
  rows.push([{ text: "➕ Создать товар", callback_data: "product:create" }]);
  rows.push([{ text: "◀️ В меню", callback_data: "menu" }]);
  await sendMessage(token, chatId, list.length ? "Товары каталога:" : "Товаров пока нет.", { inline_keyboard: rows });
}

async function showProduct(db: Db, token: string, chatId: number, productId: number) {
  const [product] = await db.select({
    id: catalogProducts.id, name: catalogProducts.name, sku: catalogProducts.sku, slug: catalogProducts.slug, countryId: catalogProducts.countryId,
    operatorId: catalogProducts.operatorId, country: countries.name, operator: operators.name, simType: catalogProducts.simType, price: catalogProducts.price,
    currency: catalogProducts.currency, dataVolume: catalogProducts.dataVolume, validityDays: catalogProducts.validityDays, available: catalogProducts.available,
    availabilityStatus: catalogProducts.availabilityStatus, stockQuantity: catalogProducts.stockQuantity, publicationStatus: catalogProducts.publicationStatus,
    archivedAt: catalogProducts.archivedAt, shortDescription: catalogProducts.shortDescription,
  }).from(catalogProducts).innerJoin(countries, eq(catalogProducts.countryId, countries.id)).innerJoin(operators, eq(catalogProducts.operatorId, operators.id)).where(eq(catalogProducts.id, productId)).limit(1);
  if (!product) { await sendMessage(token, chatId, "Товар не найден.", back("products:list")); return; }
  const [variantRows, imageRows, categoryRows] = await Promise.all([
    db.select({ id: productVariants.id }).from(productVariants).where(eq(productVariants.productId, product.id)),
    db.select({ id: productImages.id }).from(productImages).where(eq(productImages.productId, product.id)),
    db.select({ categoryId: productCategories.categoryId }).from(productCategories).where(eq(productCategories.productId, product.id)),
  ]);
  await sendMessage(token, chatId, [
    `📦 ${product.name}`, `ID: ${product.id} · SKU: ${product.sku}`, `Slug: ${product.slug}`, `${product.country} · ${product.operator} · ${product.simType}`,
    `Цена: ${product.price.toLocaleString("ru-RU")} ${product.currency}`, `Интернет: ${product.dataVolume} · ${product.validityDays} дней`,
    `Статус: ${product.publicationStatus} · ${product.available ? product.availabilityStatus : "НЕДОСТУПЕН"}`, `Остаток: ${product.stockQuantity ?? "без ограничения"}`,
    `Варианты: ${variantRows.length} · Изображения: ${imageRows.length} · Категории: ${categoryRows.length}`, "", clip(product.shortDescription),
  ].join("\n"), { inline_keyboard: [
    [{ text: product.publicationStatus === "PUBLISHED" ? "⏸ Снять с публикации" : "▶️ Опубликовать", callback_data: `product:publish:${product.id}` }],
    [{ text: product.available ? "⛔ Снять с наличия" : "✅ Отметить в наличии", callback_data: `product:availability:${product.id}` }],
    [{ text: product.archivedAt ? "♻️ Восстановить" : "📦 Архивировать", callback_data: `product:${product.archivedAt ? "restore" : "archive"}:${product.id}` }],
    [{ text: "✏️ Все поля", callback_data: `product:edit:${product.id}` }],
    [{ text: `🧩 Варианты (${variantRows.length})`, callback_data: `product:variants:${product.id}` }, { text: `🖼 Изображения (${imageRows.length})`, callback_data: `product:images:${product.id}` }],
    [{ text: `📂 Категории (${categoryRows.length})`, callback_data: `product:categories:${product.id}` }],
    [{ text: "🗑 Удалить", callback_data: `product:delete_prompt:${product.id}` }],
    [{ text: "◀️ К товарам", callback_data: "products:list" }],
  ] });
}

const productFields = {
  n: ["Название", "name"], sk: ["SKU", "sku"], sl: ["Slug", "slug"], co: ["ID страны", "countryId"], op: ["ID оператора", "operatorId"], ty: ["Тип SIM", "simType"],
  pr: ["Цена", "price"], old: ["Старая цена", "oldPrice"], cur: ["Валюта", "currency"], sh: ["Краткое описание", "shortDescription"],
  full: ["Полное описание", "fullDescription"], ch: ["Характеристики JSON", "characteristics"], vd: ["Срок, дней", "validityDays"], dv: ["Объём интернета", "dataVolume"],
  dm: ["Интернет, МБ", "dataMb"], un: ["Безлимит", "isUnlimited"], hc: ["Есть звонки", "hasCalls"], cd: ["Условия звонков", "callsDetails"],
  hs: ["Есть SMS", "hasSms"], sm: ["Условия SMS", "smsDetails"], rt: ["Роуминг", "roamingTerms"], at: ["Активация", "activationTerms"],
  comp: ["Совместимость", "compatibility"], ins: ["Инструкция", "instructions"], pop: ["Популярный", "popular"], qty: ["Остаток", "stockQuantity"],
  st: ["SEO title", "seoTitle"], sd: ["SEO description", "seoDescription"], h: ["H1", "h1"], sx: ["SEO-текст", "seoText"], cu: ["Canonical", "canonicalUrl"],
  ot: ["OG title", "ogTitle"], od: ["OG description", "ogDescription"], oi: ["OG image", "ogImage"], so: ["Порядок", "sortOrder"],
} as const;

function productEditKeyboard(id: number): InlineKeyboard {
  return { inline_keyboard: [
    ...rowsOfTwo(Object.entries(productFields).map(([code, [label]]) => ({ text: `✏️ ${label}`, callback_data: `product:field:${id}:${code}` }))),
    [{ text: "◀️ К товару", callback_data: `product:view:${id}` }],
  ] };
}

const variantFields = {
  n: ["Название", "name"], sk: ["SKU", "sku"], sl: ["Slug", "slug"], pr: ["Цена", "price"], cur: ["Валюта", "currency"],
  dv: ["Объём интернета", "dataVolume"], vd: ["Срок, дней", "validityDays"], ch: ["Характеристики JSON", "characteristics"], qty: ["Остаток", "stockQuantity"], so: ["Порядок", "sortOrder"],
} as const;

async function listVariants(db: Db, token: string, chatId: number, productId: number) {
  const product = await db.select({ id: catalogProducts.id, name: catalogProducts.name }).from(catalogProducts).where(eq(catalogProducts.id, productId)).limit(1);
  if (!product[0]) { await sendMessage(token, chatId, "Товар не найден.", back("products:list")); return; }
  const list = await db.select({ id: productVariants.id, name: productVariants.name, available: productVariants.available }).from(productVariants).where(eq(productVariants.productId, productId)).orderBy(asc(productVariants.sortOrder), asc(productVariants.id));
  const rows = list.map((variant) => [{ text: `${variant.available ? "🟢" : "⚪"} ${variant.name}`, callback_data: `variant:view:${variant.id}` }]);
  rows.push([{ text: "➕ Создать вариант", callback_data: `variant:create:${productId}` }]);
  rows.push([{ text: "◀️ К товару", callback_data: `product:view:${productId}` }]);
  await sendMessage(token, chatId, `Варианты товара «${product[0].name}»:`, { inline_keyboard: rows });
}

async function showVariant(db: Db, token: string, chatId: number, variantId: number) {
  const [variant] = await db.select().from(productVariants).where(eq(productVariants.id, variantId)).limit(1);
  if (!variant) { await sendMessage(token, chatId, "Вариант не найден.", back("products:list")); return; }
  await sendMessage(token, chatId, [`🧩 ${variant.name}`, `ID: ${variant.id} · SKU: ${variant.sku}`, `Slug: ${variant.slug}`, `Цена: ${variant.price.toLocaleString("ru-RU")} ${variant.currency}`, `Интернет: ${variant.dataVolume || "—"} · Срок: ${variant.validityDays ?? "—"}`, `Наличие: ${variant.available ? variant.availabilityStatus : "НЕДОСТУПЕН"} · Остаток: ${variant.stockQuantity ?? "без ограничения"}`].join("\n"), { inline_keyboard: [
    [{ text: variant.available ? "⛔ Снять с наличия" : "✅ Отметить в наличии", callback_data: `variant:availability:${variant.id}` }],
    [{ text: "✏️ Изменить", callback_data: `variant:edit:${variant.id}` }],
    [{ text: "🗑 Удалить", callback_data: `variant:delete_prompt:${variant.id}` }],
    [{ text: "◀️ К вариантам", callback_data: `product:variants:${variant.productId}` }],
  ] });
}

function variantEditKeyboard(id: number): InlineKeyboard {
  return { inline_keyboard: [
    ...rowsOfTwo(Object.entries(variantFields).map(([code, [label]]) => ({ text: `✏️ ${label}`, callback_data: `variant:field:${id}:${code}` }))),
    [{ text: "◀️ К варианту", callback_data: `variant:view:${id}` }],
  ] };
}

async function listImages(db: Db, token: string, chatId: number, productId: number) {
  const product = await db.select({ id: catalogProducts.id, name: catalogProducts.name }).from(catalogProducts).where(eq(catalogProducts.id, productId)).limit(1);
  if (!product[0]) { await sendMessage(token, chatId, "Товар не найден.", back("products:list")); return; }
  const list = await db.select({ id: productImages.id, alt: productImages.alt, isPrimary: productImages.isPrimary }).from(productImages).where(eq(productImages.productId, productId)).orderBy(asc(productImages.sortOrder), asc(productImages.id));
  const rows = list.map((image) => [{ text: `${image.isPrimary ? "⭐" : "🖼"} ${image.id} · ${clip(image.alt, 32)}`, callback_data: `image:view:${image.id}` }]);
  rows.push([{ text: "➕ Добавить изображение", callback_data: `image:create:${productId}` }]);
  rows.push([{ text: "◀️ К товару", callback_data: `product:view:${productId}` }]);
  await sendMessage(token, chatId, `Изображения товара «${product[0].name}»:`, { inline_keyboard: rows });
}

async function showImage(db: Db, token: string, chatId: number, imageId: number) {
  const [image] = await db.select().from(productImages).where(eq(productImages.id, imageId)).limit(1);
  if (!image) { await sendMessage(token, chatId, "Изображение не найдено.", back("products:list")); return; }
  await sendMessage(token, chatId, [`🖼 Изображение ${image.id}`, `URL: ${clip(image.url, 1000)}`, `Alt: ${image.alt || "—"}`, `Порядок: ${image.sortOrder}`, `Основное: ${image.isPrimary ? "да" : "нет"}`].join("\n"), { inline_keyboard: [
    [{ text: "⭐ Сделать основным", callback_data: `image:primary:${image.id}` }],
    [{ text: "🗑 Удалить", callback_data: `image:delete_prompt:${image.id}` }],
    [{ text: "◀️ К изображениям", callback_data: `product:images:${image.productId}` }],
  ] });
}

async function handleCallbackInner(context: HandlerContext, data: string): Promise<boolean> {
  const { token, chatId, adminId } = context;
  const db = getDb();
  const [scope, action, first, second] = data.split(":");

  if (scope === "countries" && action === "list") { await listCountries(db, token, chatId); return true; }
  if (scope === "country" && action === "create") {
    await sendMessage(token, chatId, "[CREATE_COUNTRY]\nВведите: slug | Название | Флаг | Регион | ISO-код", { force_reply: true, selective: true, input_field_placeholder: "turkey | Турция | 🇹🇷 | Европа | TR" });
    return true;
  }
  if (scope === "country" && action === "view" && first) { await showCountry(db, token, chatId, Number(first)); return true; }
  if (scope === "country" && action === "edit" && first) { await sendMessage(token, chatId, "Выберите поле страны:", countryEditKeyboard(Number(first))); return true; }
  if (scope === "country" && action === "field" && first && second && second in countryFields) {
    const label = countryFields[second as keyof typeof countryFields][0];
    const hint = second === "faq" ? "Каждый вопрос с новой строки: Вопрос | Ответ" : second === "so" ? "Целое число от 0" : "Новое значение; для очистки отправьте -";
    await sendMessage(token, chatId, `[EDIT_COUNTRY:${first}:${second}]\n${label}. ${hint}`, { force_reply: true, selective: true, input_field_placeholder: label });
    return true;
  }
  if (scope === "country" && action === "delete_prompt" && first) {
    await sendMessage(token, chatId, "Удалить страну? Удаление будет запрещено, если есть операторы или товары.", { inline_keyboard: [[{ text: "Да, удалить", callback_data: `country:delete_confirm:${first}` }], [{ text: "Отмена", callback_data: `country:view:${first}` }]] });
    return true;
  }
  if (scope === "country" && ["publish", "index", "archive", "restore", "delete_confirm"].includes(action) && first) {
    const id = Number(first);
    const [country] = await db.select().from(countries).where(eq(countries.id, id)).limit(1);
    if (!country) { await sendMessage(token, chatId, "Страна не найдена.", back("countries:list")); return true; }
    if (action === "delete_confirm") {
      const [linkedOperator, linkedProduct] = await Promise.all([
        db.select({ id: operators.id }).from(operators).where(eq(operators.countryId, id)).limit(1),
        db.select({ id: catalogProducts.id }).from(catalogProducts).where(eq(catalogProducts.countryId, id)).limit(1),
      ]);
      if (linkedOperator[0] || linkedProduct[0]) { await sendMessage(token, chatId, "Нельзя удалить страну: сначала удалите или перенесите связанные товары и операторов.", back(`country:view:${id}`)); return true; }
      await db.delete(countries).where(eq(countries.id, id));
      await audit(db, adminId, "country.delete", String(id), { slug: country.slug });
      await listCountries(db, token, chatId);
      return true;
    }
    if (action === "publish") await db.update(countries).set({ publicationStatus: country.publicationStatus === "PUBLISHED" ? "DRAFT" : "PUBLISHED", archivedAt: null, updatedAt: new Date().toISOString() }).where(eq(countries.id, id));
    if (action === "index") await db.update(countries).set({ noindex: !country.noindex, updatedAt: new Date().toISOString() }).where(eq(countries.id, id));
    if (action === "archive") await db.update(countries).set({ publicationStatus: "ARCHIVED", archivedAt: new Date().toISOString(), updatedAt: new Date().toISOString() }).where(eq(countries.id, id));
    if (action === "restore") await db.update(countries).set({ publicationStatus: "DRAFT", archivedAt: null, updatedAt: new Date().toISOString() }).where(eq(countries.id, id));
    await audit(db, adminId, `country.${action}`, String(id));
    await showCountry(db, token, chatId, id);
    return true;
  }

  if (scope === "operators" && action === "list") { await listOperators(db, token, chatId); return true; }
  if (scope === "operator" && action === "create") {
    const list = await db.select({ id: countries.id, name: countries.name }).from(countries).where(isNull(countries.archivedAt)).orderBy(asc(countries.sortOrder), asc(countries.name)).limit(40);
    await sendMessage(token, chatId, `[CREATE_OPERATOR]\nВведите: ID страны | slug | Название | Описание\n\nДоступные страны:\n${list.map((item) => `${item.id} · ${item.name}`).join("\n")}`, { force_reply: true, selective: true, input_field_placeholder: "1 | turkcell | Turkcell | Описание" });
    return true;
  }
  if (scope === "operator" && action === "view" && first) { await showOperator(db, token, chatId, Number(first)); return true; }
  if (scope === "operator" && action === "edit" && first) { await sendMessage(token, chatId, "Выберите поле оператора:", operatorEditKeyboard(Number(first))); return true; }
  if (scope === "operator" && action === "field" && first && second && second in operatorFields) {
    const label = operatorFields[second as keyof typeof operatorFields][0];
    await sendMessage(token, chatId, `[EDIT_OPERATOR:${first}:${second}]\nВведите: ${label}. Для очистки необязательного поля отправьте -`, { force_reply: true, selective: true, input_field_placeholder: label });
    return true;
  }
  if (scope === "operator" && action === "delete_prompt" && first) {
    await sendMessage(token, chatId, "Удалить оператора? Удаление будет запрещено, если к нему привязаны товары.", { inline_keyboard: [[{ text: "Да, удалить", callback_data: `operator:delete_confirm:${first}` }], [{ text: "Отмена", callback_data: `operator:view:${first}` }]] });
    return true;
  }
  if (scope === "operator" && ["publish", "archive", "restore", "delete_confirm"].includes(action) && first) {
    const id = Number(first);
    const [operator] = await db.select().from(operators).where(eq(operators.id, id)).limit(1);
    if (!operator) { await sendMessage(token, chatId, "Оператор не найден.", back("operators:list")); return true; }
    if (action === "delete_confirm") {
      const linked = await db.select({ id: catalogProducts.id }).from(catalogProducts).where(eq(catalogProducts.operatorId, id)).limit(1);
      if (linked[0]) { await sendMessage(token, chatId, "Нельзя удалить оператора: сначала удалите или перенесите связанные товары.", back(`operator:view:${id}`)); return true; }
      await db.delete(operators).where(eq(operators.id, id));
      await audit(db, adminId, "operator.delete", String(id), { slug: operator.slug });
      await listOperators(db, token, chatId);
      return true;
    }
    if (action === "publish") await db.update(operators).set({ publicationStatus: operator.publicationStatus === "PUBLISHED" ? "DRAFT" : "PUBLISHED", archivedAt: null, updatedAt: new Date().toISOString() }).where(eq(operators.id, id));
    if (action === "archive") await db.update(operators).set({ publicationStatus: "ARCHIVED", archivedAt: new Date().toISOString(), updatedAt: new Date().toISOString() }).where(eq(operators.id, id));
    if (action === "restore") await db.update(operators).set({ publicationStatus: "DRAFT", archivedAt: null, updatedAt: new Date().toISOString() }).where(eq(operators.id, id));
    await audit(db, adminId, `operator.${action}`, String(id));
    await showOperator(db, token, chatId, id);
    return true;
  }

  if (scope === "products" && action === "list") { await listProducts(db, token, chatId); return true; }
  if (scope === "product" && action === "create") {
    const [countryRows, operatorRows] = await Promise.all([
      db.select({ id: countries.id, name: countries.name }).from(countries).where(isNull(countries.archivedAt)).orderBy(asc(countries.name)).limit(30),
      db.select({ id: operators.id, countryId: operators.countryId, name: operators.name }).from(operators).where(isNull(operators.archivedAt)).orderBy(asc(operators.name)).limit(40),
    ]);
    const reference = [`Страны: ${countryRows.map((item) => `${item.id}=${item.name.slice(0, 24)}`).join(", ")}`, `Операторы: ${operatorRows.map((item) => `${item.id}=${item.name.slice(0, 24)}(страна ${item.countryId})`).join(", ")}`].join("\n").slice(0, 2500);
    await sendMessage(token, chatId, `[CREATE_PRODUCT]\nВведите: SKU | slug | Название | ID страны | ID оператора | eSIM или SIM | Цена | Интернет | Дней\n\n${reference}`, { force_reply: true, selective: true, input_field_placeholder: "TR-20 | turkey-20gb | Турция 20 ГБ | 1 | 1 | eSIM | 2490 | 20 ГБ | 30" });
    return true;
  }
  if (scope === "product" && action === "view" && first) { await showProduct(db, token, chatId, Number(first)); return true; }
  if (scope === "product" && action === "edit" && first) { await sendMessage(token, chatId, "Выберите поле товара:", productEditKeyboard(Number(first))); return true; }
  if (scope === "product" && action === "field" && first && second && second in productFields) {
    const label = productFields[second as keyof typeof productFields][0];
    const hint = ["un", "hc", "hs", "pop"].includes(second) ? "Введите on или off" : second === "ch" ? "Введите JSON-объект, например {\"скорость\":\"5G\"}" : "Для очистки необязательного поля отправьте -";
    await sendMessage(token, chatId, `[EDIT_PRODUCT:${first}:${second}]\n${label}. ${hint}`, { force_reply: true, selective: true, input_field_placeholder: label });
    return true;
  }
  if (scope === "product" && action === "variants" && first) { await listVariants(db, token, chatId, Number(first)); return true; }
  if (scope === "product" && action === "images" && first) { await listImages(db, token, chatId, Number(first)); return true; }
  if (scope === "product" && action === "categories" && first) {
    const productId = Number(first);
    const [product, list, assigned] = await Promise.all([
      db.select({ id: catalogProducts.id, name: catalogProducts.name }).from(catalogProducts).where(eq(catalogProducts.id, productId)).limit(1),
      db.select({ id: categories.id, name: categories.name }).from(categories).where(isNull(categories.archivedAt)).orderBy(asc(categories.sortOrder), asc(categories.name)).limit(80),
      db.select({ categoryId: productCategories.categoryId }).from(productCategories).where(eq(productCategories.productId, productId)),
    ]);
    if (!product[0]) { await sendMessage(token, chatId, "Товар не найден.", back("products:list")); return true; }
    const selected = new Set(assigned.map((item) => item.categoryId));
    const rows = list.map((category) => [{ text: `${selected.has(category.id) ? "✅ Снять" : "➕ Назначить"} ${category.name}`, callback_data: `pc:${productId}:${category.id.slice(0, 12)}` }]);
    rows.push([{ text: "◀️ К товару", callback_data: `product:view:${productId}` }]);
    await sendMessage(token, chatId, `Категории товара «${product[0].name}»:`, { inline_keyboard: rows });
    return true;
  }
  if (scope === "pc" && action && first) {
    const productId = Number(action);
    const category = await resolveCategoryByPrefix(db, first);
    const product = await db.select({ id: catalogProducts.id }).from(catalogProducts).where(eq(catalogProducts.id, productId)).limit(1);
    if (!product[0] || !category) { await sendMessage(token, chatId, "Товар или категория не найдены.", back("products:list")); return true; }
    const linked = await db.select().from(productCategories).where(and(eq(productCategories.productId, productId), eq(productCategories.categoryId, category.id))).limit(1);
    if (linked[0]) await db.delete(productCategories).where(and(eq(productCategories.productId, productId), eq(productCategories.categoryId, category.id)));
    else await db.insert(productCategories).values({ productId, categoryId: category.id });
    await audit(db, adminId, linked[0] ? "product.unassign_category" : "product.assign_category", String(productId), { categoryId: category.id });
    await handleCallbackInner(context, `product:categories:${productId}`);
    return true;
  }
  if (scope === "product" && action === "delete_prompt" && first) {
    await sendMessage(token, chatId, "Удалить товар безвозвратно? Если он уже встречается в заказах, удаление будет запрещено — используйте архив.", { inline_keyboard: [[{ text: "Да, удалить", callback_data: `product:delete_confirm:${first}` }], [{ text: "Отмена", callback_data: `product:view:${first}` }]] });
    return true;
  }
  if (scope === "product" && ["publish", "availability", "archive", "restore", "delete_confirm"].includes(action) && first) {
    const id = Number(first);
    const [product] = await db.select().from(catalogProducts).where(eq(catalogProducts.id, id)).limit(1);
    if (!product) { await sendMessage(token, chatId, "Товар не найден.", back("products:list")); return true; }
    if (action === "delete_confirm") {
      const historical = await db.select({ id: orderItems.id }).from(orderItems).where(eq(orderItems.productId, id)).limit(1);
      if (historical[0]) { await sendMessage(token, chatId, "Товар есть в истории заказов, поэтому его можно только архивировать.", back(`product:view:${id}`)); return true; }
      await db.transaction(async (tx) => {
        await tx.delete(productCategories).where(eq(productCategories.productId, id));
        await tx.delete(catalogProducts).where(eq(catalogProducts.id, id));
      });
      await audit(db, adminId, "product.delete", String(id), { sku: product.sku });
      await listProducts(db, token, chatId);
      return true;
    }
    if (action === "publish" && product.publicationStatus !== "PUBLISHED") {
      const required: Array<[string, unknown]> = [
        ["краткое описание", product.shortDescription], ["полное описание", product.fullDescription], ["условия роуминга", product.roamingTerms],
        ["условия активации", product.activationTerms], ["совместимость", product.compatibility], ["инструкция", product.instructions],
      ];
      const missing = required.filter(([, value]) => typeof value !== "string" || !value.trim()).map(([label]) => label);
      const [country, operator] = await Promise.all([
        db.select({ publicationStatus: countries.publicationStatus }).from(countries).where(eq(countries.id, product.countryId)).limit(1),
        db.select({ publicationStatus: operators.publicationStatus }).from(operators).where(eq(operators.id, product.operatorId)).limit(1),
      ]);
      if (country[0]?.publicationStatus !== "PUBLISHED") missing.push("опубликованная страна");
      if (operator[0]?.publicationStatus !== "PUBLISHED") missing.push("опубликованный оператор");
      if (missing.length) {
        await sendMessage(token, chatId, `Сначала заполните обязательные данные: ${missing.join(", ")}.`, back(`product:view:${id}`));
        return true;
      }
    }
    if (action === "availability" && !product.available && product.stockQuantity === 0) {
      await sendMessage(token, chatId, "Остаток равен нулю. Сначала измените поле «Остаток», затем включите наличие.", back(`product:view:${id}`));
      return true;
    }
    if (action === "publish") await db.update(catalogProducts).set({ publicationStatus: product.publicationStatus === "PUBLISHED" ? "DRAFT" : "PUBLISHED", archivedAt: null, updatedAt: new Date().toISOString() }).where(eq(catalogProducts.id, id));
    if (action === "availability") await db.update(catalogProducts).set({ available: !product.available, availabilityStatus: product.available ? "OUT_OF_STOCK" : "IN_STOCK", updatedAt: new Date().toISOString() }).where(eq(catalogProducts.id, id));
    if (action === "archive") await db.update(catalogProducts).set({ publicationStatus: "ARCHIVED", archivedAt: new Date().toISOString(), available: false, updatedAt: new Date().toISOString() }).where(eq(catalogProducts.id, id));
    if (action === "restore") await db.update(catalogProducts).set({ publicationStatus: "DRAFT", archivedAt: null, updatedAt: new Date().toISOString() }).where(eq(catalogProducts.id, id));
    await audit(db, adminId, `product.${action}`, String(id));
    await showProduct(db, token, chatId, id);
    return true;
  }

  if (scope === "variant" && action === "create" && first) {
    await sendMessage(token, chatId, `[CREATE_VARIANT:${first}]\nВведите: SKU | slug | Название | Цена | Валюта | Интернет | Дней | Остаток`, { force_reply: true, selective: true, input_field_placeholder: "TR-10 | 10gb | 10 ГБ | 1490 | RUB | 10 ГБ | 15 | 25" });
    return true;
  }
  if (scope === "variant" && action === "view" && first) { await showVariant(db, token, chatId, Number(first)); return true; }
  if (scope === "variant" && action === "edit" && first) { await sendMessage(token, chatId, "Выберите поле варианта:", variantEditKeyboard(Number(first))); return true; }
  if (scope === "variant" && action === "field" && first && second && second in variantFields) {
    const label = variantFields[second as keyof typeof variantFields][0];
    await sendMessage(token, chatId, `[EDIT_VARIANT:${first}:${second}]\nВведите: ${label}. Для очистки необязательного поля отправьте -`, { force_reply: true, selective: true, input_field_placeholder: label });
    return true;
  }
  if (scope === "variant" && action === "delete_prompt" && first) {
    await sendMessage(token, chatId, "Удалить вариант? Исторические строки заказов сохранятся.", { inline_keyboard: [[{ text: "Да, удалить", callback_data: `variant:delete_confirm:${first}` }], [{ text: "Отмена", callback_data: `variant:view:${first}` }]] });
    return true;
  }
  if (scope === "variant" && ["availability", "delete_confirm"].includes(action) && first) {
    const id = Number(first);
    const [variant] = await db.select().from(productVariants).where(eq(productVariants.id, id)).limit(1);
    if (!variant) { await sendMessage(token, chatId, "Вариант не найден.", back("products:list")); return true; }
    if (action === "delete_confirm") {
      const historical = await db.select({ id: orderItems.id }).from(orderItems).where(eq(orderItems.variantId, id)).limit(1);
      if (historical[0]) { await sendMessage(token, chatId, "Вариант есть в истории заказов, поэтому удаление запрещено. Снимите его с наличия.", back(`variant:view:${id}`)); return true; }
      await db.delete(productVariants).where(eq(productVariants.id, id));
      await audit(db, adminId, "variant.delete", String(id), { productId: variant.productId, sku: variant.sku });
      await listVariants(db, token, chatId, variant.productId);
      return true;
    }
    if (!variant.available && variant.stockQuantity === 0) {
      await sendMessage(token, chatId, "Остаток варианта равен нулю. Сначала измените его, затем включите наличие.", back(`variant:view:${id}`));
      return true;
    }
    await db.update(productVariants).set({ available: !variant.available, availabilityStatus: variant.available ? "OUT_OF_STOCK" : "IN_STOCK", updatedAt: new Date().toISOString() }).where(eq(productVariants.id, id));
    await audit(db, adminId, "variant.availability", String(id), { available: !variant.available });
    await showVariant(db, token, chatId, id);
    return true;
  }

  if (scope === "image" && action === "create" && first) {
    await sendMessage(token, chatId, `[CREATE_IMAGE:${first}]\nВведите: URL | Alt-текст | Порядок`, { force_reply: true, selective: true, input_field_placeholder: "https://… | Описание изображения | 0" });
    return true;
  }
  if (scope === "image" && action === "view" && first) { await showImage(db, token, chatId, Number(first)); return true; }
  if (scope === "image" && action === "delete_prompt" && first) {
    await sendMessage(token, chatId, "Удалить изображение?", { inline_keyboard: [[{ text: "Да, удалить", callback_data: `image:delete_confirm:${first}` }], [{ text: "Отмена", callback_data: `image:view:${first}` }]] });
    return true;
  }
  if (scope === "image" && ["primary", "delete_confirm"].includes(action) && first) {
    const id = Number(first);
    const [image] = await db.select().from(productImages).where(eq(productImages.id, id)).limit(1);
    if (!image) { await sendMessage(token, chatId, "Изображение не найдено.", back("products:list")); return true; }
    if (action === "delete_confirm") {
      await db.delete(productImages).where(eq(productImages.id, id));
      await audit(db, adminId, "image.delete", String(id), { productId: image.productId });
      await listImages(db, token, chatId, image.productId);
      return true;
    }
    await db.transaction(async (tx) => {
      await tx.update(productImages).set({ isPrimary: false }).where(eq(productImages.productId, image.productId));
      await tx.update(productImages).set({ isPrimary: true }).where(eq(productImages.id, id));
    });
    await audit(db, adminId, "image.set_primary", String(id), { productId: image.productId });
    await showImage(db, token, chatId, id);
    return true;
  }

  return false;
}

export async function handleCatalogAdminCallback(context: HandlerContext, data: string) {
  try {
    return await handleCallbackInner(context, data);
  } catch (error) {
    console.error("telegram_catalog_callback_failed", { name: error instanceof Error ? error.name : "UnknownError" });
    await sendMessage(context.token, context.chatId, "Не удалось выполнить действие. Проверьте значение и попробуйте ещё раз.", back("menu"));
    return true;
  }
}

async function updateCountryFromReply(context: HandlerContext, id: number, code: keyof typeof countryFields, raw: string) {
  const db = getDb();
  const [country] = await db.select().from(countries).where(eq(countries.id, id)).limit(1);
  if (!country) { await sendMessage(context.token, context.chatId, "Страна не найдена.", back("countries:list")); return; }
  const key = countryFields[code][1];
  let value: unknown = raw.trim() === "-" ? null : raw.trim();
  if (["flag", "region", "description"].includes(key) && value === null) value = "";
  if (key === "name" && (!value || String(value).length > 160)) throw new Error("INVALID_COUNTRY_NAME");
  if (key === "slug" && (!slugPattern.test(String(value)) || String(value).length > 120)) throw new Error("INVALID_COUNTRY_SLUG");
  if (key === "isoCode") { value = raw.trim() === "-" ? null : raw.trim().toUpperCase(); if (value && !/^[A-Z]{2}$/.test(String(value))) throw new Error("INVALID_COUNTRY_ISO"); }
  if (key === "sortOrder") { value = parseInteger(raw, 0, 100000); if (value === null) throw new Error("INVALID_SORT"); }
  if (key === "imageUrl") { value = parseNullableUrl(raw); if (value === undefined) throw new Error("INVALID_URL"); }
  if (key === "canonicalUrl") { value = parseNullableUrl(raw, true); if (value === undefined) throw new Error("INVALID_URL"); }
  if (key === "faq") { value = parseFaq(raw); if (value === null) throw new Error("INVALID_FAQ"); }
  await db.update(countries).set({ [key]: value, updatedAt: new Date().toISOString() } as typeof countries.$inferInsert).where(eq(countries.id, id));
  if (key === "slug" && typeof value === "string") await recordSlugRedirect("country", String(id), country.slug, value);
  await audit(db, context.adminId, "country.update", String(id), { field: key });
  await showCountry(db, context.token, context.chatId, id);
}

async function updateOperatorFromReply(context: HandlerContext, id: number, code: keyof typeof operatorFields, raw: string) {
  const db = getDb();
  const [operator] = await db.select().from(operators).where(eq(operators.id, id)).limit(1);
  if (!operator) { await sendMessage(context.token, context.chatId, "Оператор не найден.", back("operators:list")); return; }
  const key = operatorFields[code][1];
  let value: unknown = raw.trim() === "-" ? null : raw.trim();
  if (key === "description" && value === null) value = "";
  if (key === "name" && (!value || String(value).length > 160)) throw new Error("INVALID_OPERATOR_NAME");
  if (key === "slug" && (!slugPattern.test(String(value)) || String(value).length > 120)) throw new Error("INVALID_OPERATOR_SLUG");
  if (key === "countryId") {
    const countryId = parseInteger(raw, 1, 2147483647);
    if (countryId === null || !(await db.select({ id: countries.id }).from(countries).where(eq(countries.id, countryId)).limit(1))[0]) throw new Error("INVALID_COUNTRY");
    value = countryId;
  }
  if (key === "sortOrder") { value = parseInteger(raw, 0, 100000); if (value === null) throw new Error("INVALID_SORT"); }
  if (key === "logoUrl") { value = parseNullableUrl(raw); if (value === undefined) throw new Error("INVALID_URL"); }
  await db.update(operators).set({ [key]: value, updatedAt: new Date().toISOString() } as typeof operators.$inferInsert).where(eq(operators.id, id));
  await audit(db, context.adminId, "operator.update", String(id), { field: key });
  await showOperator(db, context.token, context.chatId, id);
}

async function ensureProductRelation(db: Db, product: { countryId: number; operatorId: number }, next: { countryId?: number; operatorId?: number }) {
  const countryId = next.countryId ?? product.countryId;
  const operatorId = next.operatorId ?? product.operatorId;
  const [operator] = await db.select({ countryId: operators.countryId }).from(operators).where(eq(operators.id, operatorId)).limit(1);
  if (!operator || operator.countryId !== countryId) throw new Error("OPERATOR_COUNTRY_MISMATCH");
}

async function updateProductFromReply(context: HandlerContext, id: number, code: keyof typeof productFields, raw: string) {
  const db = getDb();
  const [product] = await db.select().from(catalogProducts).where(eq(catalogProducts.id, id)).limit(1);
  if (!product) { await sendMessage(context.token, context.chatId, "Товар не найден.", back("products:list")); return; }
  const key = productFields[code][1];
  let value: unknown = raw.trim() === "-" ? null : raw.trim();
  if (["shortDescription", "fullDescription", "roamingTerms", "activationTerms", "compatibility", "instructions"].includes(key) && value === null) value = "";
  if (["name", "sku", "slug", "simType", "currency", "dataVolume"].includes(key) && !value) throw new Error("REQUIRED_VALUE");
  if (key === "slug" && (!slugPattern.test(String(value)) || String(value).length > 160)) throw new Error("INVALID_PRODUCT_SLUG");
  if (key === "currency") { value = raw.trim().toUpperCase(); if (!currencyPattern.test(String(value))) throw new Error("INVALID_CURRENCY"); }
  if (key === "simType" && !["eSIM", "SIM"].includes(String(value))) throw new Error("INVALID_SIM_TYPE");
  if (["price", "oldPrice", "dataMb", "stockQuantity", "sortOrder"].includes(key)) {
    const nullable = ["oldPrice", "dataMb", "stockQuantity"].includes(key);
    value = raw.trim() === "-" && nullable ? null : parseInteger(raw, 0, 100000000);
    if (value === null && !(nullable && raw.trim() === "-")) throw new Error("INVALID_INTEGER");
  }
  if (key === "validityDays") { value = parseInteger(raw, 1, 3650); if (value === null) throw new Error("INVALID_DAYS"); }
  if (["countryId", "operatorId"].includes(key)) {
    value = parseInteger(raw, 1, 2147483647);
    if (value === null) throw new Error("INVALID_RELATION");
    await ensureProductRelation(db, product, { [key]: value });
  }
  if (["isUnlimited", "hasCalls", "hasSms", "popular"].includes(key)) { value = parseBoolean(raw); if (value === null) throw new Error("INVALID_BOOLEAN"); }
  if (key === "characteristics") { value = parseJsonObject(raw.trim() === "-" ? "{}" : raw); if (value === null) throw new Error("INVALID_JSON"); }
  if (["ogImage"].includes(key)) { value = parseNullableUrl(raw); if (value === undefined) throw new Error("INVALID_URL"); }
  if (key === "canonicalUrl") { value = parseNullableUrl(raw, true); if (value === undefined) throw new Error("INVALID_URL"); }
  const update: Record<string, unknown> = { [key]: value, updatedAt: new Date().toISOString() };
  if (key === "stockQuantity" && value === 0) Object.assign(update, { available: false, availabilityStatus: "OUT_OF_STOCK" });
  await db.update(catalogProducts).set(update as typeof catalogProducts.$inferInsert).where(eq(catalogProducts.id, id));
  if (key === "slug" && typeof value === "string") await recordSlugRedirect("product", String(id), product.slug, value);
  await audit(db, context.adminId, "product.update", String(id), { field: key });
  await showProduct(db, context.token, context.chatId, id);
}

async function updateVariantFromReply(context: HandlerContext, id: number, code: keyof typeof variantFields, raw: string) {
  const db = getDb();
  const [variant] = await db.select().from(productVariants).where(eq(productVariants.id, id)).limit(1);
  if (!variant) { await sendMessage(context.token, context.chatId, "Вариант не найден.", back("products:list")); return; }
  const key = variantFields[code][1];
  let value: unknown = raw.trim() === "-" ? null : raw.trim();
  if (["name", "sku", "slug", "price", "currency"].includes(key) && value === null) throw new Error("REQUIRED_VALUE");
  if (key === "slug" && !slugPattern.test(String(value))) throw new Error("INVALID_SLUG");
  if (key === "currency") { value = raw.trim().toUpperCase(); if (!currencyPattern.test(String(value))) throw new Error("INVALID_CURRENCY"); }
  if (["price", "stockQuantity", "sortOrder"].includes(key)) {
    const nullable = key === "stockQuantity";
    value = raw.trim() === "-" && nullable ? null : parseInteger(raw, 0, 100000000);
    if (value === null && !(nullable && raw.trim() === "-")) throw new Error("INVALID_INTEGER");
  }
  if (key === "validityDays") { value = raw.trim() === "-" ? null : parseInteger(raw, 1, 3650); if (value === null && raw.trim() !== "-") throw new Error("INVALID_DAYS"); }
  if (key === "characteristics") { value = parseJsonObject(raw.trim() === "-" ? "{}" : raw); if (value === null) throw new Error("INVALID_JSON"); }
  const update: Record<string, unknown> = { [key]: value, updatedAt: new Date().toISOString() };
  if (key === "stockQuantity" && value === 0) Object.assign(update, { available: false, availabilityStatus: "OUT_OF_STOCK" });
  await db.update(productVariants).set(update as typeof productVariants.$inferInsert).where(eq(productVariants.id, id));
  await audit(db, context.adminId, "variant.update", String(id), { field: key });
  await showVariant(db, context.token, context.chatId, id);
}

async function handleMessageInner(context: HandlerContext, text: string, replyContext: string): Promise<boolean> {
  const db = getDb();

  if (replyContext.startsWith("[CREATE_COUNTRY]")) {
    const [slug, name, flag = "", region = "", iso = ""] = text.split("|").map((part) => part.trim());
    if (!slugPattern.test(slug || "") || slug.length > 120 || !name || name.length > 160 || flag.length > 16 || region.length > 120 || (iso && !/^[A-Za-z]{2}$/.test(iso))) throw new Error("INVALID_COUNTRY_CREATE");
    const [existing] = await db.select({ id: countries.id }).from(countries).where(eq(countries.slug, slug)).limit(1);
    if (existing) throw new Error("DUPLICATE_COUNTRY");
    const inserted = await db.insert(countries).values({ slug, name, flag, region, isoCode: iso ? iso.toUpperCase() : null, description: "", publicationStatus: "DRAFT", noindex: true }).returning({ id: countries.id });
    await audit(db, context.adminId, "country.create", String(inserted[0].id), { slug, name });
    await showCountry(db, context.token, context.chatId, inserted[0].id);
    return true;
  }
  if (replyContext.startsWith("[CREATE_OPERATOR]")) {
    const [countryRaw, slug, name, description = ""] = text.split("|").map((part) => part.trim());
    const countryId = parseInteger(countryRaw, 1, 2147483647);
    if (!countryId || !slugPattern.test(slug || "") || slug.length > 120 || !name || name.length > 160 || description.length > 3000) throw new Error("INVALID_OPERATOR_CREATE");
    if (!(await db.select({ id: countries.id }).from(countries).where(eq(countries.id, countryId)).limit(1))[0]) throw new Error("INVALID_COUNTRY");
    const existing = await db.select({ id: operators.id }).from(operators).where(and(eq(operators.countryId, countryId), eq(operators.slug, slug))).limit(1);
    if (existing[0]) throw new Error("DUPLICATE_OPERATOR");
    const inserted = await db.insert(operators).values({ countryId, slug, name, description, publicationStatus: "DRAFT" }).returning({ id: operators.id });
    await audit(db, context.adminId, "operator.create", String(inserted[0].id), { countryId, slug, name });
    await showOperator(db, context.token, context.chatId, inserted[0].id);
    return true;
  }
  if (replyContext.startsWith("[CREATE_PRODUCT]")) {
    const parts = text.split("|").map((part) => part.trim());
    if (parts.length < 9) throw new Error("INVALID_PRODUCT_CREATE");
    const [sku, slug, name, countryRaw, operatorRaw, simType, priceRaw, dataVolume, daysRaw] = parts;
    const countryId = parseInteger(countryRaw, 1, 2147483647); const operatorId = parseInteger(operatorRaw, 1, 2147483647); const price = parseInteger(priceRaw, 0, 100000000); const validityDays = parseInteger(daysRaw, 1, 3650);
    if (!sku || sku.length > 120 || !slugPattern.test(slug) || slug.length > 160 || !name || name.length > 220 || !countryId || !operatorId || !["eSIM", "SIM"].includes(simType) || price === null || !dataVolume || dataVolume.length > 120 || validityDays === null) throw new Error("INVALID_PRODUCT_CREATE");
    await ensureProductRelation(db, { countryId, operatorId }, {});
    const conflicts = await db.select({ id: catalogProducts.id }).from(catalogProducts).where(eq(catalogProducts.slug, slug)).limit(1);
    if (conflicts[0] || (await db.select({ id: catalogProducts.id }).from(catalogProducts).where(eq(catalogProducts.sku, sku)).limit(1))[0]) throw new Error("DUPLICATE_PRODUCT");
    const inserted = await db.insert(catalogProducts).values({ name, sku, slug, countryId, operatorId, simType: simType as "eSIM" | "SIM", price, currency: "RUB", shortDescription: "", fullDescription: "", validityDays, dataVolume, available: false, availabilityStatus: "OUT_OF_STOCK", publicationStatus: "DRAFT" }).returning({ id: catalogProducts.id });
    await audit(db, context.adminId, "product.create", String(inserted[0].id), { sku, slug, name });
    await showProduct(db, context.token, context.chatId, inserted[0].id);
    return true;
  }
  const variantCreate = replyContext.match(/^\[CREATE_VARIANT:(\d+)\]/);
  if (variantCreate) {
    const productId = Number(variantCreate[1]);
    const [sku, slug, name, priceRaw, currencyRaw, dataVolume = "", daysRaw = "", stockRaw = ""] = text.split("|").map((part) => part.trim());
    const price = parseInteger(priceRaw, 0, 100000000); const validityDays = daysRaw && daysRaw !== "-" ? parseInteger(daysRaw, 1, 3650) : null; const stockQuantity = stockRaw && stockRaw !== "-" ? parseInteger(stockRaw, 0, 100000000) : null; const currency = currencyRaw.toUpperCase();
    if (!sku || sku.length > 120 || !slugPattern.test(slug || "") || slug.length > 160 || !name || name.length > 220 || price === null || !currencyPattern.test(currency) || dataVolume.length > 120 || (daysRaw && daysRaw !== "-" && validityDays === null) || (stockRaw && stockRaw !== "-" && stockQuantity === null)) throw new Error("INVALID_VARIANT_CREATE");
    if (!(await db.select({ id: catalogProducts.id }).from(catalogProducts).where(eq(catalogProducts.id, productId)).limit(1))[0]) throw new Error("INVALID_PRODUCT");
    const inserted = await db.insert(productVariants).values({ productId, sku, slug, name, price, currency, dataVolume: dataVolume || null, validityDays, stockQuantity, available: stockQuantity !== 0, availabilityStatus: stockQuantity === 0 ? "OUT_OF_STOCK" : "IN_STOCK" }).returning({ id: productVariants.id });
    await audit(db, context.adminId, "variant.create", String(inserted[0].id), { productId, sku });
    await showVariant(db, context.token, context.chatId, inserted[0].id);
    return true;
  }
  const imageCreate = replyContext.match(/^\[CREATE_IMAGE:(\d+)\]/);
  if (imageCreate) {
    const productId = Number(imageCreate[1]);
    const [rawUrl, alt = "", sortRaw = "0"] = text.split("|").map((part) => part.trim());
    const url = parseNullableUrl(rawUrl); const sortOrder = parseInteger(sortRaw || "0", 0, 100000);
    if (!url || url.length > 2048 || alt.length > 500 || sortOrder === null || !(await db.select({ id: catalogProducts.id }).from(catalogProducts).where(eq(catalogProducts.id, productId)).limit(1))[0]) throw new Error("INVALID_IMAGE_CREATE");
    const existing = await db.select({ id: productImages.id }).from(productImages).where(eq(productImages.productId, productId)).limit(1);
    const inserted = await db.insert(productImages).values({ productId, url, alt, sortOrder, isPrimary: !existing[0] }).returning({ id: productImages.id });
    await audit(db, context.adminId, "image.create", String(inserted[0].id), { productId });
    await showImage(db, context.token, context.chatId, inserted[0].id);
    return true;
  }
  const countryEdit = replyContext.match(/^\[EDIT_COUNTRY:(\d+):([a-z]+)\]/);
  if (countryEdit && countryEdit[2] in countryFields) { await updateCountryFromReply(context, Number(countryEdit[1]), countryEdit[2] as keyof typeof countryFields, text); return true; }
  const operatorEdit = replyContext.match(/^\[EDIT_OPERATOR:(\d+):([a-z]+)\]/);
  if (operatorEdit && operatorEdit[2] in operatorFields) { await updateOperatorFromReply(context, Number(operatorEdit[1]), operatorEdit[2] as keyof typeof operatorFields, text); return true; }
  const productEdit = replyContext.match(/^\[EDIT_PRODUCT:(\d+):([a-z]+)\]/);
  if (productEdit && productEdit[2] in productFields) { await updateProductFromReply(context, Number(productEdit[1]), productEdit[2] as keyof typeof productFields, text); return true; }
  const variantEdit = replyContext.match(/^\[EDIT_VARIANT:(\d+):([a-z]+)\]/);
  if (variantEdit && variantEdit[2] in variantFields) { await updateVariantFromReply(context, Number(variantEdit[1]), variantEdit[2] as keyof typeof variantFields, text); return true; }
  return false;
}

export async function handleCatalogAdminMessage(context: HandlerContext, text: string, replyContext: string) {
  try {
    return await handleMessageInner(context, text, replyContext);
  } catch (error) {
    console.error("telegram_catalog_message_failed", { name: error instanceof Error ? error.message : "UnknownError" });
    await sendMessage(context.token, context.chatId, "Не удалось сохранить. Проверьте формат, уникальность slug/SKU и соответствие страны оператору.", back("menu"));
    return true;
  }
}
