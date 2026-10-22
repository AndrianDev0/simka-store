import { getCatalogProducts, type CatalogProduct } from "@/lib/catalog-repository";
import { ProductPreview } from "./product-preview";

export async function CatalogGrid({ items }: { items?: CatalogProduct[] }) {
  const suppliedItems = items !== undefined;
  const catalogItems = items ?? await getCatalogProducts();
  const visibleItems = catalogItems.filter((product) => product.published);
  if (!visibleItems.length) {
    return suppliedItems ? null : <p role="status" className="rounded-xl border border-dashed border-border px-5 py-12 text-center text-sm text-muted-foreground">Опубликованных тарифов пока нет.</p>;
  }
  return <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
    {visibleItems.map((product) => <ProductPreview key={product.id} product={product}>
      <a href={`/product/${encodeURIComponent(product.slug)}`} aria-label={`Подробнее о тарифе «${product.name}»`} className="inline-flex min-h-11 w-full items-center justify-center rounded-lg border border-border px-4 text-sm font-semibold hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">Подробнее</a>
    </ProductPreview>)}
  </div>;
}
