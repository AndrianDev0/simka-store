import { ANALYTICS_POLICY_VERSION } from "@/lib/analytics-policy";
import { reusableAnalyticsSession, resolveLandingAttribution, type AnalyticsAttribution } from "@/lib/analytics-attribution";

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
export const ANALYTICS_CONSENT_ID_KEY = "simka-analytics-consent-id";
export const ANALYTICS_CONSENT_VERSION_KEY = "simka-analytics-consent-version";
export { ANALYTICS_POLICY_VERSION } from "@/lib/analytics-policy";
export const ANALYTICS_READY_EVENT = "simka-analytics-ready";
const ANALYTICS_SESSION_KEY = "simka-analytics-session";
const ANALYTICS_ATTRIBUTION_KEY = "simka-analytics-attribution";
const SESSION_TIMEOUT_MS = 30 * 60_000;

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

export function analyticsConsentGranted() {
  if (!browserAvailable()) return false;
  try {
    return window.localStorage.getItem(ANALYTICS_CONSENT_KEY) === "accepted"
      && window.localStorage.getItem(ANALYTICS_CONSENT_VERSION_KEY) === ANALYTICS_POLICY_VERSION;
  } catch {
    return false;
  }
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function getAnalyticsClientId() {
  if (!analyticsConsentGranted()) return null;
  try {
    const value = window.localStorage.getItem(ANALYTICS_CONSENT_ID_KEY);
    return value && uuidPattern.test(value) ? value : null;
  } catch { return null; }
}

let activeAnalyticsSession: { id: string; attribution: AnalyticsAttribution; lastSeen: number } | null = null;

function analyticsSession() {
  const now = Date.now();
  if (activeAnalyticsSession) {
    if (now - activeAnalyticsSession.lastSeen > SESSION_TIMEOUT_MS) {
      activeAnalyticsSession = { id: crypto.randomUUID(), attribution: { source: "direct", medium: "none" }, lastSeen: now };
    } else activeAnalyticsSession.lastSeen = now;
    try { window.sessionStorage.setItem(ANALYTICS_SESSION_KEY, JSON.stringify(activeAnalyticsSession)); } catch { /* Best effort. */ }
    return activeAnalyticsSession;
  }
  try {
    const stored = JSON.parse(window.sessionStorage.getItem(ANALYTICS_SESSION_KEY) || "null") as { id?: unknown; lastSeen?: unknown; attribution?: AnalyticsAttribution } | null;
    const landing = resolveLandingAttribution(window.location.href, document.referrer, window.location.origin);
    const reuse = reusableAnalyticsSession(stored?.id, stored?.lastSeen, now, landing.explicitTouch, SESSION_TIMEOUT_MS);
    let legacyAttribution: AnalyticsAttribution | undefined;
    try {
      legacyAttribution = JSON.parse(window.localStorage.getItem(ANALYTICS_ATTRIBUTION_KEY) || "null") as AnalyticsAttribution | undefined;
      window.localStorage.removeItem(ANALYTICS_ATTRIBUTION_KEY);
    } catch { /* Legacy attribution is optional. */ }
    activeAnalyticsSession = {
      id: reuse ? stored!.id as string : crypto.randomUUID(),
      attribution: reuse ? stored?.attribution || legacyAttribution || landing.attribution : landing.attribution,
      lastSeen: now,
    };
    window.sessionStorage.setItem(ANALYTICS_SESSION_KEY, JSON.stringify(activeAnalyticsSession));
    return activeAnalyticsSession;
  } catch {
    activeAnalyticsSession = { id: crypto.randomUUID(), attribution: resolveLandingAttribution(window.location.href, document.referrer, window.location.origin).attribution, lastSeen: now };
    return activeAnalyticsSession;
  }
}

function trackFirstParty(name: string, params: AnalyticsParams, path = window.location.pathname, options: { beacon?: boolean; eventId?: string } = {}) {
  const clientId = getAnalyticsClientId();
  if (!clientId) return false;
  const session = analyticsSession();
  const connection = (navigator as Navigator & { connection?: { effectiveType?: string } }).connection;
  const body = {
    eventId: options.eventId || crypto.randomUUID(), clientId, sessionId: session.id, name, path,
    occurredAt: new Date().toISOString(), params, attribution: session.attribution,
    device: {
      language: navigator.language, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      screenWidth: window.screen.width, screenHeight: window.screen.height,
      viewportWidth: window.innerWidth, viewportHeight: window.innerHeight,
      pixelRatio: window.devicePixelRatio, connectionType: connection?.effectiveType,
      automation: navigator.webdriver === true,
    },
  };
  const serialized = JSON.stringify(body);
  if (options.beacon && typeof navigator.sendBeacon === "function") {
    try {
      if (navigator.sendBeacon("/api/analytics/events", new Blob([serialized], { type: "application/json" }))) return true;
    } catch { /* Fall back to keepalive fetch. */ }
  }
  void fetch("/api/analytics/events", {
    method: "POST", credentials: "same-origin", keepalive: true,
    headers: { "Content-Type": "application/json" }, body: serialized,
  }).catch(() => undefined);
  return true;
}

function safeParams(params: AnalyticsParams) {
  return Object.fromEntries(Object.entries(params).filter(([, value]) => value !== undefined));
}

export function trackEvent(name: string, params: AnalyticsParams = {}) {
  if (!analyticsConsentGranted()) return false;
  const payload = safeParams(params);
  let sent = trackFirstParty(name, payload);

  if (window.__simkaAnalyticsInitialised && gaMeasurementId && window.gtag) { window.gtag("event", name, payload); sent = true; }
  if (window.__simkaAnalyticsInitialised && yandexMetrikaId && window.ym) { window.ym(Number(yandexMetrikaId), "reachGoal", name, payload); sent = true; }
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
  if (!analyticsConsentGranted()) return false;
  const safePath = path.startsWith("/") ? path.split(/[?#]/, 1)[0] : "/";
  const pageLocation = `${window.location.origin}${safePath}`;
  let sent = trackFirstParty("page_view", {}, safePath);
  if (window.__simkaAnalyticsInitialised && gaMeasurementId && window.gtag) { window.gtag("event", "page_view", { page_path: safePath, page_location: pageLocation }); sent = true; }
  if (window.__simkaAnalyticsInitialised && yandexMetrikaId && window.ym) { window.ym(Number(yandexMetrikaId), "hit", safePath, { title: document.title }); sent = true; }
  return sent;
}

export function trackPageExit(path: string, durationMs: number, eventId: string) {
  if (!analyticsConsentGranted()) return false;
  const safePath = path.startsWith("/") ? path.split(/[?#]/, 1)[0] : "/";
  const payload = { duration_ms: Math.round(Math.max(0, Math.min(durationMs, 24 * 60 * 60_000))), page_path: safePath };
  let sent = trackFirstParty("page_exit", payload, safePath, { beacon: true, eventId });
  if (window.__simkaAnalyticsInitialised && gaMeasurementId && window.gtag) { window.gtag("event", "page_exit", { ...payload, transport_type: "beacon" }); sent = true; }
  if (window.__simkaAnalyticsInitialised && yandexMetrikaId && window.ym) { window.ym(Number(yandexMetrikaId), "reachGoal", "page_exit", payload); sent = true; }
  if (plausibleDomain && window.plausible) { window.plausible("page_exit", { props: payload }); sent = true; }
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
