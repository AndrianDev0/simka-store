const ACCOUNT_RETURN_ORIGIN = "https://simka.local";

export function safeAccountReturnPath(value: unknown, fallback = "/account") {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//")) return fallback;
  try {
    const url = new URL(value, ACCOUNT_RETURN_ORIGIN);
    if (url.origin !== ACCOUNT_RETURN_ORIGIN) return fallback;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return fallback;
  }
}
