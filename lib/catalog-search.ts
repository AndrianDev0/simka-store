export function normalizeCatalogSearchQuery(value: string) {
  return value.normalize("NFKC").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 100);
}

export function catalogSearchPattern(value: string) {
  const normalized = normalizeCatalogSearchQuery(value);
  return `%${normalized.replace(/[\\%_]/g, "\\$&")}%`;
}

