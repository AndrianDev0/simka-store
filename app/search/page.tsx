import { ContentSection, SiteShell } from "@/app/components/site-shell";
import { CatalogGrid } from "@/app/components/catalog-grid";
import { SearchAnalytics } from "@/app/components/analytics-events";
import { getPublicCategories } from "@/lib/categories";
import { getCatalogProducts } from "@/lib/catalog-repository";
import { pageMetadata } from "@/lib/seo";

export const metadata = pageMetadata({ title: "Поиск SIM и eSIM", description: "Найдите тариф по стране, оператору, типу SIM, категории или артикулу.", path: "/search", noindex: true });
export const dynamic = "force-dynamic";

export default async function SearchPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q = "" } = await searchParams;
  const query = q.trim().toLowerCase();
  const [products, categories] = await Promise.all([getCatalogProducts(), getPublicCategories()]);
  const categoryNames = new Map(categories.map((category) => [category.id, `${category.name} ${category.slug}`.toLowerCase()]));
  const items = query ? products.filter((product) => {
    const assignedCategories = product.categoryIds.map((id) => categoryNames.get(id) ?? "").join(" ");
    const variants = product.variants.map((variant) => `${variant.name} ${variant.sku} ${variant.data || ""}`).join(" ");
    return `${product.name} ${product.country} ${product.operator} ${product.sku} ${product.type} ${product.shortDescription} ${product.data} ${assignedCategories} ${variants}`.toLowerCase().includes(query);
  }) : [];
  return <SiteShell eyebrow="Поиск" title="Найдите свой тариф" description="Ищите по названию, стране, оператору, категории, типу SIM или артикулу.">
    <SearchAnalytics query={query} results={items.length}/>
    <ContentSection>
      <form className="mb-8 flex flex-col gap-3 sm:flex-row" action="/search">
        <label className="sr-only" htmlFor="catalog-search">Название, страна, оператор, категория или SKU</label>
        <input id="catalog-search" name="q" defaultValue={q} placeholder="Например, Турция, Turkcell или TR-ESIM" className="min-h-12 flex-1 rounded-xl border border-[#dbe5ef] px-4 outline-none focus:ring-2 focus:ring-[#1168e8]"/>
        <button className="min-h-12 rounded-xl bg-[#1168e8] px-5 font-bold text-white hover:bg-[#0d56c3]">Найти</button>
      </form>
      {query ? <><p className="mb-5 text-sm text-[#637389]">Результатов: <strong className="text-[#10213a]">{items.length}</strong></p>{items.length ? <CatalogGrid items={items}/> : <div className="rounded-2xl border border-dashed border-[#b8c9da] p-10 text-center"><h2 className="text-xl font-black text-[#10213a]">Ничего не найдено</h2><p className="mt-2 text-sm text-[#637389]">Проверьте запрос или откройте каталог с фильтрами.</p><a href="/catalog" className="mt-5 inline-flex min-h-11 items-center rounded-xl bg-[#1168e8] px-4 font-bold text-white">Открыть каталог</a></div>}</> : <p className="text-sm text-[#637389]">Введите запрос, чтобы увидеть результаты.</p>}
    </ContentSection>
  </SiteShell>;
}
