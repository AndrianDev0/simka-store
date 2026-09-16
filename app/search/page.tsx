import { ContentSection, SiteShell } from "@/app/components/site-shell";
import { CatalogGrid } from "@/app/components/catalog-grid";
import { SearchAnalytics } from "@/app/components/analytics-events";
import { searchCatalogProducts } from "@/lib/catalog-repository";
import { normalizeCatalogSearchQuery } from "@/lib/catalog-search";
import { pageMetadata } from "@/lib/seo";

export const metadata = pageMetadata({ title: "Поиск SIM и eSIM", description: "Найдите тариф по стране, оператору, типу SIM, категории или артикулу.", path: "/search", noindex: true });
export const dynamic = "force-dynamic";

export default async function SearchPage({ searchParams }: { searchParams: Promise<{ q?: string; page?: string }> }) {
  const { q = "", page: rawPage = "1" } = await searchParams;
  const query = normalizeCatalogSearchQuery(q);
  const requestedPage = Math.min(10_000, Math.max(1, Number.parseInt(rawPage, 10) || 1));
  const result = query ? await searchCatalogProducts(query, requestedPage) : { items: [], total: 0, limit: 24, offset: 0 };
  const pageCount = Math.max(1, Math.ceil(result.total / result.limit));
  const page = Math.min(requestedPage, pageCount);
  const items = page === requestedPage ? result.items : (await searchCatalogProducts(query, page)).items;
  const pageHref = (target: number) => `/search?q=${encodeURIComponent(query)}&page=${target}`;
  return <SiteShell eyebrow="Поиск" title="Найдите свой тариф" description="Ищите по названию, стране, оператору, категории, типу SIM или артикулу.">
    <SearchAnalytics query={query} results={result.total}/>
    <ContentSection>
      <form className="mb-8 flex flex-col gap-3 sm:flex-row" action="/search">
        <label className="sr-only" htmlFor="catalog-search">Название, страна, оператор, категория или SKU</label>
        <input id="catalog-search" name="q" defaultValue={q} placeholder="Например, Турция, Turkcell или TR-ESIM" className="min-h-12 flex-1 rounded-xl border border-[#dbe5ef] px-4 outline-none focus:ring-2 focus:ring-[#1168e8]"/>
        <button className="min-h-12 rounded-xl bg-[#1168e8] px-5 font-bold text-white hover:bg-[#0d56c3]">Найти</button>
      </form>
      {query ? <><p className="mb-5 text-sm text-[#637389]">Результатов: <strong className="text-[#10213a]">{result.total}</strong>{pageCount > 1 ? ` · страница ${page} из ${pageCount}` : ""}</p>{items.length ? <><CatalogGrid items={items}/>{pageCount > 1 && <nav aria-label="Страницы результатов поиска" className="mt-8 flex items-center justify-center gap-3">{page > 1 && <a rel="prev" href={pageHref(page - 1)} className="inline-flex min-h-11 items-center rounded-xl border border-[#cbd9e7] px-4 font-bold text-[#28577f] hover:bg-[#edf5ff]">Назад</a>}<span className="text-sm text-[#637389]">{page} / {pageCount}</span>{page < pageCount && <a rel="next" href={pageHref(page + 1)} className="inline-flex min-h-11 items-center rounded-xl bg-[#1168e8] px-4 font-bold text-white hover:bg-[#0d56c3]">Далее</a>}</nav>}</> : <div className="rounded-2xl border border-dashed border-[#b8c9da] p-10 text-center"><h2 className="text-xl font-black text-[#10213a]">Ничего не найдено</h2><p className="mt-2 text-sm text-[#637389]">Проверьте запрос или откройте каталог с фильтрами.</p><a href="/catalog" className="mt-5 inline-flex min-h-11 items-center rounded-xl bg-[#1168e8] px-4 font-bold text-white">Открыть каталог</a></div>}</> : <p className="text-sm text-[#637389]">Введите запрос, чтобы увидеть результаты.</p>}
    </ContentSection>
  </SiteShell>;
}
