export type PromoCodeDefinition = {
  code: string;
  discountType: "percent" | "fixed";
  discountValue: number;
  currency: string;
  minOrderAmount: number;
  usageLimit: number | null;
  active: boolean;
  startsAt: string | null;
  endsAt: string | null;
};

export function normalizePromoCode(value: string) {
  return value.trim().toUpperCase();
}

export function isValidPromoCodeFormat(value: string) {
  return /^[A-Z0-9][A-Z0-9_-]{2,31}$/.test(normalizePromoCode(value));
}

export function evaluatePromoCode(
  promo: PromoCodeDefinition,
  context: { subtotalAmount: number; currency: string; usedCount: number; now?: Date },
): { valid: true; code: string; discountAmount: number } | { valid: false; error: string } {
  const now = context.now ?? new Date();
  const nowTime = now.getTime();
  if (!promo.active) return { valid: false, error: "Промокод отключён" };
  if (promo.currency.toUpperCase() !== context.currency.toUpperCase()) return { valid: false, error: "Промокод действует для другой валюты" };
  if (promo.startsAt && Date.parse(promo.startsAt) > nowTime) return { valid: false, error: "Промокод ещё не начал действовать" };
  if (promo.endsAt && Date.parse(promo.endsAt) < nowTime) return { valid: false, error: "Срок действия промокода истёк" };
  if (promo.usageLimit !== null && context.usedCount >= promo.usageLimit) return { valid: false, error: "Лимит использований промокода исчерпан" };
  if (context.subtotalAmount < promo.minOrderAmount) {
    return { valid: false, error: `Минимальная сумма товаров - ${promo.minOrderAmount.toLocaleString("ru-RU")} ${promo.currency}` };
  }
  const rawDiscount = promo.discountType === "percent"
    ? Math.floor(context.subtotalAmount * promo.discountValue / 100)
    : promo.discountValue;
  const discountAmount = Math.min(Math.max(rawDiscount, 0), Math.max(context.subtotalAmount - 1, 0));
  if (discountAmount < 1) return { valid: false, error: "Промокод не даёт скидку для этого заказа" };
  return { valid: true, code: normalizePromoCode(promo.code), discountAmount };
}
