export const ATTRIBUTION_MODELS = ["first_click", "last_click", "linear", "position_based", "time_decay"] as const;

export type AttributionModel = (typeof ATTRIBUTION_MODELS)[number];

export type AttributionTouch = {
  source: string | null;
  campaign: string | null;
  occurredAt: string;
};

export type AttributionOrder = {
  id: string;
  amount: number;
  currency: string;
  convertedAt: string;
  touches: AttributionTouch[];
};

export type AttributionRow = {
  source: string;
  campaign: string | null;
  currency: string;
  conversions: number;
  revenue: number;
};

const DAY_MS = 86_400_000;

export function isAttributionModel(value: string): value is AttributionModel {
  return ATTRIBUTION_MODELS.includes(value as AttributionModel);
}

function normalizedWeights(weights: number[]) {
  const total = weights.reduce((sum, value) => sum + value, 0);
  return total > 0 ? weights.map((value) => value / total) : weights.map(() => 1 / weights.length);
}

export function attributionWeights(model: AttributionModel, touches: AttributionTouch[], convertedAt: string) {
  if (!touches.length) return [];
  if (touches.length === 1) return [1];
  if (model === "first_click") return touches.map((_, index) => index === 0 ? 1 : 0);
  if (model === "last_click") return touches.map((_, index) => index === touches.length - 1 ? 1 : 0);
  if (model === "linear") return touches.map(() => 1 / touches.length);
  if (model === "position_based") {
    if (touches.length === 2) return [0.5, 0.5];
    return touches.map((_, index) => index === 0 || index === touches.length - 1 ? 0.4 : 0.2 / (touches.length - 2));
  }
  const conversionTime = new Date(convertedAt).getTime();
  return normalizedWeights(touches.map((touch) => {
    const touchTime = new Date(touch.occurredAt).getTime();
    const ageDays = Math.max(0, conversionTime - touchTime) / DAY_MS;
    return Math.pow(0.5, ageDays / 7);
  }));
}

function allocateMinorUnits(amount: number, weights: number[]) {
  const safeAmount = Math.max(0, Math.round(amount));
  const raw = weights.map((weight) => safeAmount * weight);
  const allocated = raw.map(Math.floor);
  const remainder = safeAmount - allocated.reduce((sum, value) => sum + value, 0);
  const byFraction = raw.map((value, index) => ({ index, fraction: value - Math.floor(value) }))
    .sort((left, right) => right.fraction - left.fraction || left.index - right.index);
  for (let index = 0; index < remainder; index += 1) allocated[byFraction[index % byFraction.length].index] += 1;
  return allocated;
}

export function calculateAttribution(orders: AttributionOrder[], model: AttributionModel): AttributionRow[] {
  const grouped = new Map<string, AttributionRow>();
  for (const order of orders) {
    const conversionTime = new Date(order.convertedAt).getTime();
    const touches = order.touches
      .filter((touch) => Number.isFinite(new Date(touch.occurredAt).getTime()) && new Date(touch.occurredAt).getTime() <= conversionTime)
      .sort((left, right) => new Date(left.occurredAt).getTime() - new Date(right.occurredAt).getTime());
    if (!touches.length) continue;
    const weights = attributionWeights(model, touches, order.convertedAt);
    const revenueShares = allocateMinorUnits(order.amount, weights);
    touches.forEach((touch, index) => {
      if (!weights[index]) return;
      const source = touch.source?.trim().toLowerCase() || "direct";
      const campaign = touch.campaign?.trim() || null;
      const currency = order.currency.trim().toUpperCase();
      const key = `${currency}\u0000${source}\u0000${campaign || ""}`;
      const current = grouped.get(key) || { source, campaign, currency, conversions: 0, revenue: 0 };
      current.conversions += weights[index];
      current.revenue += revenueShares[index];
      grouped.set(key, current);
    });
  }
  return [...grouped.values()].sort((left, right) => right.revenue - left.revenue || right.conversions - left.conversions || left.source.localeCompare(right.source));
}
