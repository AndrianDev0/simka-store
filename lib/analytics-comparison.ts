export function percentage(part: number, total: number) {
  return total > 0 ? part / total * 100 : 0;
}

export function formatPercentage(value: number) {
  return `${value.toFixed(1).replace(".", ",")}%`;
}

export function formatRelativeChange(current: number, previous: number) {
  if (previous === 0) return current === 0 ? "0%" : "новое";
  const change = (current - previous) / previous * 100;
  const sign = change > 0 ? "+" : "";
  return `${sign}${change.toFixed(1).replace(".", ",")}%`;
}

