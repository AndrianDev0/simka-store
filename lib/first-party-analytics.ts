export const FIRST_PARTY_EVENT_NAMES = new Set([
  "page_view", "page_engagement", "page_exit", "session_heartbeat", "view_item_list", "view_item", "search", "catalog_filter",
  "add_to_cart", "remove_from_cart", "view_cart", "begin_checkout", "add_payment_info",
  "generate_lead", "purchase", "order_cancelled", "refund", "promo_code_applied", "checkout_error",
  "login", "sign_up", "password_reset", "partner_referral", "contact", "file_download",
  "exception", "page_not_found", "web_vital",
]);

const PARAM_KEYS = new Set([
  "currency", "value", "coupon", "transaction_id", "item_list_id", "item_list_name",
  "query_length", "results_count", "no_results", "search_location", "filters", "has_search",
  "region", "sim_type", "filter_location", "payment_type", "error_type", "method", "partner_id",
  "file_extension", "fatal", "error_area", "page_path", "metric_name", "metric_id", "metric_rating",
  "duration_ms", "page_id", "items",
]);

type JsonScalar = string | number | boolean | null;
export type SafeAnalyticsParams = Record<string, JsonScalar | Array<Record<string, JsonScalar>>>;

function safeString(value: unknown, maximum = 200) {
  if (typeof value !== "string") return null;
  const normalized = value.trim().slice(0, maximum);
  return normalized || null;
}

function safeNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && Math.abs(value) <= 1_000_000_000_000 ? value : null;
}

/** Keep Web Vitals in their native units; CLS must not be rounded to an integer. */
export function preserveWebVitalValue(value: number) {
  return Number.isFinite(value) ? value : 0;
}

export function analyticsSessionExitState(name: string, params: SafeAnalyticsParams, occurredAt: string) {
  if (name !== "page_exit") return { endedAt: null, exitDurationMs: null };
  const rawDuration = params.duration_ms;
  const exitDurationMs = typeof rawDuration === "number" && Number.isFinite(rawDuration)
    ? Math.round(Math.max(0, Math.min(rawDuration, 24 * 60 * 60_000)))
    : 0;
  return { endedAt: occurredAt, exitDurationMs };
}

function sanitizeItems(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 20).flatMap((raw) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return [];
    const item = raw as Record<string, unknown>;
    const id = safeString(item.item_id, 120);
    const name = safeString(item.item_name, 220);
    if (!id || !name) return [];
    const output: Record<string, JsonScalar> = { item_id: id, item_name: name };
    for (const key of ["item_category", "item_variant"] as const) {
      const parsed = safeString(item[key], 160);
      if (parsed) output[key] = parsed;
    }
    for (const key of ["price", "quantity"] as const) {
      const parsed = safeNumber(item[key]);
      if (parsed !== null && parsed >= 0) output[key] = parsed;
    }
    return [output];
  });
}

export function validAnalyticsEventName(name: string) {
  return FIRST_PARTY_EVENT_NAMES.has(name) || /^custom_[a-z0-9_]{1,40}$/.test(name);
}

export function sanitizeAnalyticsParams(input: unknown): SafeAnalyticsParams {
  if (!input || typeof input !== "object" || Array.isArray(input)) return {};
  const output: SafeAnalyticsParams = {};
  for (const [key, raw] of Object.entries(input as Record<string, unknown>).slice(0, 30)) {
    if (!PARAM_KEYS.has(key)) continue;
    if (key === "items") {
      const items = sanitizeItems(raw);
      if (items.length) output.items = items;
      continue;
    }
    if (typeof raw === "boolean") output[key] = raw;
    else {
      const number = safeNumber(raw);
      if (number !== null) output[key] = number;
      else {
        const string = safeString(raw, key === "filters" ? 300 : 200);
        if (string) output[key] = string;
      }
    }
  }
  return output;
}

export function safeAnalyticsPath(value: string) {
  if (!value.startsWith("/")) return "/";
  const path = value.split(/[?#]/, 1)[0].replace(/[\u0000-\u001f\u007f]/g, "").slice(0, 500);
  return path || "/";
}

export function parseAnalyticsUserAgent(userAgent: string) {
  const ua = userAgent.slice(0, 1000);
  const deviceType = /iPad|Tablet|PlayBook|Silk/i.test(ua) ? "tablet" : /Mobi|Android|iPhone|iPod/i.test(ua) ? "mobile" : "desktop";
  const operatingSystem = /iPhone|iPad|iPod/i.test(ua) ? "iOS" : /Android/i.test(ua) ? "Android" : /Windows/i.test(ua) ? "Windows" : /Mac OS X|Macintosh/i.test(ua) ? "macOS" : /Linux/i.test(ua) ? "Linux" : "Other";
  const browser = /Edg\//i.test(ua) ? "Edge" : /OPR\//i.test(ua) ? "Opera" : /Firefox\//i.test(ua) ? "Firefox" : /CriOS|Chrome\//i.test(ua) ? "Chrome" : /Safari\//i.test(ua) ? "Safari" : "Other";
  return { deviceType, operatingSystem, browser };
}

export function safeHeaderLocation(value: string | null, maximum: number) {
  if (!value) return null;
  try { return decodeURIComponent(value).replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, maximum) || null; }
  catch { return null; }
}
