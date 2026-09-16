export const RETENTION_DAYS = [1, 7, 14, 30, 60, 90] as const;

export type RetentionOrder = {
  customerKey: string;
  paidAt: string;
  source?: string | null;
};

export type RetentionRow = {
  label: string;
  customers: number;
  retained: Record<(typeof RETENTION_DAYS)[number], number>;
  eligible: Record<(typeof RETENTION_DAYS)[number], number>;
};

type CustomerPurchases = { firstAt: number; repeatAt: number[]; source: string };

function customerPurchases(orders: RetentionOrder[]) {
  const grouped = new Map<string, Array<{ paidAt: number; source: string }>>();
  for (const order of orders) {
    const paidAt = new Date(order.paidAt).getTime();
    if (!Number.isFinite(paidAt)) continue;
    const rows = grouped.get(order.customerKey) ?? [];
    rows.push({ paidAt, source: order.source?.trim().toLowerCase() || "direct" });
    grouped.set(order.customerKey, rows);
  }
  const result = new Map<string, CustomerPurchases>();
  for (const [customerKey, rows] of grouped) {
    rows.sort((left, right) => left.paidAt - right.paidAt);
    result.set(customerKey, { firstAt: rows[0].paidAt, repeatAt: rows.slice(1).map((row) => row.paidAt), source: rows[0].source });
  }
  return result;
}

function buildRow(label: string, customers: CustomerPurchases[], now: number): RetentionRow {
  const eligible = Object.fromEntries(RETENTION_DAYS.map((days) => [days, customers.filter((customer) => now - customer.firstAt >= days * 86_400_000).length])) as RetentionRow["eligible"];
  const retained = Object.fromEntries(RETENTION_DAYS.map((days) => {
    const boundary = days * 86_400_000;
    const count = customers.filter((customer) => now - customer.firstAt >= boundary && customer.repeatAt.some((repeatAt) => repeatAt > customer.firstAt && repeatAt - customer.firstAt <= boundary)).length;
    return [days, count];
  })) as RetentionRow["retained"];
  return { label, customers: customers.length, retained, eligible };
}

export function calculateRepeatPurchaseRetention(orders: RetentionOrder[], now = new Date()) {
  const customers = [...customerPurchases(orders).values()];
  const cohorts = new Map<string, CustomerPurchases[]>();
  const sources = new Map<string, CustomerPurchases[]>();
  for (const customer of customers) {
    const first = new Date(customer.firstAt);
    const cohort = `${first.getUTCFullYear()}-${String(first.getUTCMonth() + 1).padStart(2, "0")}`;
    cohorts.set(cohort, [...(cohorts.get(cohort) ?? []), customer]);
    sources.set(customer.source, [...(sources.get(customer.source) ?? []), customer]);
  }
  return {
    overall: buildRow("Все покупатели", customers, now.getTime()),
    cohorts: [...cohorts].sort(([left], [right]) => right.localeCompare(left)).map(([label, rows]) => buildRow(label, rows, now.getTime())),
    sources: [...sources].map(([label, rows]) => buildRow(label, rows, now.getTime())).sort((left, right) => right.customers - left.customers),
  };
}

export function retentionPercent(retained: number, customers: number) {
  return customers ? retained / customers * 100 : 0;
}
