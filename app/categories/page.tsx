import { ContentSection, InfoCard, SiteShell } from "@/app/components/site-shell";
import { getPublicCategories } from "@/lib/categories";
import { itemListJsonLd, jsonLd, pageMetadata } from "@/lib/seo";

const builtInCategories = [
  { slug: "esim", name: "eSIM", text: "Цифровые тарифы с доставкой QR-кода на email.", parentId: null },
  { slug: "sim", name: "Физические SIM", text: "Пластиковые SIM-карты с доставкой по согласованному адресу.", parentId: null },
  { slug: "europe", name: "Европа", text: "Связь для путешествий по странам Европы.", parentId: null },
  { slug: "asia", name: "Азия", text: "Тарифы для Таиланда, Японии и других направлений Азии.", parentId: null },
  { slug: "america", name: "Америка", text: "Мобильный интернет для поездок в США и странах региона.", parentId: null },
];

export const metadata = pageMetadata({ title: "Категории SIM-карт и eSIM", description: "Выберите eSIM, физическую SIM, регион или тематическую подборку тарифов для поездки.", path: "/categories" });
export const dynamic = "force-dynamic";

export default async function CategoriesPage() {
  const published = await getPublicCategories();
  const known = new Set(builtInCategories.map((category) => category.slug));
  const managed = published.filter((category) => !known.has(category.slug));
  const managedIds = new Set(managed.map((category) => category.id));
  const roots = [...builtInCategories, ...managed.filter((category) => !category.parentId || !managedIds.has(category.parentId)).map((category) => ({ slug: category.slug, name: category.name, text: category.description || "Опубликованная категория тарифов SIMKA.", parentId: null }))];
  const listSchema = itemListJsonLd(roots.map((category) => ({ name: category.name, path: `/category/${encodeURIComponent(category.slug)}` })));
  return <SiteShell eyebrow="Категории" title="Категории SIM-карт и eSIM" description="Категории и подкатегории помогают быстро перейти к нужной подборке."><ContentSection>
    <div className="grid gap-4 sm:grid-cols-2">{roots.map((category) => {
      const source = managed.find((item) => item.slug === category.slug);
      const children = source ? managed.filter((item) => item.parentId === source.id) : [];
      return <InfoCard key={category.slug} title={category.name}><p>{category.text}</p>{children.length>0&&<div className="mt-4 flex flex-wrap gap-2" aria-label={`Подкатегории: ${category.name}`}>{children.map((child) => <a key={child.id} href={`/category/${child.slug}`} className="inline-flex min-h-10 items-center rounded-lg border border-[#cddbea] bg-[#f7fbff] px-3 font-semibold text-[#28577f] hover:border-[#9fc5f4]">{child.name}</a>)}</div>}<a className="mt-4 inline-flex min-h-11 items-center rounded-xl bg-[#1168e8] px-4 font-bold text-white hover:bg-[#0d56c3]" href={`/category/${category.slug}`}>Открыть категорию →</a></InfoCard>;
    })}</div>
  </ContentSection><script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(listSchema) }} /></SiteShell>;
}
