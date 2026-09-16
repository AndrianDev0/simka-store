/* eslint-disable @next/next/no-img-element, @next/next/no-html-link-for-pages -- administrator-managed images and full-page navigation are intentional. */
import { ChevronRight } from "lucide-react";
import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";
import { CatalogGrid } from "@/app/components/catalog-grid";
import { CatalogPagination } from "@/app/components/catalog-pagination";
import { ContentSection, SiteShell } from "@/app/components/site-shell";
import { getPublicCategories } from "@/lib/categories";
import { getCatalogCountryBySlug, queryCatalogProducts } from "@/lib/catalog-repository";
import { breadcrumbJsonLd, itemListJsonLd, jsonLd, pageMetadata } from "@/lib/seo";
import { getSlugRedirect } from "@/lib/slug-redirects";

function decodeSlug(slug: string) { try { return decodeURIComponent(slug); } catch { return slug; } }
export const dynamic = "force-dynamic";

export async function generateMetadata({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ page?: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const decoded = decodeSlug(slug);
  const country = await getCatalogCountryBySlug(decoded);
  if (!country) return pageMetadata({ title: "Страна не найдена", description: "Такой страницы нет в каталоге SIMKA.", path: `/country/${encodeURIComponent(decoded)}`, noindex: true });
  const result = await queryCatalogProducts({ country: country.name }, 1, 1);
  const page = Math.max(1, Number.parseInt((await searchParams).page || "1", 10) || 1);
  return pageMetadata({
    title: country.seoTitle || `${country.name}: eSIM и SIM для путешествий`,
    description: country.seoDescription || country.description || `Сравните SIM и eSIM по направлению «${country.name}»: операторы, интернет, срок и цены.`,
    path: `/country/${encodeURIComponent(country.slug)}`,
    canonical: country.canonicalUrl,
    image: country.imageUrl,
    imageAlt: `SIM и eSIM для ${country.name}`,
    noindex: country.noindex || result.total === 0 || page > 1,
  });
}

export default async function CountryPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ page?: string }> }) {
  const { slug } = await params;
  const decoded = decodeSlug(slug);
  const [country, categories] = await Promise.all([getCatalogCountryBySlug(decoded), getPublicCategories()]);
  if (!country) {
    const redirect = await getSlugRedirect("country", decoded.toLowerCase());
    if (redirect) permanentRedirect(`/country/${encodeURIComponent(redirect)}`);
    notFound();
  }
  if (decoded.toLowerCase() !== country.slug.toLowerCase()) permanentRedirect(`/country/${encodeURIComponent(country.slug)}`);

  const requestedPage = Math.min(10_000, Math.max(1, Number.parseInt((await searchParams).page || "1", 10) || 1));
  let result = await queryCatalogProducts({ country: country.name }, requestedPage);
  const pages = Math.max(1, Math.ceil(result.total / result.limit));
  const page = Math.min(requestedPage, pages);
  if (page !== requestedPage) result = await queryCatalogProducts({ country: country.name }, page);
  const items = result.items;
  const operators = [...new Set(items.map((product) => product.operator))];
  const categoryIds = new Set(items.flatMap((product) => product.categoryIds));
  const relatedCategories = categories.filter((category) => categoryIds.has(category.id));
  const canonicalPath = `/country/${encodeURIComponent(country.slug)}`;
  const breadcrumbs = breadcrumbJsonLd([{ name: "Главная", path: "/" }, { name: "Страны", path: "/countries" }, { name: country.name, path: canonicalPath }]);
  const listSchema = itemListJsonLd(items.map((product) => ({ name: product.name, path: `/product/${encodeURIComponent(product.slug)}` })));
  const faqSchema = country.faq.length ? { "@context": "https://schema.org", "@type": "FAQPage", mainEntity: country.faq.map((item) => ({ "@type": "Question", name: item.question, acceptedAnswer: { "@type": "Answer", text: item.answer } })) } : null;

  return <SiteShell eyebrow="Страна" title={country.h1 || `SIM и eSIM: ${country.name}`} description={country.description || (operators.length ? `Сравните тарифы операторов ${operators.join(", ")}.` : "Тарифы для поездки.")}><ContentSection>
    <nav aria-label="Хлебные крошки" className="mb-7 overflow-x-auto text-sm text-[#637389]"><ol className="flex min-w-max items-center gap-1.5"><li><a href="/" className="hover:text-[#1168e8]">Главная</a></li><li aria-hidden="true"><ChevronRight className="size-4" /></li><li><a href="/countries" className="hover:text-[#1168e8]">Страны</a></li><li aria-hidden="true"><ChevronRight className="size-4" /></li><li aria-current="page" className="font-semibold text-[#263c57]">{country.name}</li></ol></nav>
    {country.imageUrl && <img src={country.imageUrl} alt={`SIM и eSIM для ${country.name}`} className="mb-8 aspect-[16/6] w-full rounded-2xl border border-[#dbe5ef] object-cover" />}
    {items.length ? <CatalogGrid items={items} /> : <p className="rounded-2xl border border-dashed border-[#b8c9da] p-8 text-sm text-[#637389]">В этой стране пока нет опубликованных тарифов.</p>}
    <CatalogPagination basePath={canonicalPath} page={page} pages={pages} />
    <div className="mt-8 flex flex-wrap gap-3"><a href={`/catalog?country=${encodeURIComponent(country.name)}`} className="inline-flex min-h-11 items-center rounded-xl bg-[#1168e8] px-4 font-bold text-white hover:bg-[#0d56c3]">Все тарифы с фильтрами</a>{relatedCategories.map((category) => <a key={category.id} href={`/category/${encodeURIComponent(category.slug)}`} className="inline-flex min-h-11 items-center rounded-xl border border-[#cddbea] px-4 font-bold text-[#28577f] hover:bg-[#edf5ff]">{category.name}</a>)}</div>
    {country.seoText && <section className="mt-12 max-w-3xl border-t border-[#dbe5ef] pt-10"><h2 className="text-2xl font-black text-[#10213a]">О связи в {country.name}</h2><p className="mt-4 whitespace-pre-line text-sm leading-7 text-[#52657a]">{country.seoText}</p></section>}
    {country.faq.length > 0 && <section className="mt-12 border-t border-[#dbe5ef] pt-10"><h2 className="text-2xl font-black text-[#10213a]">Частые вопросы о связи в {country.name}</h2><div className="mt-5 space-y-3">{country.faq.map((item) => <details key={item.question} className="rounded-2xl border border-[#dbe5ef] bg-white p-5"><summary className="cursor-pointer font-bold text-[#10213a]">{item.question}</summary><p className="mt-3 text-sm leading-6 text-[#637389]">{item.answer}</p></details>)}</div></section>}
  </ContentSection>
  <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(breadcrumbs) }} />
  <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(listSchema) }} />
  {faqSchema && <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(faqSchema) }} />}
  </SiteShell>;
}
