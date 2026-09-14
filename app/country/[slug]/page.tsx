import { CatalogGrid } from "@/app/components/catalog-grid";
import { ContentSection, SiteShell } from "@/app/components/site-shell";
import { products, slugify } from "@/lib/catalog";
import { notFound } from "next/navigation";
import type { Metadata } from "next";

export function generateStaticParams() { return [...new Set(products.map((product) => slugify(product.country)))].map((slug) => ({ slug })); }

function decodeSlug(slug: string) { try { return decodeURIComponent(slug); } catch { return slug; } }

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> { const { slug } = await params; const product = products.find((item) => slugify(item.country) === decodeSlug(slug)); if (!product) return {}; return { title: `SIM и eSIM для поездки в ${product.country} — SIMKA`, description: `Тарифы ${product.type} операторов для поездки в ${product.country}.` }; }

export default async function CountryPage({ params }: { params: Promise<{ slug: string }> }) { const { slug } = await params; const items = products.filter((product) => slugify(product.country) === decodeSlug(slug)); if (!items.length) notFound(); const country = items[0].country; return <SiteShell eyebrow="Страна" title={`SIM и eSIM: ${country}`} description={`Подберите тариф оператора для поездки в ${country}. Все условия и стоимость указаны до оформления заказа.`}><ContentSection><CatalogGrid items={items}/></ContentSection></SiteShell>; }
