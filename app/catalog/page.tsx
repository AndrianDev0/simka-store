import type { Metadata } from "next";
import { CatalogGrid } from "@/app/components/catalog-grid";
import { CatalogAnalytics } from "@/app/components/analytics-events";
import { ContentSection, SiteShell } from "@/app/components/site-shell";
import { getPublicCategoryOptions } from "@/lib/categories";
import { getCatalogFacets, queryCatalogProducts, type CatalogFilters } from "@/lib/catalog-repository";
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
  const [categories, facets, raw] = await Promise.all([getPublicCategoryOptions(), getCatalogFacets(), searchParams]);
  const q = valueOf(raw.q).trim().slice(0, 100);
  const country = valueOf(raw.country);
  const operator = valueOf(raw.operator);
  const category = valueOf(raw.category);
  const type = valueOf(raw.type);
  const currency = valueOf(raw.currency);
  const availability = valueOf(raw.availability);
  const data = valueOf(raw.data);
  const sort = (["price-asc", "price-desc", "days"].includes(valueOf(raw.sort)) ? valueOf(raw.sort) : "popular") as NonNullable<CatalogFilters["sort"]>;
  const nonnegative = (value: string) => value.trim() && Number.isFinite(Number(value)) && Number(value) >= 0 ? Math.min(1_000_000_000, Math.trunc(Number(value))) : undefined;
  const filters: CatalogFilters = {
    q, country, operator, category,
    type: type === "SIM" || type === "eSIM" ? type : undefined,
    currency,
    availability: availability === "available" || availability === "unavailable" ? availability : undefined,
    data: data === "small" || data === "medium" || data === "large" || data === "unlimited" ? data : undefined,
    days: nonnegative(valueOf(raw.days)),
    minPrice: nonnegative(valueOf(raw.minPrice)),
    maxPrice: nonnegative(valueOf(raw.maxPrice)),
    sort,
  };
  const requestedPage = Math.min(10_000, Math.max(1, Math.trunc(Number(valueOf(raw.page))) || 1));
  let result = await queryCatalogProducts(filters, requestedPage);
  const pages = Math.max(1, Math.ceil(result.total / result.limit));
  const page = Math.min(requestedPage, pages);
  if (page !== requestedPage) result = await queryCatalogProducts(filters, page);
  const hasFilters = [q, country, operator, category, type, currency, availability, data, valueOf(raw.days), valueOf(raw.minPrice), valueOf(raw.maxPrice), valueOf(raw.sort), valueOf(raw.page)].some(Boolean);
  const pageHref = (target: number) => {
    const params = new URLSearchParams();
    for (const key of ["q", "country", "operator", "category", "type", "currency", "availability", "data", "days", "minPrice", "maxPrice", "sort"]) {
      const value = valueOf(raw[key]).trim();
      if (value) params.set(key, value);
    }
    if (target > 1) params.set("page", String(target));
    return `/catalog${params.size ? `?${params}` : ""}`;
  };
  const analyticsFilters = new URLSearchParams(Object.entries({ country, operator, category, type, currency, availability, data, days: valueOf(raw.days), minPrice: valueOf(raw.minPrice), maxPrice: valueOf(raw.maxPrice), sort: valueOf(raw.sort) }).flatMap(([key, value]) => {
    const item = String(value).trim();
    return item ? [[key, item] as [string, string]] : [];
  })).toString();
  const analyticsItems = result.items.map((product) => {
    const offer = productDisplayOffer(product);
    return { item_id: offer.variant?.sku ?? product.sku, item_name: product.name, item_category: product.type, item_variant: offer.variant?.name, price: offer.price, quantity: 1 };
  });

  return <SiteShell eyebrow="Каталог" title="Тарифы для поездок" description="Сравните страну, оператора, объём интернета, срок и тип SIM. Цена и наличие повторно проверяются при оформлении.">
    <CatalogAnalytics filters={analyticsFilters} hasSearch={Boolean(q)} items={analyticsItems} totalResults={result.total}/>
    <ContentSection>
      <form action="/catalog" className="mb-8 rounded-2xl border border-[#dbe5ef] bg-[#f8fbfe] p-4" aria-label="Фильтры каталога">
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
          <label className="text-sm font-semibold text-[#283b54] lg:col-span-2">Поиск<input name="q" defaultValue={valueOf(raw.q)} className="mt-2 min-h-11 w-full rounded-xl border border-[#cddbea] bg-white px-3 font-normal outline-none focus:ring-2 focus:ring-[#1168e8]" placeholder="Название, страна, оператор или SKU"/></label>
          <SelectFilter name="country" label="Страна" value={country} options={facets.countries}/>
          <SelectFilter name="operator" label="Оператор" value={operator} options={facets.operators}/>
          <SelectFilter name="category" label="Категория" value={category} options={["esim", "sim", "europe", "asia", "america", ...categories.map((item) => item.slug)]} labels={{ esim: "eSIM", sim: "Физические SIM", europe: "Европа", asia: "Азия", america: "Америка", ...Object.fromEntries(categories.map((item) => [item.slug, item.name])) }}/>
          <SelectFilter name="type" label="Тип SIM" value={type} options={["eSIM", "SIM"]}/>
          <SelectFilter name="currency" label="Валюта" value={currency} options={facets.currencies}/>
          <SelectFilter name="availability" label="Наличие" value={availability} options={["available", "unavailable"]} labels={{ available: "В наличии", unavailable: "Нет в наличии" }}/>
          <SelectFilter name="data" label="Интернет" value={data} options={["small", "medium", "large", "unlimited"]} labels={{ small: "До 5 ГБ", medium: "6–20 ГБ", large: "Больше 20 ГБ", unlimited: "Безлимит" }}/>
          <SelectFilter name="days" label="Срок до" value={valueOf(raw.days)} options={["7", "15", "30", "60"]} labels={{ "7": "7 дней", "15": "15 дней", "30": "30 дней", "60": "60 дней" }}/>
          <label className="text-sm font-semibold text-[#283b54]">Цена от<input name="minPrice" type="number" min="0" defaultValue={valueOf(raw.minPrice)} className="mt-2 min-h-11 w-full rounded-xl border border-[#cddbea] bg-white px-3 font-normal outline-none focus:ring-2 focus:ring-[#1168e8]" placeholder="0 ₽"/></label>
          <label className="text-sm font-semibold text-[#283b54]">Цена до<input name="maxPrice" type="number" min="0" defaultValue={valueOf(raw.maxPrice)} className="mt-2 min-h-11 w-full rounded-xl border border-[#cddbea] bg-white px-3 font-normal outline-none focus:ring-2 focus:ring-[#1168e8]" placeholder="Без ограничения"/></label>
          <SelectFilter name="sort" label="Сортировка" value={sort === "popular" ? "" : sort} options={["price-asc", "price-desc", "days"]} labels={{ "price-asc": "Сначала дешевле", "price-desc": "Сначала дороже", days: "По сроку действия" }}/>
          <div className="flex items-end gap-2"><button className="min-h-11 flex-1 rounded-xl bg-[#1168e8] px-4 font-bold text-white hover:bg-[#0d56c3]">Показать</button>{hasFilters&&<a href="/catalog" className="inline-flex min-h-11 items-center rounded-xl border border-[#cddbea] bg-white px-4 font-bold text-[#42526a] hover:bg-[#edf5ff]">Сбросить</a>}</div>
        </div>
      </form>
      <p className="mb-5 text-sm text-[#637389]" aria-live="polite">Найдено тарифов: <strong className="text-[#10213a]">{result.total}</strong>{result.total > 0 && <span> · показаны {result.offset + 1}–{result.offset + result.items.length}</span>}</p>
      {result.items.length ? <CatalogGrid items={result.items}/> : <div className="rounded-2xl border border-dashed border-[#b8c9da] p-10 text-center"><h2 className="text-xl font-black text-[#10213a]">Тарифы не найдены</h2><p className="mt-2 text-sm text-[#637389]">Измените или сбросьте выбранные фильтры.</p><a href="/catalog" className="mt-5 inline-flex min-h-11 items-center rounded-xl bg-[#1168e8] px-4 font-bold text-white">Сбросить фильтры</a></div>}
      {pages > 1 && <nav aria-label="Страницы каталога" className="mt-8 flex flex-wrap items-center justify-center gap-3 text-sm font-bold">
        {page > 1 && <a href={pageHref(page - 1)} className="inline-flex min-h-11 items-center rounded-xl border border-[#cddbea] bg-white px-4 text-[#1168e8] hover:bg-[#edf5ff] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1168e8] focus-visible:ring-offset-2">← Назад</a>}
        <span aria-current="page" className="inline-flex min-h-11 items-center px-2 text-[#42526a]">Страница {page} из {pages}</span>
        {page < pages && <a href={pageHref(page + 1)} className="inline-flex min-h-11 items-center rounded-xl border border-[#cddbea] bg-white px-4 text-[#1168e8] hover:bg-[#edf5ff] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1168e8] focus-visible:ring-offset-2">Дальше →</a>}
      </nav>}
    </ContentSection>
  </SiteShell>;
}

function SelectFilter({ name, label, value, options, labels = {} }: { name: string; label: string; value: string; options: string[]; labels?: Record<string, string> }) {
  return <label className="text-sm font-semibold text-[#283b54]">{label}<select name={name} defaultValue={value} className="mt-2 min-h-11 w-full rounded-xl border border-[#cddbea] bg-white px-3 font-normal outline-none focus:ring-2 focus:ring-[#1168e8]"><option value="">Все</option>{[...new Set(options)].map((option) => <option key={option} value={option}>{labels[option] ?? option}</option>)}</select></label>;
}
