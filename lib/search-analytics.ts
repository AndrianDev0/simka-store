const sensitiveSearch = /(?:https?:\/\/|www\.|\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b|\d(?:[\s()+-]*\d){6,})/i;

export function normalizeSearchQuery(value: string) {
  const query = value.normalize("NFKC").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().toLocaleLowerCase("ru-RU").slice(0, 100);
  if (!query) return null;
  return sensitiveSearch.test(query) ? "[скрытый запрос]" : query;
}

