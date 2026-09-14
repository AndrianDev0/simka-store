import { CatalogGrid } from "@/app/components/catalog-grid";
import { ContentSection, SiteShell } from "@/app/components/site-shell";
import { products } from "@/lib/catalog";
import { getPublicCategories } from "@/lib/categories";

const definitions: Record<string, { name: string; description: string; filter: (type: typeof products[number]) => boolean }> = { esim: { name: "eSIM", description: "Цифровые тарифы с доставкой на email.", filter: (product) => product.type === "eSIM" }, sim: { name: "Физические SIM", description: "Пластиковые SIM-карты с доставкой.", filter: (product) => product.type === "SIM" }, europe: { name: "Европа", description: "Тарифы для поездок по Европе.", filter: (product) => product.region === "Европа" }, asia: { name: "Азия", description: "Связь для направлений Азии.", filter: (product) => product.region === "Азия" }, america: { name: "Америка", description: "Тарифы для стран Америки.", filter: (product) => product.region === "Америка" } };

export function generateStaticParams() { return Object.keys(definitions).map((slug) => ({ slug })); }

export const dynamic = "force-dynamic";

export default async function CategoryPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const category = definitions[slug];
  const published = await getPublicCategories();
  const managed = published.find((item) => item.slug === slug);
  const items = category
    ? products.filter(category.filter)
    : managed
      ? products.filter((product) => managed.productIds.includes(product.id))
      : [];
  const title = category?.name ?? managed?.name ?? "Категория";
  const description = category?.description ?? managed?.description ?? "Опубликованная категория тарифов SIMKA.";
  return <SiteShell eyebrow="Категория" title={title} description={description}><ContentSection><CatalogGrid items={items}/>{!items.length&&<p className="text-sm text-[#637389]">В этой категории пока нет тарифов.</p>}</ContentSection></SiteShell>;
}
