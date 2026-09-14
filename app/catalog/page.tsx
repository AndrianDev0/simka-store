import { CatalogGrid } from "@/app/components/catalog-grid";
import { ContentSection, SiteShell } from "@/app/components/site-shell";

export const metadata = { title: "Каталог SIM и eSIM — SIMKA", description: "Тарифы SIM и eSIM для путешествий по популярным направлениям." };

export default function CatalogPage() {
  return <SiteShell eyebrow="Каталог" title="Тарифы для поездок" description="Сравните объём интернета, срок действия и способ подключения — и выберите подходящую SIM или eSIM."><ContentSection><CatalogGrid/></ContentSection></SiteShell>;
}
