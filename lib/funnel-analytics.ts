export type OrderedFunnelCounts = {
  visits: number;
  productViews: number;
  carts: number;
  checkouts: number;
  orders: number;
  payments: number;
};

function count(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.trunc(parsed)) : 0;
}

export function monotonicFunnelCounts(input: Partial<Record<keyof OrderedFunnelCounts, unknown>>): OrderedFunnelCounts {
  const visits = count(input.visits);
  const productViews = Math.min(visits, count(input.productViews));
  const carts = Math.min(productViews, count(input.carts));
  const checkouts = Math.min(carts, count(input.checkouts));
  const orders = Math.min(checkouts, count(input.orders));
  const payments = Math.min(orders, count(input.payments));
  return { visits, productViews, carts, checkouts, orders, payments };
}
