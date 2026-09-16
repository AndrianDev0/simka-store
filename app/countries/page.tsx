import { ContentSection, InfoCard, SiteShell } from "@/app/components/site-shell";
import { CountryFlag } from "@/app/components/country-flag";
import { getCatalogCountries, getCatalogProducts } from "@/lib/catalog-repository";
import { productDisplayOffer } from "@/lib/catalog";
import { itemListJsonLd, jsonLd, pageMetadata } from "@/lib/seo";

export const metadata = pageMetadata({
  title: "SIM и eSIM по странам",
  description: "Выберите страну и сравните опубликованные SIM и eSIM: операторы, объём интернета, срок и цены.",
  path: "/countries",
});
export const dynamic = "force-dynamic";

export default async function CountriesPage() {
  const [countries, products] = await Promise.all([getCatalogCountries(), getCatalogProducts()]);
  const listSchema = itemListJsonLd(countries.map((country) => ({ name: country.name, path: `/country/${encodeURIComponent(country.slug)}` })));

  return <SiteShell eyebrow="Страны" title="SIM и eSIM по странам" description="Откройте страницу страны, чтобы сравнить все опубликованные тарифы и операторов."><ContentSection>
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{countries.map((country) => {
      const items = products.filter((product) => product.countryId === country.id);
      const operators = [...new Set(items.map((product) => product.operator))];
      const offers = items.map(productDisplayOffer);
      const currencies = new Set(offers.map((offer) => offer.currency));
      const minPrice = offers.length && currencies.size === 1 ? Math.min(...offers.map((offer) => offer.price)) : null;
      const currency = offers[0]?.currency;
      const formattedMin = minPrice !== null && currency ? new Intl.NumberFormat("ru-RU", { style: "currency", currency, maximumFractionDigits: 0 }).format(minPrice) : null;
      return <InfoCard key={country.id} title={<span className="flex items-center gap-3"><CountryFlag flag={country.flag} country={country.name} className="h-8 w-11" />{country.name}</span>}><p>{country.description || `SIM и eSIM для путешествий: ${country.name}.`}</p><p className="mt-2">{items.length} {items.length === 1 ? "тариф" : items.length > 1 && items.length < 5 ? "тарифа" : "тарифов"}{operators.length ? ` · ${operators.join(", ")}` : ""}</p>{formattedMin && <p className="mt-2">От {formattedMin}</p>}{offers.length > 0 && currencies.size > 1 && <p className="mt-2">Цены доступны в разных валютах</p>}<a className="mt-4 inline-flex min-h-11 items-center rounded-xl bg-[#1168e8] px-4 font-bold text-white hover:bg-[#0d56c3]" href={`/country/${encodeURIComponent(country.slug)}`}>Тарифы страны →</a></InfoCard>;
    })}</div>
    {!countries.length && <p className="rounded-2xl border border-dashed border-[#b8c9da] p-8 text-sm text-[#637389]">Опубликованных стран пока нет.</p>}
  </ContentSection><script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(listSchema) }} /></SiteShell>;
}
