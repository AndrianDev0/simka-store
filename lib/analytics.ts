export type AnalyticsItem = {
  item_id: string;
  item_name: string;
  item_category?: string;
  item_variant?: string;
  price?: number;
  quantity?: number;
};

export type AnalyticsParams = Record<string, string | number | boolean | AnalyticsItem[] | undefined>;

type Gtag = (...args: unknown[]) => void;
type YandexMetrika = ((...args: unknown[]) => void) & { a?: unknown[]; l?: number };
type Plausible = ((eventName: string, options?: { props?: Record<string, string | number | boolean> }) => void) & { q?: unknown[] };

declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: Gtag;
    ym?: YandexMetrika;
    plausible?: Plausible;
    __simkaAnalyticsInitialised?: boolean;
  }
}

export const ANALYTICS_CONSENT_KEY = "simka-analytics-consent";
export const ANALYTICS_READY_EVENT = "simka-analytics-ready";

const gaMeasurementId = process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID?.trim() || "";
const yandexMetrikaId = process.env.NEXT_PUBLIC_YANDEX_METRIKA_ID?.trim() || "";
const plausibleDomain = process.env.NEXT_PUBLIC_PLAUSIBLE_DOMAIN?.trim() || "";

export const analyticsConfigured = Boolean(gaMeasurementId || yandexMetrikaId || plausibleDomain);

export function analyticsConfig() {
  return { gaMeasurementId, yandexMetrikaId, plausibleDomain };
}

function browserAvailable() {
  return typeof window !== "undefined";
}

function analyticsReady() {
  if (!browserAvailable() || !analyticsConfigured || !window.__simkaAnalyticsInitialised) return false;
  try {
    return window.localStorage.getItem(ANALYTICS_CONSENT_KEY) === "accepted";
  } catch {
    return false;
  }
}

function safeParams(params: AnalyticsParams) {
  return Object.fromEntries(Object.entries(params).filter(([, value]) => value !== undefined));
}

export function trackEvent(name: string, params: AnalyticsParams = {}) {
  if (!analyticsReady()) return false;
  const payload = safeParams(params);
  let sent = false;

  if (gaMeasurementId && window.gtag) { window.gtag("event", name, payload); sent = true; }
  if (yandexMetrikaId && window.ym) { window.ym(Number(yandexMetrikaId), "reachGoal", name, payload); sent = true; }
  if (plausibleDomain) {
    const props: Record<string, string | number | boolean> = {};
    for (const [key, value] of Object.entries(payload)) {
      if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") props[key] = value;
    }
    if (window.plausible) { window.plausible(name, { props }); sent = true; }
  }
  return sent;
}

export function trackPageView(path: string) {
  if (!analyticsReady()) return false;
  const safePath = path.startsWith("/") ? path.split(/[?#]/, 1)[0] : "/";
  const pageLocation = `${window.location.origin}${safePath}`;
  let sent = false;
  if (gaMeasurementId && window.gtag) { window.gtag("event", "page_view", { page_path: safePath, page_location: pageLocation }); sent = true; }
  if (yandexMetrikaId && window.ym) { window.ym(Number(yandexMetrikaId), "hit", safePath, { title: document.title }); sent = true; }
  return sent;
}

export function trackPurchase(orderNumber: string, params: AnalyticsParams) {
  if (!browserAvailable() || !orderNumber) return;
  const storageKey = `simka-analytics-purchase:${orderNumber}`;
  try {
    if (window.localStorage.getItem(storageKey)) return;
  } catch {
    // Analytics must never block checkout when storage is unavailable.
  }
  if (!trackEvent("purchase", { transaction_id: orderNumber, ...params })) return;
  try { window.localStorage.setItem(storageKey, "1"); } catch { /* Best-effort deduplication. */ }
}

export function trackOnce(key: string, name: string, params: AnalyticsParams = {}) {
  if (!browserAvailable() || !key) return;
  const storageKey = `simka-analytics-event:${key}`;
  try {
    if (window.localStorage.getItem(storageKey)) return;
  } catch {
    // The event may still be sent when persistent storage is unavailable.
  }
  if (!trackEvent(name, params)) return;
  try { window.localStorage.setItem(storageKey, "1"); } catch { /* Best-effort deduplication. */ }
}
