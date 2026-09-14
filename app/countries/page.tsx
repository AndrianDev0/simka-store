import { ContentSection, InfoCard, SiteShell } from "@/app/components/site-shell";
import { products, slugify } from "@/lib/catalog";

export const metadata = { title: "Страны — SIMKA", description: "SIM и eSIM для популярных стран и направлений." };

export default function CountriesPage() { const countries = [...new Map(products.map((product) => [product.country, product])).values()]; return <SiteShell eyebrow="Страны" title="Связь в любой поездке" description="Откройте страницу страны, чтобы увидеть доступные тарифы операторов."><ContentSection><div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{countries.map((product) => <InfoCard key={product.country} title={`${product.flag} ${product.country}`}><p>{product.operator} · {product.data} · {product.days} дней</p><a className="mt-4 inline-flex min-h-11 items-center rounded-xl bg-[#1168e8] px-4 font-bold text-white hover:bg-[#0d56c3]" href={`/country/${slugify(product.country)}`}>Тарифы страны →</a></InfoCard>)}</div></ContentSection></SiteShell>; }
