/* eslint-disable @next/next/no-img-element, @next/next/no-html-link-for-pages -- administrator-managed images and full-page navigation are intentional. */
import { cache } from "react";
import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";
import {
  ArrowRight,
  ChevronRight,
  Clock3,
  Globe2,
  ListChecks,
  MessageSquareText,
  PackageCheck,
  Phone,
  Radio,
  ShieldCheck,
  Smartphone,
  Truck,
  Wifi,
  type LucideIcon,
} from "lucide-react";
import { ContentSection, SiteShell } from "@/app/components/site-shell";
import { getPublicCategories } from "@/lib/categories";
import { getCatalogCountries, getCatalogProductBySlug, type CatalogProduct } from "@/lib/catalog-repository";
import { absoluteUrl, breadcrumbJsonLd, jsonLd, pageMetadata } from "@/lib/seo";
import { getSlugRedirect } from "@/lib/slug-redirects";
const getProduct = cache((slug: string) => getCatalogProductBySlug(slug));

export const dynamic = "force-dynamic";

function productPath(product: CatalogProduct) {
  return `/product/${encodeURIComponent(product.slug)}`;
}

function productCanonical(product: CatalogProduct) {
  return absoluteUrl(product.canonicalUrl || productPath(product));
}

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

function dispatchWindow(min: number | null, max: number | null) {
  if (min === null && max === null) return "Срок подтвердит менеджер";
  if (min !== null && max !== null && min !== max) return `Отправка через ${min}–${max} дн.`;
  if (min !== null && max === null) return `Отправка от ${min} дн.`;
  if (min === null && max !== null) return `Отправка до ${max} дн.`;
  return `Отправка через ${min} дн.`;
}

function esimTypeLabel(value: string | null) {
  const labels: Record<string, string> = { consumer: "Потребительская", travel: "Туристическая", m2m: "M2M / IoT" };
  return value ? labels[value.toLowerCase()] ?? value : "Уточняется до оплаты";
}

function esimDeliveryLabel(value: string | null) {
  const labels: Record<string, string> = { email: "По email", qr: "QR-код по email", api: "Автоматически после оплаты" };
  return value ? labels[value.toLowerCase()] ?? value : "Email после оплаты";
}

function availabilityDetails(status: CatalogProduct["availabilityStatus"], available = true) {
  if (status === "IN_STOCK" && available) return { label: "В наличии", schema: "https://schema.org/InStock", className: "border-[#cce8a8] bg-[#f1fae5] text-[#386313]" };
  if (status === "PREORDER" && available) return { label: "Доступно под заказ", schema: "https://schema.org/PreOrder", className: "border-[#bed9f7] bg-[#edf6ff] text-[#164f8c]" };
  return { label: "Нет в наличии", schema: "https://schema.org/OutOfStock", className: "border-[#e4e8ed] bg-[#f5f6f8] text-[#657286]" };
}

function primaryImage(product: CatalogProduct) {
  return product.images.find((image) => image.isPrimary) ?? product.images[0];
}

function orderedImages(product: CatalogProduct) {
  return [...product.images].sort((left, right) => Number(right.isPrimary) - Number(left.isPrimary) || left.sortOrder - right.sortOrder);
}

function instructionItems(instructions: CatalogProduct["instructions"] | string[]) {
  if (Array.isArray(instructions)) return instructions.map(String).map((item) => item.trim()).filter(Boolean);
  return instructions.split(/\r?\n+/).map((item) => item.replace(/^\s*(?:\d+[.)]|[-–—])\s*/, "").trim()).filter(Boolean);
}

function characteristicLabel(value: string) {
  const knownLabels: Record<string, string> = {
    region: "Регион",
    operator: "Оператор",
    data: "Интернет",
    validityDays: "Срок действия, дней",
    speed: "Скорость",
    network: "Сеть",
  };
  if (knownLabels[value]) return knownLabels[value];
  const label = value.replace(/[_-]+/g, " ").replace(/([a-zа-яё])([A-ZА-ЯЁ])/g, "$1 $2").trim();
  return label ? `${label.charAt(0).toUpperCase()}${label.slice(1)}` : value;
}

function characteristicValue(value: string | number | boolean) {
  if (typeof value === "boolean") return value ? "Да" : "Нет";
  return String(value);
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const product = await getProduct(slug);
  if (!product || !product.published) return { robots: { index: false, follow: false } };

  const title = product.seoTitle || `${product.name} — SIMKA`;
  const description = product.seoDescription || product.shortDescription || product.fullDescription;
  const canonical = productCanonical(product);
  const image = product.ogImage || primaryImage(product)?.url || `${productPath(product)}/opengraph-image`;
  const openGraphImage = image ? absoluteUrl(image) : undefined;

  return pageMetadata({ title, description, path: productPath(product), canonical, image: openGraphImage, imageAlt: product.name, socialTitle: product.ogTitle, socialDescription: product.ogDescription });
}

export default async function ProductPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const [product, countries, categories] = await Promise.all([getProduct(slug), getCatalogCountries(), getPublicCategories()]);
  if (!product || !product.published) {
    const redirect = await getSlugRedirect("product", slug.toLowerCase());
    if (redirect) permanentRedirect(`/product/${encodeURIComponent(redirect)}`);
    notFound();
  }

  const purchasableVariants = product.variants.filter((variant) => variant.available && variant.availabilityStatus !== "OUT_OF_STOCK" && variant.stockQuantity !== 0);
  const primaryVariant = purchasableVariants.find((variant) => variant.sku === product.sku) ?? purchasableVariants[0] ?? null;
  const availability = availabilityDetails(product.availabilityStatus, product.available && product.stockQuantity !== 0 && (product.variants.length === 0 || purchasableVariants.length > 0));
  const canOrder = availability.schema !== "https://schema.org/OutOfStock";
  const displayPrice = primaryVariant?.price ?? product.price;
  const displayCurrency = primaryVariant?.currency ?? product.currency;
  const images = orderedImages(product);
  const primary = images[0];
  const instructions = instructionItems(product.instructions);
  const characteristics = Object.entries(product.characteristics).filter((entry): entry is [string, string | number | boolean] => entry[1] !== null && entry[1] !== "");
  const canonical = productCanonical(product);
  const schemaImages = images.length ? images.map((image) => absoluteUrl(image.url)) : [absoluteUrl(`${productPath(product)}/opengraph-image`)];
  const country = countries.find((item) => item.id === product.countryId);
  const assignedCategories = categories.filter((category) => product.categoryIds.includes(category.id));

  const schemaOffers = product.variants.length ? product.variants.map((variant) => ({
    "@type": "Offer",
    sku: variant.sku,
    name: variant.name,
    url: `${canonical}#variant-${variant.id}`,
    price: variant.price,
    priceCurrency: variant.currency,
    availability: availabilityDetails(variant.availabilityStatus, variant.available && variant.stockQuantity !== 0).schema,
    itemCondition: "https://schema.org/NewCondition",
    seller: { "@type": "Organization", name: "SIMKA" },
  })) : [{
    "@type": "Offer",
    url: canonical,
    price: product.price,
    priceCurrency: product.currency,
    availability: availability.schema,
    itemCondition: "https://schema.org/NewCondition",
    seller: { "@type": "Organization", name: "SIMKA" },
  }];

  const productSchema = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: product.name,
    description: product.shortDescription || product.fullDescription,
    sku: product.sku,
    productID: String(product.id),
    url: canonical,
    image: schemaImages.length ? schemaImages : undefined,
    brand: { "@type": "Brand", name: product.operator },
    countryOfOrigin: { "@type": "Country", name: product.country },
    additionalProperty: [
      { "@type": "PropertyValue", name: "Тип SIM", value: product.type },
      { "@type": "PropertyValue", name: "Интернет", value: product.data },
      { "@type": "PropertyValue", name: "Срок действия", value: `${product.days} дней` },
      { "@type": "PropertyValue", name: "Звонки", value: product.hasCalls ? product.calls || "Включены" : "Нет" },
      { "@type": "PropertyValue", name: "SMS", value: product.hasSms ? product.sms || "Включены" : "Нет" },
      ...characteristics.map(([name, value]) => ({ "@type": "PropertyValue", name: characteristicLabel(name), value: characteristicValue(value) })),
    ],
    category: assignedCategories[0]?.name || product.type,
    offers: schemaOffers,
  };
  const breadcrumbSchema = breadcrumbJsonLd([{ name: "Главная", path: "/" }, { name: "Каталог", path: "/catalog" }, { name: product.name, path: canonical }]);

  return (
    <SiteShell eyebrow={`${product.flag} ${product.country} · ${product.operator}`} title={product.h1 || product.name} description={product.shortDescription}>
      <ContentSection>
        <nav aria-label="Хлебные крошки" className="mb-7 overflow-x-auto text-sm text-[#637389]">
          <ol className="flex min-w-max items-center gap-1.5">
            <li><a href="/" className="rounded-sm hover:text-[#1168e8] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1168e8]">Главная</a></li>
            <li aria-hidden="true"><ChevronRight className="size-4" /></li>
            <li><a href="/catalog" className="rounded-sm hover:text-[#1168e8] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1168e8]">Каталог</a></li>
            <li aria-hidden="true"><ChevronRight className="size-4" /></li>
            <li aria-current="page" className="max-w-[250px] truncate font-semibold text-[#263c57]">{product.name}</li>
          </ol>
        </nav>

        <div className="grid items-start gap-8 lg:grid-cols-[1.08fr_.92fr]">
          <div>
            {primary ? (
              <figure>
                <div className="aspect-[4/3] overflow-hidden rounded-[28px] border border-[#dbe5ef] bg-[#f4f7fa]">
                  <img src={primary.url} alt={primary.alt || product.name} width={960} height={720} decoding="async" className="h-full w-full object-cover" />
                </div>
                {images.length > 1 && (
                  <div className="mt-3 grid grid-cols-3 gap-3 sm:grid-cols-4">
                    {images.slice(1, 5).map((image) => <img key={image.id} src={image.url} alt={image.alt || `${product.name}, изображение ${image.sortOrder + 1}`} width={240} height={180} loading="lazy" decoding="async" className="aspect-[4/3] w-full rounded-xl border border-[#dbe5ef] object-cover" />)}
                  </div>
                )}
              </figure>
            ) : (
              <div className={`flex aspect-[4/3] flex-col justify-between rounded-[28px] bg-gradient-to-br ${product.tone} p-7 text-white shadow-xl`}>
                <div className="flex items-start justify-between"><span className="rounded-full bg-white/15 px-3 py-1 text-xs font-black uppercase tracking-wider">{product.type}</span><span role="img" aria-label={`Флаг страны ${product.country}`} className="text-5xl">{product.flag}</span></div>
                <div><p className="text-sm text-white/75">{product.country} · {product.operator}</p><p className="mt-2 text-4xl font-black">{product.data}</p><p className="mt-2 text-white/85">Срок действия — {product.days} дней</p></div>
              </div>
            )}
          </div>

          <section aria-labelledby="purchase-title" className="rounded-2xl border border-[#dbe5ef] bg-white p-6 shadow-[0_12px_35px_rgba(23,58,96,.07)] sm:p-7">
            <h2 id="purchase-title" className="sr-only">Стоимость и оформление</h2>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span className="rounded-lg bg-[#edf5ff] px-2.5 py-1 text-xs font-black uppercase tracking-wider text-[#1168e8]">{product.type}</span>
              <span className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-bold ${availability.className}`}><span aria-hidden="true" className="size-1.5 rounded-full bg-current" />{availability.label}</span>
            </div>
            <p className="mt-6 text-3xl font-black text-[#10213a]">{formatPrice(displayPrice, displayCurrency)}</p>
            {product.oldPrice && displayCurrency === product.currency && product.oldPrice > displayPrice && <p className="mt-1 text-sm text-[#718096] line-through">{formatPrice(product.oldPrice, product.currency)}</p>}
            <p className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-[#637389]"><span>Артикул: <strong className="text-[#334a64]">{product.sku}</strong></span><span>ID: <strong className="text-[#334a64]">{product.id}</strong></span></p>

            <dl className="mt-6 grid grid-cols-2 gap-3 text-sm">
              <KeyFact icon={Wifi} label="Интернет" value={product.data} />
              <KeyFact icon={Clock3} label="Срок" value={`${product.days} дней`} />
              <KeyFact icon={Phone} label="Звонки" value={product.hasCalls ? product.calls || "Включены" : "Нет"} />
              <KeyFact icon={MessageSquareText} label="SMS" value={product.hasSms ? product.sms || "Включены" : "Нет"} />
            </dl>

            {canOrder ? (
              <a href={`/?product=${product.id}${primaryVariant ? `&variant=${primaryVariant.id}` : ""}#catalog`} className="mt-7 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#1168e8] px-5 font-bold text-white hover:bg-[#0d56c3] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1168e8] focus-visible:ring-offset-2">Добавить в заказ <ArrowRight aria-hidden="true" className="size-4" /></a>
            ) : (
              <button type="button" disabled className="mt-7 min-h-12 w-full cursor-not-allowed rounded-xl bg-[#e7ebef] px-5 font-bold text-[#657286]">Сейчас недоступно</button>
            )}
            <p className="mt-4 flex items-start gap-2 text-xs leading-5 text-[#637389]"><ShieldCheck aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-[#4b8012]" />Цена и наличие повторно проверяются при создании заказа.</p>
            <p className="mt-3 flex items-start gap-2 text-xs leading-5 text-[#637389]"><PackageCheck aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-[#1168e8]" />{product.type === "eSIM" ? "После оплаты eSIM и инструкция придут на указанный email." : "Адрес, стоимость и срок доставки физической SIM подтверждаются при оформлении."}</p>
          </section>
        </div>

        {product.variants.length > 0 && (
          <section aria-labelledby="variants-title" className="mt-12 border-t border-[#dbe5ef] pt-10">
            <h2 id="variants-title" className="text-2xl font-black tracking-tight text-[#10213a] sm:text-3xl">Варианты тарифа</h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-[#637389]">Сравните объём, срок и стоимость доступных вариантов.</p>
            <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {product.variants.map((variant) => {
                const variantAvailability = availabilityDetails(variant.availabilityStatus, variant.available && variant.stockQuantity !== 0);
                const variantCanOrder = variantAvailability.schema !== "https://schema.org/OutOfStock" && variant.stockQuantity !== 0;
                return <article id={`variant-${variant.id}`} key={variant.id} className="rounded-2xl border border-[#dbe5ef] bg-white p-5"><div className="flex items-start justify-between gap-3"><h3 className="font-black text-[#10213a]">{variant.name}</h3><span className={`shrink-0 rounded-full border px-2 py-1 text-[10px] font-bold ${variantAvailability.className}`}>{variantAvailability.label}</span></div><p className="mt-2 text-xs text-[#718096]">Артикул: {variant.sku}</p><p className="mt-4 text-sm text-[#52657a]">{variant.data || product.data}{variant.days ? ` · ${variant.days} дней` : ""}</p><p className="mt-4 text-xl font-black text-[#10213a]">{formatPrice(variant.price, variant.currency)}</p>{variantCanOrder ? <a href={`/?product=${product.id}&variant=${variant.id}#catalog`} className="mt-4 inline-flex min-h-11 w-full items-center justify-center rounded-xl bg-[#1168e8] px-4 text-sm font-bold text-white hover:bg-[#0d56c3]">Выбрать вариант</a> : <span className="mt-4 inline-flex min-h-11 w-full items-center justify-center rounded-xl bg-[#e7ebef] px-4 text-sm font-bold text-[#657286]">Недоступен</span>}</article>;
              })}
            </div>
          </section>
        )}

        <div className="mt-12 grid gap-8 border-t border-[#dbe5ef] pt-10 lg:grid-cols-2">
          <section aria-labelledby="description-title">
            <h2 id="description-title" className="text-2xl font-black tracking-tight text-[#10213a]">Описание тарифа</h2>
            <p className="mt-4 whitespace-pre-line text-sm leading-7 text-[#52657a]">{product.fullDescription}</p>
          </section>
          <section aria-labelledby="conditions-title">
            <h2 id="conditions-title" className="text-2xl font-black tracking-tight text-[#10213a]">Условия использования</h2>
            <dl className="mt-4 divide-y divide-[#e5edf5] rounded-2xl border border-[#dbe5ef] bg-white px-5">
              <Detail icon={Globe2} label="Роуминг" value={product.roamingTerms} />
              <Detail icon={Radio} label="Активация" value={product.activationTerms} />
              <Detail icon={Smartphone} label="Совместимость" value={product.compatibility} />
            </dl>
          </section>
        </div>

        <section aria-labelledby="delivery-title" className="mt-12">
          <h2 id="delivery-title" className="text-2xl font-black tracking-tight text-[#10213a]">Получение товара</h2>
          {product.type === "eSIM" ? (
            <div className="mt-5 grid gap-4 rounded-2xl border border-[#dbe5ef] bg-[#f7fbff] p-5 sm:grid-cols-3">
              <Detail icon={Smartphone} label="Тип eSIM" value={esimTypeLabel(product.esimType)} />
              <Detail icon={PackageCheck} label="Способ получения" value={esimDeliveryLabel(product.esimDeliveryMethod)} />
              <Detail icon={ShieldCheck} label="Статус выдачи" value="Отслеживается менеджером в заказе" />
            </div>
          ) : product.deliveryOptions.length ? (
            <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {product.deliveryOptions.map((option) => (
                <article key={option.id} className="rounded-2xl border border-[#dbe5ef] bg-white p-5">
                  <span className="grid size-10 place-items-center rounded-xl bg-[#edf5ff] text-[#1168e8]"><Truck aria-hidden="true" className="size-5" /></span>
                  <h3 className="mt-4 font-black text-[#10213a]">{option.label}</h3>
                  <p className="mt-2 text-sm font-bold text-[#28577f]">{option.cost === null ? "Стоимость подтвердит менеджер" : formatPrice(option.cost, option.currency)}</p>
                  <p className="mt-2 text-sm text-[#637389]">{dispatchWindow(option.dispatchDaysMin, option.dispatchDaysMax)}</p>
                  {option.regions.length > 0 && <p className="mt-2 text-xs leading-5 text-[#718096]">Регионы: {option.regions.join(", ")}. Применимость к адресу подтвердит менеджер до оплаты.</p>}
                </article>
              ))}
            </div>
          ) : (
            <p className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">Варианты, стоимость и регион доставки подтвердит менеджер до оплаты.</p>
          )}
        </section>

        {characteristics.length > 0 && (
          <section aria-labelledby="characteristics-title" className="mt-12">
            <h2 id="characteristics-title" className="text-2xl font-black tracking-tight text-[#10213a]">Характеристики</h2>
            <dl className="mt-5 grid gap-x-8 rounded-2xl border border-[#dbe5ef] bg-white px-5 sm:grid-cols-2">
              {characteristics.map(([name, value]) => <div key={name} className="flex items-start justify-between gap-4 border-b border-[#e5edf5] py-4 last:border-b-0 sm:[&:nth-last-child(-n+2)]:border-b-0"><dt className="text-sm text-[#637389]">{characteristicLabel(name)}</dt><dd className="text-right text-sm font-bold text-[#263c57]">{characteristicValue(value)}</dd></div>)}
            </dl>
          </section>
        )}

        {instructions.length > 0 && (
          <section aria-labelledby="instructions-title" className="mt-12 rounded-2xl bg-[#10213a] p-6 text-white sm:p-8">
            <div className="flex items-center gap-3"><span className="grid size-11 place-items-center rounded-xl bg-[#b7f34a] text-[#10213a]"><ListChecks aria-hidden="true" className="size-5" /></span><h2 id="instructions-title" className="text-2xl font-black tracking-tight">Инструкция по активации</h2></div>
            <ol className="mt-7 grid gap-4 sm:grid-cols-2">
              {instructions.map((instruction, index) => <li key={`${index}-${instruction}`} className="flex gap-3 rounded-xl bg-white/7 p-4 text-sm leading-6 text-[#d8e3ef]"><span aria-hidden="true" className="grid size-7 shrink-0 place-items-center rounded-full bg-[#b7f34a] text-xs font-black text-[#10213a]">{index + 1}</span><span>{instruction}</span></li>)}
            </ol>
          </section>
        )}

        <section aria-labelledby="useful-links-title" className="mt-12 border-t border-[#dbe5ef] pt-10">
          <h2 id="useful-links-title" className="text-2xl font-black tracking-tight text-[#10213a]">Полезно перед заказом</h2>
          <div className="mt-5 flex flex-wrap gap-3">
            {country && <a href={`/country/${encodeURIComponent(country.slug)}`} className="inline-flex min-h-11 items-center rounded-xl border border-[#cddbea] px-4 font-bold text-[#28577f] hover:bg-[#edf5ff]">Все тарифы: {country.name}</a>}
            {assignedCategories.map((category) => <a key={category.id} href={`/category/${encodeURIComponent(category.slug)}`} className="inline-flex min-h-11 items-center rounded-xl border border-[#cddbea] px-4 font-bold text-[#28577f] hover:bg-[#edf5ff]">{category.name}</a>)}
            <a href="/payment" className="inline-flex min-h-11 items-center rounded-xl border border-[#cddbea] px-4 font-bold text-[#28577f] hover:bg-[#edf5ff]">Оплата</a>
            <a href="/delivery" className="inline-flex min-h-11 items-center rounded-xl border border-[#cddbea] px-4 font-bold text-[#28577f] hover:bg-[#edf5ff]">Доставка</a>
            <a href="/returns" className="inline-flex min-h-11 items-center rounded-xl border border-[#cddbea] px-4 font-bold text-[#28577f] hover:bg-[#edf5ff]">Возврат и отмена</a>
          </div>
        </section>

        {product.seoText && (
          <section aria-labelledby="additional-title" className="mt-12 max-w-3xl border-t border-[#dbe5ef] pt-10">
            <h2 id="additional-title" className="text-2xl font-black tracking-tight text-[#10213a]">Дополнительная информация</h2>
            <p className="mt-4 whitespace-pre-line text-sm leading-7 text-[#52657a]">{product.seoText}</p>
          </section>
        )}
      </ContentSection>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(productSchema) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(breadcrumbSchema) }} />
    </SiteShell>
  );
}

function KeyFact({ icon: Icon, label, value }: { icon: LucideIcon; label: string; value: string }) {
  return <div className="rounded-xl bg-[#f6f9fc] p-3"><dt className="flex items-center gap-1.5 text-xs text-[#6d7d90]"><Icon aria-hidden="true" className="size-3.5 text-[#1168e8]" />{label}</dt><dd className="mt-1 font-bold text-[#213752]">{value}</dd></div>;
}

function Detail({ icon: Icon, label, value }: { icon: LucideIcon; label: string; value: string }) {
  return <div className="grid gap-2 py-4 sm:grid-cols-[140px_1fr]"><dt className="flex items-center gap-2 text-sm font-bold text-[#263c57]"><Icon aria-hidden="true" className="size-4 text-[#1168e8]" />{label}</dt><dd className="text-sm leading-6 text-[#637389]">{value}</dd></div>;
}
