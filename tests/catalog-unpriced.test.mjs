import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import ts from "typescript";
import { renderToStaticMarkup } from "react-dom/server";

const require = createRequire(import.meta.url);
const moduleUrl = (source, jsx = false) => "data:text/javascript;base64," + Buffer.from(ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, jsx: jsx ? ts.JsxEmit.ReactJSX : undefined },
}).outputText.replaceAll('"react/jsx-runtime"', JSON.stringify(pathToFileURL(require.resolve("react/jsx-runtime")).href))).toString("base64");
const catalogSource = (await readFile(new URL("../lib/catalog.ts", import.meta.url), "utf8"))
  .replace('import { absoluteUrl } from "@/lib/seo";', 'const absoluteUrl = (path: string) => "https://example.test" + path;');
const catalogUrl = moduleUrl(catalogSource);
const presentationUrl = moduleUrl(await readFile(new URL("../lib/product-presentation.ts", import.meta.url), "utf8"));
const flagUrl = moduleUrl(await readFile(new URL("../app/components/country-flag.tsx", import.meta.url), "utf8"), true);
const previewUrl = moduleUrl((await readFile(new URL("../app/components/product-preview.tsx", import.meta.url), "utf8"))
  .replace('"./country-flag"', JSON.stringify(flagUrl))
  .replace('"@/lib/catalog"', JSON.stringify(catalogUrl))
  .replace('"@/lib/product-presentation"', JSON.stringify(presentationUrl)), true);
const { products, productDisplayOffer, productIsAvailable } = await import(catalogUrl);
const unpriced = { ...products[0], price: null, oldPrice: 2000, variants: [], available: false, availabilityStatus: "OUT_OF_STOCK", stockQuantity: 0 };

test("unknown price stays null and cannot be purchased", () => {
  assert.equal(productDisplayOffer(unpriced).price, null);
  assert.equal(productIsAvailable(unpriced), false);
});

test("stale available flag or priced variant cannot bypass missing product price", () => {
  const stale = { ...unpriced, available: true, availabilityStatus: "IN_STOCK", stockQuantity: 9, variants: products[0].variants };
  assert.equal(productIsAvailable(stale), false);
  assert.equal(productDisplayOffer(stale).price, null);
});

test("priced products retain their existing offer", () => {
  assert.equal(productIsAvailable(products[0]), true);
  assert.equal(productDisplayOffer(products[0]).price, products[0].price);
});

test("unpriced catalog card renders no zero price or buy link", async () => {
  const source = (await readFile(new URL("../app/components/catalog-grid.tsx", import.meta.url), "utf8"))
    .replace('import { ArrowRight, Clock3, MessageSquareText, Phone, Wifi } from "lucide-react";', 'const ArrowRight = () => null, Clock3 = () => null, MessageSquareText = () => null, Phone = () => null, Wifi = () => null;')
    .replace('import { getCatalogProducts, type CatalogProduct } from "@/lib/catalog-repository";', 'const getCatalogProducts = async () => [];')
    .replace('import { CountryFlag } from "@/app/components/country-flag";', 'const CountryFlag = () => null;')
    .replace('"./product-preview"', JSON.stringify(previewUrl))
    .replace('"@/lib/catalog"', JSON.stringify(catalogUrl));
  const { CatalogGrid } = await import(moduleUrl(source, true));
  const html = renderToStaticMarkup(await CatalogGrid({ items: [unpriced] }));
  assert.match(html, /Нет в наличии/);
  assert.doesNotMatch(html, /₽|RUB|line-through|href="\/\?product=/);
  assert.match(html, /Подробнее/);
});

test("shared product preview displays optimized photo and exactly one availability status", async () => {
  const { ProductPreview } = await import(previewUrl);
  const product = { ...unpriced, images: [{ url: "/uploads/catalog/test.webp", alt: "Варшава", isPrimary: true }], shortDescription: "Профиль eSIM. Сейчас отсутствует в продаже." };
  const html = renderToStaticMarkup(ProductPreview({ product, children: "Подробнее" }));
  assert.match(html, /src="\/uploads\/catalog\/test.webp"/);
  assert.match(html, /loading="lazy"/);
  assert.match(html, /alt="Варшава"/);
  assert.equal((html.match(/Нет в наличии/g) || []).length, 1);
  assert.doesNotMatch(html, /Сейчас отсутствует|line-through/);
});

test("current countries have local SVG flags instead of platform-dependent emoji", async () => {
  const { CountryFlag } = await import(flagUrl);
  for (const [flag, code] of [["🇵🇱", "pl"], ["🇬🇪", "ge"], ["🇪🇸", "es"]]) {
    const html = renderToStaticMarkup(CountryFlag({ flag, country: code }));
    assert.match(html, new RegExp(`/flags/${code}\\.svg`));
    assert.doesNotMatch(html, /shadow-/);
    await readFile(new URL(`../public/flags/${code}.svg`, import.meta.url));
  }
});

test("summary omits unknown values without inventing a plan", async () => {
  const { productSummaryFacts, productPhotoPosition } = await import(presentationUrl);
  assert.deepEqual(productSummaryFacts({ data: "Не указан", days: null, calls: "Не уточнено", sms: "", hasCalls: false, hasSms: false }), []);
  assert.deepEqual(productSummaryFacts({ data: "70 ГБ", days: 30, hasCalls: false, hasSms: false }), [["Интернет", "70 ГБ"], ["Срок", "30 дней"]]);
  assert.equal(productPhotoPosition("/uploads/catalog/8616265a90322afac03588dbb890d40d.webp"), "50% 75%");
  assert.equal(productPhotoPosition("/uploads/catalog/new-admin-photo.webp"), "50% 50%");
});

test("additional filters remain in the same GET form and are collapsed by default", async () => {
  const source = await readFile(new URL("../app/catalog/page.tsx", import.meta.url), "utf8");
  assert.match(source, /<details className=/);
  assert.doesNotMatch(source, /<details[^>]+\bopen[=\s>]/);
  assert.ok(source.indexOf('<form action="/catalog"') < source.indexOf("<details"));
  assert.ok(source.indexOf("</details>") < source.indexOf("</form>"));
  for (const name of ["q", "country", "operator", "category", "type", "currency", "availability", "data", "days", "minPrice", "maxPrice", "sort"]) assert.ok(source.includes(`name="${name}"`));
});
