import type { Product } from "./catalog";

/** Only this existing portrait needs a lower focal point. New admin photos stay centered. */
export function productPhotoPosition(url: string): string {
  return url.includes("/8616265a90322afac03588dbb890d40d.webp") ? "50% 75%" : "50% 50%";
}

export function productSummaryFacts(product: Pick<Product, "data" | "days" | "calls" | "sms" | "hasCalls" | "hasSms">) {
  const facts: Array<[string, string]> = [
    ["Интернет", product.data],
    ["Срок", product.days ? `${product.days} дней` : ""],
    ["Звонки", product.calls || (product.hasCalls ? "Включены" : "")],
    ["SMS", product.sms || (product.hasSms ? "Включены" : "")],
  ];
  return facts.filter(([, value]) => value && !/^(не указан[оа]?|не уточнено|срок не указан)$/i.test(value.trim()));
}
