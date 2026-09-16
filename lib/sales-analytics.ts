export type SaleLine = { label: string; currency: string; quantity: number; revenue: number };

// Never add monetary amounts from different currencies together.
export function groupSalesByCurrency(rows: SaleLine[]): SaleLine[] {
  const grouped = new Map<string, SaleLine>();
  for (const row of rows) {
    const key = JSON.stringify([row.currency, row.label]);
    const current = grouped.get(key);
    if (current) {
      current.quantity += row.quantity;
      current.revenue += row.revenue;
    } else {
      grouped.set(key, { ...row });
    }
  }
  return [...grouped.values()].sort((a, b) =>
    a.currency.localeCompare(b.currency) || b.revenue - a.revenue || a.label.localeCompare(b.label)
  );
}

export function formatSalesByCurrency(rows: SaleLine[], emptyMessage: string, limit = 15): string {
  if (!rows.length) return emptyMessage;
  const grouped = groupSalesByCurrency(rows);
  const currencies = [...new Set(grouped.map((row) => row.currency))];
  return currencies.map((currency) => {
    const lines = grouped.filter((row) => row.currency === currency).slice(0, limit);
    return `${currency}\n${lines.map((row, index) => `${index + 1}. ${row.label} · ${row.quantity} шт. · ${row.revenue.toLocaleString("ru-RU")} ${currency}`).join("\n")}`;
  }).join("\n\n");
}
