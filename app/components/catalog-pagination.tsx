export function CatalogPagination({ basePath, page, pages }: { basePath: string; page: number; pages: number }) {
  if (pages <= 1) return null;
  const href = (target: number) => target === 1 ? basePath : `${basePath}?page=${target}`;
  const linkClass = "inline-flex min-h-11 items-center rounded-xl border border-[#cddbea] bg-white px-4 text-sm font-bold text-[#1168e8] hover:bg-[#edf5ff] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1168e8] focus-visible:ring-offset-2";
  return <nav aria-label="Страницы списка тарифов" className="mt-8 flex flex-wrap items-center justify-center gap-3">
    {page > 1 && <a rel="prev" href={href(page - 1)} className={linkClass}>← Назад</a>}
    <span aria-current="page" className="inline-flex min-h-11 items-center px-2 text-sm font-bold text-[#42526a]">Страница {page} из {pages}</span>
    {page < pages && <a rel="next" href={href(page + 1)} className={linkClass}>Дальше →</a>}
  </nav>;
}
