export type PaidCustomerOrder = {
  customerKey: string; totalAmount: number; currency: string; source: string | null; campaign: string | null; paidAt: string;
};

export type MarketingCostInput = {
  id: string; source: string; campaign: string | null; amount: number; currency: string; startsAt: string; endsAt: string;
};

const normalized = (value: string | null) => value?.trim().toLowerCase() || null;

export function calculateLtv(orders: PaidCustomerOrder[]) {
  const grouped = new Map<string, { revenue: number; customers: Set<string>; orders: number }>();
  for (const order of orders) {
    const bucket = grouped.get(order.currency) ?? { revenue: 0, customers: new Set<string>(), orders: 0 };
    bucket.revenue += order.totalAmount;
    bucket.customers.add(order.customerKey);
    bucket.orders += 1;
    grouped.set(order.currency, bucket);
  }
  return [...grouped].map(([currency, value]) => ({ currency, revenue: value.revenue, customers: value.customers.size, orders: value.orders, ltv: value.customers.size ? Math.round(value.revenue / value.customers.size) : 0 }));
}

export function calculateCampaignCac(orders: PaidCustomerOrder[], costs: MarketingCostInput[]) {
  const firstPurchase = new Map<string, PaidCustomerOrder>();
  for (const order of [...orders].sort((a, b) => a.paidAt.localeCompare(b.paidAt))) if (!firstPurchase.has(order.customerKey)) firstPurchase.set(order.customerKey, order);
  return costs.map((cost) => {
    const acquiredCustomers = [...firstPurchase.values()].filter((order) => order.currency === cost.currency
      && order.paidAt >= cost.startsAt && order.paidAt <= cost.endsAt
      && normalized(order.source) === normalized(cost.source)
      && (!cost.campaign || normalized(order.campaign) === normalized(cost.campaign))).length;
    return { ...cost, acquiredCustomers, cac: acquiredCustomers ? Math.round(cost.amount / acquiredCustomers) : null };
  });
}
