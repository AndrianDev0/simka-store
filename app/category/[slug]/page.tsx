import { CatalogGrid } from "@/app/components/catalog-grid";
import { ContentSection, SiteShell } from "@/app/components/site-shell";
import { products } from "@/lib/catalog";
import { getPublicCategories } from "@/lib/categories";
import type { Metadata } from "next";
import { notFound } from "next/navigation";

const definitions: Record<string, { name: string; description: string; filter: (type: typeof products[number]) => boolean }> = { esim: { name: "eSIM", description: "Цифровые тарифы с доставкой на email.", filter: (product) => product.type === "eSIM" }, sim: { name: "Физические SIM", description: "Пластиковые SIM-карты с доставкой.", filter: (product) => product.type === "SIM" }, europe: { name: "Европа", description: "Тарифы для поездок по Европе.", filter: (product) => product.region === "Европа" }, asia: { name: "Азия", description: "Связь для направлений Азии.", filter: (product) => product.region === "Азия" }, america: { name: "Америка", description: "Тарифы для стран Америки.", filter: (product) => product.region === "Америка" } };

export function generateStaticParams() { return Object.keys(definitions).map((slug) => ({ slug })); }

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const predefined = definitions[slug];
  if (predefined) return { title: `${predefined.name} — SIMKA`, description: predefined.description };
  const category = (await getPublicCategories()).find((item) => item.slug === slug);
  if (!category) return {};
  const title = category.seoTitle || category.name;
  const description = category.seoDescription || category.description;
  return {
    title,
    description,
    robots: category.noindex ? { index: false, follow: false } : { index: true, follow: true },
    alternates: category.canonicalUrl ? { canonical: category.canonicalUrl } : undefined,
    openGraph: {
      title: category.ogTitle || title,
      description: category.ogDescription || description,
      images: category.ogImage ? [category.ogImage] : category.imageUrl ? [category.imageUrl] : undefined,
    },
  };
}

export default async function CategoryPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const category = definitions[slug];
  const published = await getPublicCategories();
  const managed = published.find((item) => item.slug === slug);
  if (!category && !managed) notFound();
  const items = category
    ? products.filter(category.filter)
    : managed
      ? products.filter((product) => managed.productIds.includes(product.id))
      : [];
  const title = category?.name ?? managed?.h1 ?? managed?.name ?? "Категория";
  const description = category?.description ?? managed?.description ?? "Опубликованная категория тарифов SIMKA.";
  return <SiteShell eyebrow="Категория" title={title} description={description}><ContentSection><CatalogGrid items={items}/>{!items.length&&<p className="text-sm text-[#637389]">В этой категории пока нет тарифов.</p>}{managed?.seoText&&<section className="mt-10 max-w-3xl border-t border-[#dbe5ef] pt-8"><h2 className="text-2xl font-black text-[#10213a]">О категории</h2><p className="mt-4 whitespace-pre-line text-sm leading-7 text-[#52657a]">{managed.seoText}</p></section>}</ContentSection></SiteShell>;
}
