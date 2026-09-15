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

function safeParams(params: AnalyticsParams) {
  return Object.fromEntries(Object.entries(params).filter(([, value]) => value !== undefined));
}

export function trackEvent(name: string, params: AnalyticsParams = {}) {
  if (!browserAvailable() || !analyticsConfigured) return;
  const payload = safeParams(params);

  if (gaMeasurementId) window.gtag?.("event", name, payload);
  if (yandexMetrikaId) window.ym?.(Number(yandexMetrikaId), "reachGoal", name, payload);
  if (plausibleDomain) {
    const props: Record<string, string | number | boolean> = {};
    for (const [key, value] of Object.entries(payload)) {
      if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") props[key] = value;
    }
    window.plausible?.(name, { props });
  }
}

export function trackPageView(path: string) {
  if (!browserAvailable() || !analyticsConfigured) return;
  const pageLocation = window.location.href;
  if (gaMeasurementId) window.gtag?.("event", "page_view", { page_path: path, page_location: pageLocation });
  if (yandexMetrikaId) window.ym?.(Number(yandexMetrikaId), "hit", path, { title: document.title });
}

export function trackPurchase(orderNumber: string, params: AnalyticsParams) {
  if (!browserAvailable() || !orderNumber) return;
  const storageKey = `simka-analytics-purchase:${orderNumber}`;
  try {
    if (window.sessionStorage.getItem(storageKey)) return;
    window.sessionStorage.setItem(storageKey, "1");
  } catch {
    // Analytics must never block checkout when storage is unavailable.
  }
  trackEvent("purchase", { transaction_id: orderNumber, ...params });
}
