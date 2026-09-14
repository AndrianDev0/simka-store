import { CatalogGrid } from "@/app/components/catalog-grid";
import { ContentSection, SiteShell } from "@/app/components/site-shell";
import { products } from "@/lib/catalog";

const definitions: Record<string, { name: string; description: string; filter: (type: typeof products[number]) => boolean }> = { esim: { name: "eSIM", description: "Цифровые тарифы с доставкой на email.", filter: (product) => product.type === "eSIM" }, sim: { name: "Физические SIM", description: "Пластиковые SIM-карты с доставкой.", filter: (product) => product.type === "SIM" }, europe: { name: "Европа", description: "Тарифы для поездок по Европе.", filter: (product) => product.region === "Европа" }, asia: { name: "Азия", description: "Связь для направлений Азии.", filter: (product) => product.region === "Азия" }, america: { name: "Америка", description: "Тарифы для стран Америки.", filter: (product) => product.region === "Америка" } };

export function generateStaticParams() { return Object.keys(definitions).map((slug) => ({ slug })); }

export default async function CategoryPage({ params }: { params: Promise<{ slug: string }> }) { const { slug } = await params; const category = definitions[slug]; const items = category ? products.filter(category.filter) : []; return <SiteShell eyebrow="Категория" title={category?.name ?? "Категория"} description={category?.description}><ContentSection><CatalogGrid items={items}/>{!items.length&&<p className="text-sm text-[#637389]">В этой категории пока нет тарифов.</p>}</ContentSection></SiteShell>; }
