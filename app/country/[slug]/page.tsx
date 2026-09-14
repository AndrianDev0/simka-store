import { CatalogGrid } from "@/app/components/catalog-grid";
import { ContentSection, SiteShell } from "@/app/components/site-shell";
import { products, slugify } from "@/lib/catalog";

export function generateStaticParams() { return [...new Set(products.map((product) => slugify(product.country)))].map((slug) => ({ slug })); }

export default async function CountryPage({ params }: { params: Promise<{ slug: string }> }) { const { slug } = await params; const items = products.filter((product) => slugify(product.country) === slug); const country = items[0]?.country ?? "Направление"; return <SiteShell eyebrow="Страна" title={`SIM и eSIM: ${country}`} description={`Подберите тариф оператора для поездки в ${country}. Все условия и стоимость указаны до оформления заказа.`}><ContentSection><CatalogGrid items={items}/>{!items.length&&<p className="text-sm text-[#637389]">Для этой страны пока нет опубликованных тарифов.</p>}</ContentSection></SiteShell>; }
