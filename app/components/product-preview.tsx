/* eslint-disable @next/next/no-img-element -- uploads are already optimized WebP files. */
import type { ReactNode } from "react";
import { CountryFlag } from "./country-flag";
import { productDisplayOffer, productIsAvailable, type Product } from "@/lib/catalog";
import { productPhotoPosition, productSummaryFacts } from "@/lib/product-presentation";

export function ProductPreview({ product, children }: { product: Product; children: ReactNode }) {
  const image = product.images.find((item) => item.isPrimary) ?? product.images[0];
  const offer = productDisplayOffer(product);
  const available = productIsAvailable(product);
  const demo = product.sku.startsWith("DEMO-");
  const facts = productSummaryFacts(product);
  const status = demo ? "Демо, не продаётся" : !available ? "Нет в наличии" : (offer.variant?.availabilityStatus ?? product.availabilityStatus) === "PREORDER" ? "Под заказ" : "В наличии";
  const formatPrice = (value: number) => {
    try { return new Intl.NumberFormat("ru-RU", { style: "currency", currency: offer.currency, maximumFractionDigits: 0 }).format(value); }
    catch { return `${value.toLocaleString("ru-RU")} ${offer.currency}`; }
  };
  const price = offer.price === null ? null : formatPrice(offer.price);
  return <article aria-labelledby={`catalog-product-${product.id}`} className="flex h-full flex-col overflow-hidden rounded-xl border border-border bg-card text-card-foreground">
    {image && <div className="aspect-[16/9] overflow-hidden bg-muted">
      <img src={image.url} alt={image.alt || product.name} width={720} height={405} loading="lazy" decoding="async" className="h-full w-full object-cover" style={{ objectPosition: productPhotoPosition(image.url) }} />
    </div>}
    <div className="flex flex-1 flex-col p-5">
      <p className="flex items-center gap-2 text-sm text-muted-foreground"><CountryFlag flag={product.flag} country={product.country} className="h-4 w-6" />{product.country} · {product.operator}</p>
      <h2 id={`catalog-product-${product.id}`} className="mt-3 text-xl font-bold leading-tight"><a href={`/product/${encodeURIComponent(product.slug)}`} className="rounded-sm hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{product.name}</a></h2>
      <p className="mt-2 text-sm text-muted-foreground">{status}</p>
      {product.shortDescription && <p className="mt-3 line-clamp-2 text-sm leading-6 text-muted-foreground">{product.shortDescription.replace(/\s*Сейчас отсутствует в продаже\.?/i, "")}</p>}
      {facts.length > 0 ? <dl className="mt-4 divide-y divide-border text-sm">{facts.map(([label, value]) => <div key={label} className="flex items-start justify-between gap-4 py-2"><dt className="text-muted-foreground">{label}</dt><dd className="max-w-[65%] text-right font-medium">{value}</dd></div>)}</dl> : <p className="mt-4 text-sm leading-6 text-muted-foreground">Параметры тарифа пока не указаны.</p>}
      <div className="mt-auto pt-5">
        {price && <p className="mb-4 text-xl font-bold">{price}{demo && <span className="ml-2 text-xs font-normal text-muted-foreground">пример цены</span>}</p>}
        {offer.price !== null && product.oldPrice && offer.currency === product.currency && product.oldPrice > offer.price && <p className="mb-4 text-sm text-muted-foreground line-through">{formatPrice(product.oldPrice)}</p>}
        {children}
      </div>
    </div>
  </article>;
}
