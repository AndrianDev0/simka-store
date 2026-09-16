/* eslint-disable @next/next/no-img-element -- category images are administrator-managed remote URLs. */
import { ChevronRight } from "lucide-react";
import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";
import { CatalogGrid } from "@/app/components/catalog-grid";
import { CatalogPagination } from "@/app/components/catalog-pagination";
import { ContentSection, SiteShell } from "@/app/components/site-shell";
import { getPublicCategories } from "@/lib/categories";
import { getCatalogCountries, queryCatalogProducts } from "@/lib/catalog-repository";
import { breadcrumbJsonLd, itemListJsonLd, jsonLd, pageMetadata } from "@/lib/seo";
import { getSlugRedirect } from "@/lib/slug-redirects";

const definitions: Record<string, { name: string; description: string }> = {
  esim: { name: "eSIM", description: "Цифровые тарифы для поездок с доставкой кода активации на email после оплаты." },
  sim: { name: "Физические SIM", description: "Пластиковые SIM-карты для поездок с доставкой по согласованию." },
  europe: { name: "Европа", description: "SIM и eSIM для поездок по странам Европы." },
  asia: { name: "Азия", description: "SIM и eSIM для поездок по странам Азии." },
  america: { name: "Америка", description: "SIM и eSIM для поездок по странам Америки." },
};

export function generateStaticParams() { return Object.keys(definitions).map((slug) => ({ slug })); }
export const dynamic = "force-dynamic";

export async function generateMetadata({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ page?: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const published = await getPublicCategories();
  const predefined = definitions[slug];
  const managed = predefined ? undefined : published.find((item) => item.slug === slug);
  if (!predefined && !managed) return pageMetadata({ title: "Категория не найдена", description: "Такой категории нет в каталоге SIMKA.", path: `/category/${encodeURIComponent(slug)}`, noindex: true });
  const result = await queryCatalogProducts({ category: slug }, 1, 1);
  const page = Math.max(1, Number.parseInt((await searchParams).page || "1", 10) || 1);
  const name = predefined?.name || managed?.name || "Категория";
  const title = managed?.seoTitle || (slug === "esim"
    ? "eSIM для путешествий: тарифы по странам"
    : slug === "sim"
      ? "Физические SIM-карты для путешествий"
      : `${name}: SIM и eSIM для поездок`);
  const description = managed?.seoDescription || managed?.description || predefined?.description || `Тарифы ${name} в каталоге SIMKA.`;
  return pageMetadata({ title, description, path: `/category/${encodeURIComponent(slug)}`, canonical: managed?.canonicalUrl, image: managed?.ogImage || managed?.imageUrl, imageAlt: `Категория ${name}`, socialTitle: managed?.ogTitle, socialDescription: managed?.ogDescription, noindex: Boolean(managed?.noindex) || result.total === 0 || page > 1 });
}

export default async function CategoryPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ page?: string }> }) {
  const { slug } = await params;
  const [published, countries] = await Promise.all([getPublicCategories(), getCatalogCountries()]);
  const predefined = definitions[slug];
  const managed = predefined ? undefined : published.find((item) => item.slug === slug);
  if (!predefined && !managed) {
    const redirect = await getSlugRedirect("category", slug);
    if (redirect) permanentRedirect(`/category/${encodeURIComponent(redirect)}`);
    notFound();
  }
  const requestedPage = Math.min(10_000, Math.max(1, Number.parseInt((await searchParams).page || "1", 10) || 1));
  let result = await queryCatalogProducts({ category: slug }, requestedPage);
  const pages = Math.max(1, Math.ceil(result.total / result.limit));
  const page = Math.min(requestedPage, pages);
  if (page !== requestedPage) result = await queryCatalogProducts({ category: slug }, page);
  const items = result.items;
  const parent = managed?.parentId ? published.find((item) => item.id === managed.parentId) : undefined;
  const children = managed ? published.filter((item) => item.parentId === managed.id) : [];
  const title = managed?.h1 || predefined?.name || managed?.name || "Категория";
  const name = predefined?.name || managed?.name || title;
  const description = managed?.description || predefined?.description || "Опубликованная категория тарифов SIMKA.";
  const countryIds = new Set(items.map((product) => product.countryId));
  const relatedCountries = countries.filter((country) => countryIds.has(country.id));
  const canonicalPath = `/category/${encodeURIComponent(slug)}`;
  const breadcrumbItems = [{ name: "Главная", path: "/" }, { name: "Категории", path: "/categories" }, ...(parent ? [{ name: parent.name, path: `/category/${encodeURIComponent(parent.slug)}` }] : []), { name, path: canonicalPath }];
  const breadcrumbs = breadcrumbJsonLd(breadcrumbItems);
  const listSchema = itemListJsonLd(items.map((product) => ({ name: product.name, path: `/product/${encodeURIComponent(product.slug)}` })));

  return <SiteShell eyebrow={managed?.parentId ? "Подкатегория" : "Категория"} title={title} description={description}><ContentSection>
    <nav aria-label="Хлебные крошки" className="mb-7 overflow-x-auto text-sm text-[#637389]"><ol className="flex min-w-max items-center gap-1.5">{breadcrumbItems.map((item, index) => <li key={item.path} className="flex items-center gap-1.5">{index > 0 && <ChevronRight aria-hidden="true" className="size-4" />}{index === breadcrumbItems.length - 1 ? <span aria-current="page" className="font-semibold text-[#263c57]">{item.name}</span> : <a href={item.path} className="hover:text-[#1168e8]">{item.name}</a>}</li>)}</ol></nav>
    {managed?.imageUrl && <img src={managed.imageUrl} alt={`Категория ${managed.name}`} className="mb-8 aspect-[16/6] w-full rounded-2xl border border-[#dbe5ef] object-cover" />}
    {children.length > 0 && <section className="mb-9"><h2 className="text-xl font-black text-[#10213a]">Подкатегории</h2><div className="mt-4 flex flex-wrap gap-3">{children.map((child) => <a key={child.id} href={`/category/${encodeURIComponent(child.slug)}`} className="inline-flex min-h-11 items-center rounded-xl border border-[#cddbea] bg-[#f7fbff] px-4 font-bold text-[#28577f] hover:bg-[#edf5ff]">{child.name}</a>)}</div></section>}
    {items.length ? <CatalogGrid items={items} /> : <p className="rounded-2xl border border-dashed border-[#b8c9da] p-8 text-sm text-[#637389]">В этой категории пока нет опубликованных тарифов.</p>}
    <CatalogPagination basePath={canonicalPath} page={page} pages={pages} />
    {relatedCountries.length > 0 && <section className="mt-10 border-t border-[#dbe5ef] pt-8"><h2 className="text-xl font-black text-[#10213a]">Страны в этой категории</h2><div className="mt-4 flex flex-wrap gap-3">{relatedCountries.map((country) => <a key={country.id} href={`/country/${encodeURIComponent(country.slug)}`} className="inline-flex min-h-11 items-center rounded-xl border border-[#cddbea] px-4 font-bold text-[#28577f] hover:bg-[#edf5ff]">{country.flag} {country.name}</a>)}</div></section>}
    {managed?.seoText && <section className="mt-10 max-w-3xl border-t border-[#dbe5ef] pt-8"><h2 className="text-2xl font-black text-[#10213a]">О категории</h2><p className="mt-4 whitespace-pre-line text-sm leading-7 text-[#52657a]">{managed.seoText}</p></section>}
  </ContentSection><script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(breadcrumbs) }} /><script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(listSchema) }} /></SiteShell>;
}
