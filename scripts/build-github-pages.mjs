import { readFile, writeFile, mkdir, rm } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const docs = path.join(root, "docs");
const origin = "https://andriandev0.github.io/simka-store/";
const api = "https://simka-store.onrender.com/api/pages/catalog";
const template = await readFile(path.join(docs, "index.html"), "utf8");
const marker = "<!-- SIMKA_GENERATED_PAGE -->";
const escape = (value) => String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
const money = (amount, currency = "RUB") => new Intl.NumberFormat("ru-RU", { style: "currency", currency, maximumFractionDigits: 0 }).format(amount);
const urlFor = (route) => `${origin}${route ? `${route}/` : ""}`;
const hrefFor = (route) => `/simka-store/${route ? `${route}/` : ""}`;
const absoluteImage = (value) => { try { const url = new URL(value); return url.protocol === "https:" ? url.href : null; } catch { return null; } };
const pageHero = (label, title, description) => `<div class="page-hero"><div class="shell page-heading"><div class="eyebrow">${escape(label)}</div><h1>${escape(title)}</h1><p>${escape(description)}</p></div></div>`;
const pageBody = (content) => `<div class="shell page-body">${content}</div>`;
const linkCard = (route, title, description) => `<a class="tile" href="${escape(hrefFor(route))}"><h2>${escape(title)}</h2><p>${escape(description)}</p><small>Подробнее →</small></a>`;
const productCard = (product) => linkCard(`product/${encodeURIComponent(product.slug)}`, product.name, `${product.country} · ${product.operator} · ${product.data} · ${product.days} дней · ${money(product.price, product.currency)}`);
const productCards = (items) => items.length ? `<div class="grid">${items.map(productCard).join("")}</div>` : `<p class="empty">Опубликованных товаров пока нет.</p>`;

let catalog;
for (let attempt = 1; attempt <= 2; attempt++) {
  try {
    const response = await fetch(api, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(75000) });
    if (!response.ok) throw new Error(`Catalog API returned ${response.status}`);
    const payload = await response.json();
    if (!Array.isArray(payload.products) || !Array.isArray(payload.categories) || !Array.isArray(payload.countries)) throw new Error("Invalid catalog response");
    catalog = payload;
    break;
  } catch (error) { console.warn(`Catalog request ${attempt}/2 failed: ${error instanceof Error ? error.message : "unknown error"}`); }
}
if (!catalog) {
  try {
    await readFile(path.join(docs, "generated-pages.json"), "utf8");
    console.warn("Using the last checked-in static snapshot; live catalog refresh was unavailable.");
    process.exit(0);
  } catch { throw new Error("Catalog API unavailable and no static snapshot exists."); }
}

const { products, categories, countries } = catalog;
const pages = [];
const add = (route, title, description, body, options = {}) => pages.push({ route, title, description, body, ...options });

add("catalog", "Каталог SIM и eSIM | SIMKA", "Каталог SIM-карт и eSIM для путешествий: сравните тарифы, страны, операторов и цены.", pageHero("Каталог", "Тарифы для поездок", "Выберите страну и подходящий тариф SIM или eSIM.") + pageBody(productCards(products)));
add("search", "Поиск тарифов | SIMKA", "Найдите SIM или eSIM по стране, оператору, категории или артикулу.", pageHero("Поиск", "Найти тариф", "Ищите по названию, стране, оператору и SKU.") + pageBody(productCards(products)), { noindex: true });
add("categories", "Категории тарифов | SIMKA", "Подборки SIM и eSIM по категориям для удобного выбора.", pageHero("Категории", "Подборки тарифов", "Выберите нужную категорию.") + pageBody(categories.length ? `<div class="grid">${categories.map((category) => linkCard(`category/${encodeURIComponent(category.slug)}`, category.name, category.description)).join("")}</div>` : `<p class="empty">Категорий пока нет.</p>`), { noindex: categories.length === 0 });
add("countries", "Страны | SIMKA", "SIM и eSIM для поездок по странам: сравните доступные тарифы.", pageHero("Страны", "Направления для поездки", "Выберите страну и сравните доступные тарифы.") + pageBody(`<div class="grid">${countries.map((country) => linkCard(`country/${encodeURIComponent(country.slug)}`, country.name, country.description)).join("")}</div>`));

for (const country of countries) {
  const related = products.filter((product) => product.countryId === country.id);
  add(`country/${encodeURIComponent(country.slug)}`, country.seoTitle || `${country.name}: SIM и eSIM | SIMKA`, country.seoDescription || country.description || `SIM и eSIM для поездки в ${country.name}.`, pageHero("Страна", country.h1 || country.name, country.description) + pageBody(`${country.seoText ? `<p>${escape(country.seoText)}</p>` : ""}${productCards(related)}`), { noindex: !!country.noindex, image: absoluteImage(country.imageUrl), updatedAt: country.updatedAt });
}
for (const category of categories) {
  const related = products.filter((product) => category.productIds?.includes(product.id));
  add(`category/${encodeURIComponent(category.slug)}`, category.seoTitle || `${category.name} | SIMKA`, category.seoDescription || category.description || `Тарифы категории ${category.name}.`, pageHero("Категория", category.h1 || category.name, category.description) + pageBody(`${category.seoText ? `<p>${escape(category.seoText)}</p>` : ""}${productCards(related)}`), { noindex: !!category.noindex, image: absoluteImage(category.ogImage || category.imageUrl), updatedAt: category.updatedAt });
}
for (const product of products) {
  const image = absoluteImage(product.ogImage || product.images?.[0]?.url);
  const offer = product.variants?.find((variant) => variant.available && variant.stockQuantity !== 0) || product;
  const schema = {
    "@context": "https://schema.org", "@type": "Product", name: product.name,
    description: product.fullDescription || product.shortDescription || product.name,
    sku: product.sku, url: urlFor(`product/${encodeURIComponent(product.slug)}`),
    ...(image ? { image } : {}),
    offers: { "@type": "Offer", price: offer.price, priceCurrency: offer.currency || product.currency, availability: product.available && product.stockQuantity !== 0 ? "https://schema.org/InStock" : "https://schema.org/OutOfStock", url: urlFor(`product/${encodeURIComponent(product.slug)}`) },
  };
  const facts = `<dl><div><dt>Страна</dt><dd>${escape(product.country)}</dd></div><div><dt>Оператор</dt><dd>${escape(product.operator)}</dd></div><div><dt>Интернет</dt><dd>${escape(product.data)}</dd></div><div><dt>Срок действия</dt><dd>${escape(product.days)} дней</dd></div><div><dt>Артикул</dt><dd>${escape(product.sku)}</dd></div></dl>`;
  add(`product/${encodeURIComponent(product.slug)}`, product.seoTitle || `${product.name} | SIMKA`, product.seoDescription || product.shortDescription || `Купить ${product.name}: условия, цена и оформление заказа.`, pageHero(`${product.country} · ${product.operator}`, product.h1 || product.name, product.shortDescription) + pageBody(`<div class="product-information"><section class="detail-extra"><h2>Описание тарифа</h2><p>${escape(product.fullDescription || product.shortDescription)}</p><p><strong>${escape(money(offer.price, offer.currency || product.currency))}</strong></p></section><section class="detail-extra"><h2>Характеристики</h2>${facts}</section><section class="detail-extra"><h2>Условия использования</h2><p>${escape(product.roamingTerms || "Уточните у менеджера")}</p><p>${escape(product.activationTerms || "Активация по инструкции")}</p></section></div>`), { image, schema, updatedAt: product.updatedAt });
}

const information = {
  faq: ["FAQ | SIMKA", "Ответы на частые вопросы о SIM и eSIM.", "Частые вопросы", "Ответы о совместимости eSIM, активации и получении заказа."],
  payment: ["Оплата | SIMKA", "Условия оплаты SIM и eSIM через менеджера.", "Оплата", "После оформления заказа менеджер отправит актуальные реквизиты на указанный email."],
  delivery: ["Доставка | SIMKA", "Как получить eSIM и физическую SIM-карту.", "Доставка", "eSIM отправляется на email после подтверждения оплаты; физическая SIM доставляется по согласованию."],
  contacts: ["Контакты | SIMKA", "Как связаться с поддержкой SIMKA.", "Контакты", "По вопросам выбора тарифа и заказов напишите в Telegram @qweJSq."],
  about: ["О компании | SIMKA", "О магазине SIMKA и продаже SIM-карт для путешествий.", "О компании", "SIMKA помогает выбрать SIM и eSIM для поездок."],
  privacy: ["Политика конфиденциальности | SIMKA", "Обработка персональных данных покупателей SIMKA.", "Политика конфиденциальности", "Данные заказа используются для его оформления, исполнения и поддержки."],
  terms: ["Условия использования | SIMKA", "Условия использования сайта SIMKA.", "Условия использования", "Актуальная цена и доступность проверяются при создании заказа."],
  returns: ["Возврат и отмена | SIMKA", "Порядок отмены и возврата заказа SIMKA.", "Возврат и отмена", "Для отмены или возврата обратитесь в поддержку и сообщите номер заказа."],
  cookies: ["Cookie Policy | SIMKA", "Использование cookie и локального хранения на сайте SIMKA.", "Cookie Policy", "Корзина сохраняется в браузере для удобства покупателя."],
};
for (const [route, [title, description, heading, summary]] of Object.entries(information)) add(route, title, description, pageHero("Информация", heading, description) + pageBody(`<section class="detail-extra"><p>${escape(summary)}</p><p>Полный действующий текст документа доступен на <a href="https://simka-store.onrender.com/${route}">основном сайте SIMKA</a>.</p></section>`), { noindex: false });

const replaceTag = (html, expression, replacement) => {
  if (!expression.test(html)) throw new Error("Static page template is missing a required tag.");
  return html.replace(expression, replacement);
};
function renderPage(page) {
  const canonical = urlFor(page.route);
  let html = template;
  html = replaceTag(html, /<title>[^<]*<\/title>/, `<title>${escape(page.title)}</title>`);
  html = replaceTag(html, /<meta name="description" content="[^"]*">/, `<meta name="description" content="${escape(page.description)}">`);
  html = replaceTag(html, /<link rel="canonical" href="[^"]*">/, `<link rel="canonical" href="${escape(canonical)}">`);
  html = replaceTag(html, /<meta property="og:title" content="[^"]*">/, `<meta property="og:title" content="${escape(page.title)}">`);
  html = replaceTag(html, /<meta property="og:description" content="[^"]*">/, `<meta property="og:description" content="${escape(page.description)}">`);
  html = replaceTag(html, /<meta property="og:url" content="[^"]*">/, `<meta property="og:url" content="${escape(canonical)}">`);
  if (page.noindex) html = html.replace("</head>", `  <meta name="robots" content="noindex, follow">\n</head>`);
  if (page.image) html = html.replace("</head>", `  <meta property="og:image" content="${escape(page.image)}">\n</head>`);
  if (page.schema) html = html.replace("</head>", `  <script type="application/ld+json">${JSON.stringify(page.schema).replaceAll("<", "\\u003c")}</script>\n</head>`);
  return replaceTag(html, /<!-- STATIC_APP_START -->[\s\S]*?<!-- STATIC_APP_END -->/, `<!-- STATIC_APP_START -->${marker}${page.body}<!-- STATIC_APP_END -->`);
}

const manifestPath = path.join(docs, "generated-pages.json");
let previous = [];
try { previous = JSON.parse(await readFile(manifestPath, "utf8")); } catch { /* First build. */ }
if (!Array.isArray(previous)) throw new Error("Invalid generated-pages.json manifest.");
const current = pages.map((page) => page.route);
for (const route of previous.filter((route) => !current.includes(route))) {
  if (typeof route !== "string" || !/^[\p{L}\p{N}%/-]+$/u.test(route) || route.includes("..")) throw new Error("Unsafe generated route in manifest.");
  const filename = path.resolve(docs, route, "index.html");
  if (!filename.startsWith(`${docs}${path.sep}`)) throw new Error("Generated path escaped docs.");
  const content = await readFile(filename, "utf8");
  if (!content.includes(marker)) throw new Error(`Refusing to remove non-generated page: ${route}`);
  await rm(filename);
}
for (const page of pages) {
  const filename = path.resolve(docs, page.route, "index.html");
  if (!filename.startsWith(`${docs}${path.sep}`)) throw new Error("Generated path escaped docs.");
  await mkdir(path.dirname(filename), { recursive: true });
  await writeFile(filename, renderPage(page));
}
await writeFile(manifestPath, `${JSON.stringify(current, null, 2)}\n`);
const indexed = [{ route: "", updatedAt: null }, ...pages.filter((page) => !page.noindex && page.route !== "search")];
const sitemap = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${indexed.map((page) => `  <url><loc>${escape(urlFor(page.route))}</loc>${page.updatedAt ? `<lastmod>${escape(new Date(page.updatedAt).toISOString())}</lastmod>` : ""}</url>`).join("\n")}\n</urlset>\n`;
await writeFile(path.join(docs, "sitemap.xml"), sitemap);
await writeFile(path.join(docs, "robots.txt"), `User-agent: *\nAllow: /simka-store/\nSitemap: ${origin}sitemap.xml\n`);
console.log(`Generated ${pages.length} static pages from ${products.length} products, ${countries.length} countries and ${categories.length} categories.`);
