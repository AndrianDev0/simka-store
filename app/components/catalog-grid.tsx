/* eslint-disable @next/next/no-img-element -- catalog images are administrator-managed remote URLs. */
import { ArrowRight, Clock3, MessageSquareText, Phone, Wifi } from "lucide-react";
import { getCatalogProducts, type CatalogProduct } from "@/lib/catalog-repository";
import { productDisplayOffer, productIsAvailable } from "@/lib/catalog";

const availabilityLabels: Record<CatalogProduct["availabilityStatus"], string> = {
  IN_STOCK: "В наличии",
  OUT_OF_STOCK: "Нет в наличии",
  PREORDER: "Под заказ",
};

function formatPrice(price: number, currency: string) {
  try {
    return new Intl.NumberFormat("ru-RU", {
      style: "currency",
      currency,
      maximumFractionDigits: 0,
    }).format(price);
  } catch {
    return `${new Intl.NumberFormat("ru-RU").format(price)} ${currency}`;
  }
}

function availabilityClasses(status: CatalogProduct["availabilityStatus"]) {
  if (status === "IN_STOCK") return "border-[#cce8a8] bg-[#f1fae5] text-[#386313]";
  if (status === "PREORDER") return "border-[#bed9f7] bg-[#edf6ff] text-[#164f8c]";
  return "border-[#e4e8ed] bg-[#f5f6f8] text-[#657286]";
}

function primaryImage(product: CatalogProduct) {
  return product.images.find((image) => image.isPrimary) ?? product.images[0];
}

export async function CatalogGrid({ items }: { items?: CatalogProduct[] }) {
  const suppliedItems = items !== undefined;
  const catalogItems = items ?? await getCatalogProducts();
  const visibleItems = catalogItems.filter((product) => product.published);

  if (!visibleItems.length) {
    return suppliedItems ? null : <p role="status" className="rounded-2xl border border-dashed border-[#cad7e4] bg-[#f8fbfe] px-5 py-12 text-center text-sm text-[#637389]">Опубликованных тарифов пока нет.</p>;
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {visibleItems.map((product) => {
        const image = primaryImage(product);
        const available = productIsAvailable(product);
        const offer = productDisplayOffer(product);
        const effectiveStatus = available ? offer.variant?.availabilityStatus ?? product.availabilityStatus : "OUT_OF_STOCK";
        const titleId = `catalog-product-${product.id}`;

        return (
          <article key={product.id} aria-labelledby={titleId} className="flex h-full flex-col overflow-hidden rounded-2xl border border-[#dce5ee] bg-white shadow-[0_8px_24px_rgba(23,58,96,.04)] transition-shadow hover:shadow-[0_14px_35px_rgba(23,58,96,.09)]">
            <div className={`relative h-36 overflow-hidden bg-gradient-to-br ${product.tone}`}>
              {image ? (
                <img src={image.url} alt={image.alt || product.name} width={720} height={360} loading="lazy" decoding="async" className="h-full w-full object-cover" />
              ) : (
                <div className="flex h-full items-center justify-between p-5 text-white">
                  <span className="rounded-lg bg-white/15 px-2.5 py-1 text-xs font-black uppercase tracking-wider backdrop-blur">{product.type}</span>
                  <span role="img" aria-label={`Флаг страны ${product.country}`} className="text-4xl drop-shadow">{product.flag}</span>
                </div>
              )}
              {image && <span className="absolute left-4 top-4 rounded-lg bg-[#10213a]/85 px-2.5 py-1 text-xs font-black uppercase tracking-wider text-white backdrop-blur">{product.type}</span>}
            </div>

            <div className="flex flex-1 flex-col p-5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs font-semibold text-[#64758a]">{product.flag} {product.country} · {product.operator}</p>
                <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-bold ${availabilityClasses(effectiveStatus)}`}>
                  <span aria-hidden="true" className="size-1.5 rounded-full bg-current" />
                  {availabilityLabels[effectiveStatus]}
                </span>
              </div>

              <h2 id={titleId} className="mt-3 text-xl font-black leading-tight tracking-tight text-[#10213a]">
                <a href={`/product/${product.slug}`} className="rounded-sm hover:text-[#1168e8] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1168e8] focus-visible:ring-offset-2">{product.name}</a>
              </h2>
              {product.shortDescription && <p className="mt-2 line-clamp-2 text-sm leading-6 text-[#637389]">{product.shortDescription}</p>}

              <dl className="mt-4 grid grid-cols-2 gap-2 text-sm">
                <div className="rounded-xl bg-[#f6f9fc] p-3"><dt className="flex items-center gap-1.5 text-xs text-[#6d7d90]"><Wifi aria-hidden="true" className="size-3.5 text-[#1168e8]" />Интернет</dt><dd className="mt-1 font-bold text-[#213752]">{product.data}</dd></div>
                <div className="rounded-xl bg-[#f6f9fc] p-3"><dt className="flex items-center gap-1.5 text-xs text-[#6d7d90]"><Clock3 aria-hidden="true" className="size-3.5 text-[#1168e8]" />Срок</dt><dd className="mt-1 font-bold text-[#213752]">{product.days} дней</dd></div>
                <div className="rounded-xl bg-[#f6f9fc] p-3"><dt className="flex items-center gap-1.5 text-xs text-[#6d7d90]"><Phone aria-hidden="true" className="size-3.5 text-[#1168e8]" />Звонки</dt><dd className="mt-1 font-bold text-[#213752]">{product.hasCalls ? product.calls || "Включены" : "Нет"}</dd></div>
                <div className="rounded-xl bg-[#f6f9fc] p-3"><dt className="flex items-center gap-1.5 text-xs text-[#6d7d90]"><MessageSquareText aria-hidden="true" className="size-3.5 text-[#1168e8]" />SMS</dt><dd className="mt-1 font-bold text-[#213752]">{product.hasSms ? product.sms || "Включены" : "Нет"}</dd></div>
              </dl>

              <div className="mt-auto flex items-end justify-between gap-3 pt-5">
                <div>
                  <p className="text-xl font-black text-[#10213a]">{formatPrice(offer.price, offer.currency)}</p>
                  {product.oldPrice && offer.currency === product.currency && product.oldPrice > offer.price && <p className="text-xs text-[#718096] line-through">{formatPrice(product.oldPrice, product.currency)}</p>}
                </div>
                <a href={`/product/${product.slug}`} aria-label={`Подробнее о тарифе «${product.name}»`} className="inline-flex min-h-11 shrink-0 items-center gap-1 rounded-xl bg-[#1168e8] px-3 text-sm font-bold text-white hover:bg-[#0d56c3] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1168e8] focus-visible:ring-offset-2">
                  {available ? "Подробнее" : "Условия"}<ArrowRight aria-hidden="true" className="size-4" />
                </a>
              </div>
            </div>
          </article>
        );
      })}
    </div>
  );
}
