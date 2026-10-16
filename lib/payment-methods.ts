import { getCryptoPaymentConfig } from "./crypto-payments";

export type PublicPaymentMethod = {
  id: "manager" | "crypto";
  label: string;
  description: string;
};

// Expose capabilities, never provider credentials, to the storefront.
export function getPublicPaymentMethods(): PublicPaymentMethod[] {
  const methods: PublicPaymentMethod[] = [{
    id: "manager",
    label: "Оплата по реквизитам через менеджера",
    description: "После оформления менеджер отправит реквизиты на указанный email.",
  }];
  if (getCryptoPaymentConfig()) methods.push({
    id: "crypto",
    label: "Криптовалютой",
    description: "После оформления откройте страницу оплаты и выберите доступную валюту и сеть. Заказ будет оплачен после подтверждения платёжного сервиса.",
  });
  return methods;
}
