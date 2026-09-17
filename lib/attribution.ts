export const ATTRIBUTION_MODELS = ["first_click", "last_click", "linear", "position_based", "time_decay"] as const;

export type AttributionModel = (typeof ATTRIBUTION_MODELS)[number];

export type AttributionTouch = {
  source: string | null;
  medium?: string | null;
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
  medium: string | null;
  campaign: string | null;
  currency: string;
  conversions: number;
  revenue: number;
};

export type AttributionPathRow = {
  path: string;
  currency: string;
  orders: number;
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

function orderedTouches(order: AttributionOrder) {
  const conversionTime = new Date(order.convertedAt).getTime();
  return order.touches
    .filter((touch) => Number.isFinite(new Date(touch.occurredAt).getTime()) && new Date(touch.occurredAt).getTime() <= conversionTime)
    .sort((left, right) => new Date(left.occurredAt).getTime() - new Date(right.occurredAt).getTime());
}

function touchIdentity(touch: AttributionTouch) {
  return {
    source: touch.source?.trim().toLowerCase() || "direct",
    medium: touch.medium?.trim().toLowerCase() || null,
    campaign: touch.campaign?.trim() || null,
  };
}

function touchLabel(touch: AttributionTouch) {
  const value = touchIdentity(touch);
  return `${value.source}${value.medium ? ` / ${value.medium}` : ""}${value.campaign ? ` [${value.campaign}]` : ""}`;
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
    const touches = orderedTouches(order);
    if (!touches.length) continue;
    const weights = attributionWeights(model, touches, order.convertedAt);
    const revenueShares = allocateMinorUnits(order.amount, weights);
    touches.forEach((touch, index) => {
      if (!weights[index]) return;
      const { source, medium, campaign } = touchIdentity(touch);
      const currency = order.currency.trim().toUpperCase();
      const key = `${currency}\u0000${source}\u0000${medium || ""}\u0000${campaign || ""}`;
      const current = grouped.get(key) || { source, medium, campaign, currency, conversions: 0, revenue: 0 };
      current.conversions += weights[index];
      current.revenue += revenueShares[index];
      grouped.set(key, current);
    });
  }
  return [...grouped.values()].sort((left, right) => right.revenue - left.revenue || right.conversions - left.conversions || left.source.localeCompare(right.source));
}

export function calculateAttributionPaths(orders: AttributionOrder[]): AttributionPathRow[] {
  const grouped = new Map<string, AttributionPathRow>();
  for (const order of orders) {
    const touches = orderedTouches(order);
    if (!touches.length) continue;
    const collapsed: Array<{ label: string; count: number }> = [];
    for (const touch of touches) {
      const label = touchLabel(touch);
      const previous = collapsed.at(-1);
      if (previous?.label === label) previous.count += 1;
      else collapsed.push({ label, count: 1 });
    }
    const path = collapsed.map((item) => `${item.label}${item.count > 1 ? ` ×${item.count}` : ""}`).join(" → ");
    const currency = order.currency.trim().toUpperCase();
    const key = `${currency}\u0000${path}`;
    const current = grouped.get(key) || { path, currency, orders: 0, revenue: 0 };
    current.orders += 1;
    current.revenue += Math.max(0, Math.round(order.amount));
    grouped.set(key, current);
  }
  return [...grouped.values()].sort((left, right) => right.orders - left.orders || right.revenue - left.revenue || left.path.localeCompare(right.path));
}
