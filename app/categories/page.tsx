import { ContentSection, InfoCard, SiteShell } from "@/app/components/site-shell";

const categories = [{ slug: "esim", name: "eSIM", text: "Цифровые тарифы с доставкой QR-кода на email." }, { slug: "sim", name: "Физические SIM", text: "Пластиковые SIM-карты с доставкой по согласованному адресу." }, { slug: "europe", name: "Европа", text: "Связь для путешествий по странам Европы." }, { slug: "asia", name: "Азия", text: "Тарифы для Таиланда, Японии и других направлений Азии." }, { slug: "america", name: "Америка", text: "Мобильный интернет для поездок в США и странах региона." }];

export const metadata = { title: "Категории тарифов — SIMKA", description: "Выберите тип SIM или направление путешествия." };

export default function CategoriesPage() { return <SiteShell eyebrow="Категории" title="Найдите тариф по задаче" description="Фильтруйте предложения по типу SIM и направлению поездки."><ContentSection><div className="grid gap-4 sm:grid-cols-2">{categories.map((category) => <InfoCard key={category.slug} title={category.name}><p>{category.text}</p><a className="mt-4 inline-flex min-h-11 items-center rounded-xl bg-[#1168e8] px-4 font-bold text-white hover:bg-[#0d56c3]" href={`/category/${category.slug}`}>Открыть категорию →</a></InfoCard>)}</div></ContentSection></SiteShell>; }
