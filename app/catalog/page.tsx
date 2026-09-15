import type { Metadata } from "next";
import { CatalogGrid } from "@/app/components/catalog-grid";
import { ContentSection, SiteShell } from "@/app/components/site-shell";
import { getPublicCategories } from "@/lib/categories";
import { getCatalogProducts } from "@/lib/catalog-repository";
import { productDisplayOffer } from "@/lib/catalog";
import { pageMetadata } from "@/lib/seo";

type CatalogSearchParams = Record<string, string | string[] | undefined>;
const valueOf = (value: string | string[] | undefined) => Array.isArray(value) ? value[0] ?? "" : value ?? "";

export async function generateMetadata({ searchParams }: { searchParams: Promise<CatalogSearchParams> }): Promise<Metadata> {
  const values = await searchParams;
  const filtered = Object.values(values).some((value) => valueOf(value).trim());
  return pageMetadata({ title: "Каталог eSIM и SIM для поездок", description: "Сравните SIM и eSIM по стране, оператору, объёму интернета, сроку действия и цене.", path: "/catalog", noindex: filtered });
}

export const dynamic = "force-dynamic";

export default async function CatalogPage({ searchParams }: { searchParams: Promise<CatalogSearchParams> }) {
  const [products, categories, raw] = await Promise.all([getCatalogProducts(), getPublicCategories(), searchParams]);
  const q = valueOf(raw.q).trim().toLowerCase();
  const country = valueOf(raw.country);
  const operator = valueOf(raw.operator);
  const category = valueOf(raw.category);
  const type = valueOf(raw.type);
  const currency = valueOf(raw.currency);
  const availability = valueOf(raw.availability);
  const data = valueOf(raw.data);
  const days = Number(valueOf(raw.days)) || 0;
  const minPrice = Number(valueOf(raw.minPrice)) || 0;
  const maxPrice = Number(valueOf(raw.maxPrice)) || Number.POSITIVE_INFINITY;
  const sort = valueOf(raw.sort) || "popular";
  const builtInSlugs = new Set(["esim", "sim", "europe", "asia", "america"]);
  const managedCategory = builtInSlugs.has(category) ? undefined : categories.find((item) => item.slug === category);
  const regionByCategory: Record<string, string> = { europe: "Европа", asia: "Азия", america: "Америка" };
  const builtInMatch = (product: typeof products[number]) => category === "esim" ? product.type === "eSIM" : category === "sim" ? product.type === "SIM" : category in regionByCategory ? product.region === regionByCategory[category] : true;
  const dataMatch = (product: typeof products[number]) => {
    if (!data) return true;
    if (data === "unlimited") return product.isUnlimited;
    if (product.isUnlimited) return false;
    const dataMb = product.dataMb ?? 0;
    if (data === "small") return dataMb <= 5 * 1024;
    if (data === "medium") return dataMb > 5 * 1024 && dataMb <= 20 * 1024;
    return dataMb > 20 * 1024;
  };
  const filtered = products.filter((product) => {
    const offer = productDisplayOffer(product);
    const searchable = `${product.name} ${product.country} ${product.operator} ${product.sku} ${product.shortDescription} ${product.data} ${product.variants.map((variant) => `${variant.name} ${variant.sku} ${variant.data || ""}`).join(" ")}`.toLowerCase();
    const isAvailable = product.available && product.availabilityStatus !== "OUT_OF_STOCK" && product.stockQuantity !== 0 && (product.variants.length === 0 || product.variants.some((variant) => variant.available && variant.availabilityStatus !== "OUT_OF_STOCK" && variant.stockQuantity !== 0));
    return (!q || searchable.includes(q))
      && (!country || product.country === country)
      && (!operator || product.operator === operator)
      && (!type || product.type === type)
      && (!currency || offer.currency === currency)
      && (!availability || (availability === "available" ? isAvailable : !isAvailable))
      && dataMatch(product)
      && (!days || product.days <= days)
      && offer.price >= minPrice
      && offer.price <= maxPrice
      && (managedCategory ? product.categoryIds.includes(managedCategory.id) : builtInMatch(product));
  }).sort((left, right) => {
    if (sort === "days") return left.days - right.days;
    if (sort === "price-asc" || sort === "price-desc") {
      const leftOffer = productDisplayOffer(left); const rightOffer = productDisplayOffer(right);
      const currencyOrder = leftOffer.currency.localeCompare(rightOffer.currency);
      if (currencyOrder) return currencyOrder;
      return sort === "price-asc" ? leftOffer.price - rightOffer.price : rightOffer.price - leftOffer.price;
    }
    return Number(right.popular) - Number(left.popular);
  });
  const countries = [...new Set(products.map((product) => product.country))].sort((a, b) => a.localeCompare(b, "ru"));
  const operators = [...new Set(products.map((product) => product.operator))].sort((a, b) => a.localeCompare(b, "ru"));
  const currencies = [...new Set(products.map((product) => productDisplayOffer(product).currency))].sort();
  const hasFilters = [q, country, operator, category, type, currency, availability, data, valueOf(raw.days), valueOf(raw.minPrice), valueOf(raw.maxPrice), valueOf(raw.sort)].some(Boolean);

  return <SiteShell eyebrow="Каталог" title="Тарифы для поездок" description="Сравните страну, оператора, объём интернета, срок и тип SIM. Цена и наличие повторно проверяются при оформлении.">
    <ContentSection>
      <form action="/catalog" className="mb-8 rounded-2xl border border-[#dbe5ef] bg-[#f8fbfe] p-4" aria-label="Фильтры каталога">
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
          <label className="text-sm font-semibold text-[#283b54] lg:col-span-2">Поиск<input name="q" defaultValue={valueOf(raw.q)} className="mt-2 min-h-11 w-full rounded-xl border border-[#cddbea] bg-white px-3 font-normal outline-none focus:ring-2 focus:ring-[#1168e8]" placeholder="Название, страна, оператор или SKU"/></label>
          <SelectFilter name="country" label="Страна" value={country} options={countries}/>
          <SelectFilter name="operator" label="Оператор" value={operator} options={operators}/>
          <SelectFilter name="category" label="Категория" value={category} options={["esim", "sim", "europe", "asia", "america", ...categories.map((item) => item.slug)]} labels={{ esim: "eSIM", sim: "Физические SIM", europe: "Европа", asia: "Азия", america: "Америка", ...Object.fromEntries(categories.map((item) => [item.slug, item.name])) }}/>
          <SelectFilter name="type" label="Тип SIM" value={type} options={["eSIM", "SIM"]}/>
          <SelectFilter name="currency" label="Валюта" value={currency} options={currencies}/>
          <SelectFilter name="availability" label="Наличие" value={availability} options={["available", "unavailable"]} labels={{ available: "В наличии", unavailable: "Нет в наличии" }}/>
          <SelectFilter name="data" label="Интернет" value={data} options={["small", "medium", "large", "unlimited"]} labels={{ small: "До 5 ГБ", medium: "6–20 ГБ", large: "Больше 20 ГБ", unlimited: "Безлимит" }}/>
          <SelectFilter name="days" label="Срок до" value={valueOf(raw.days)} options={["7", "15", "30", "60"]} labels={{ "7": "7 дней", "15": "15 дней", "30": "30 дней", "60": "60 дней" }}/>
          <label className="text-sm font-semibold text-[#283b54]">Цена от<input name="minPrice" type="number" min="0" defaultValue={valueOf(raw.minPrice)} className="mt-2 min-h-11 w-full rounded-xl border border-[#cddbea] bg-white px-3 font-normal outline-none focus:ring-2 focus:ring-[#1168e8]" placeholder="0 ₽"/></label>
          <label className="text-sm font-semibold text-[#283b54]">Цена до<input name="maxPrice" type="number" min="0" defaultValue={valueOf(raw.maxPrice)} className="mt-2 min-h-11 w-full rounded-xl border border-[#cddbea] bg-white px-3 font-normal outline-none focus:ring-2 focus:ring-[#1168e8]" placeholder="Без ограничения"/></label>
          <SelectFilter name="sort" label="Сортировка" value={sort === "popular" ? "" : sort} options={["price-asc", "price-desc", "days"]} labels={{ "price-asc": "Сначала дешевле", "price-desc": "Сначала дороже", days: "По сроку действия" }}/>
          <div className="flex items-end gap-2"><button className="min-h-11 flex-1 rounded-xl bg-[#1168e8] px-4 font-bold text-white hover:bg-[#0d56c3]">Показать</button>{hasFilters&&<a href="/catalog" className="inline-flex min-h-11 items-center rounded-xl border border-[#cddbea] bg-white px-4 font-bold text-[#42526a] hover:bg-[#edf5ff]">Сбросить</a>}</div>
        </div>
      </form>
      <p className="mb-5 text-sm text-[#637389]" aria-live="polite">Найдено тарифов: <strong className="text-[#10213a]">{filtered.length}</strong></p>
      {filtered.length ? <CatalogGrid items={filtered}/> : <div className="rounded-2xl border border-dashed border-[#b8c9da] p-10 text-center"><h2 className="text-xl font-black text-[#10213a]">Тарифы не найдены</h2><p className="mt-2 text-sm text-[#637389]">Измените или сбросьте выбранные фильтры.</p><a href="/catalog" className="mt-5 inline-flex min-h-11 items-center rounded-xl bg-[#1168e8] px-4 font-bold text-white">Сбросить фильтры</a></div>}
    </ContentSection>
  </SiteShell>;
}

function SelectFilter({ name, label, value, options, labels = {} }: { name: string; label: string; value: string; options: string[]; labels?: Record<string, string> }) {
  return <label className="text-sm font-semibold text-[#283b54]">{label}<select name={name} defaultValue={value} className="mt-2 min-h-11 w-full rounded-xl border border-[#cddbea] bg-white px-3 font-normal outline-none focus:ring-2 focus:ring-[#1168e8]"><option value="">Все</option>{[...new Set(options)].map((option) => <option key={option} value={option}>{labels[option] ?? option}</option>)}</select></label>;
}
