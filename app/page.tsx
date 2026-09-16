import Storefront from "./storefront";
import { getPublicCategories } from "@/lib/categories";
import { getCatalogProducts } from "@/lib/catalog-repository";
import { getCurrentAccount } from "@/lib/customer-auth";
import { absoluteUrl, jsonLd, pageMetadata, SITE_NAME } from "@/lib/seo";

export const metadata = pageMetadata({
  title: "eSIM и SIM для путешествий: тарифы по странам",
  description: "Сравните SIM и eSIM для поездок по стране, оператору, объёму интернета и сроку. eSIM приходит на email после оплаты.",
  path: "/",
});

export const dynamic = "force-dynamic";

export default async function Home() {
  const [categories, products, account] = await Promise.all([getPublicCategories(), getCatalogProducts(), getCurrentAccount()]);
  const organization = {
    "@context": "https://schema.org",
    "@type": "Organization",
    "@id": `${absoluteUrl("/")}#organization`,
    name: SITE_NAME,
    url: absoluteUrl("/"),
    logo: { "@type": "ImageObject", url: absoluteUrl("/logo.svg"), width: 512, height: 512 },
  };
  const website = {
    "@context": "https://schema.org",
    "@type": "WebSite",
    "@id": `${absoluteUrl("/")}#website`,
    url: absoluteUrl("/"),
    name: SITE_NAME,
    alternateName: "Симка",
    inLanguage: "ru-RU",
    publisher: { "@id": `${absoluteUrl("/")}#organization` },
  };
  return <><Storefront categories={categories} products={products} customer={account ? { name: account.name, email: account.email, contact: account.contact } : undefined} /><script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(organization) }} /><script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(website) }} /></>;
}
