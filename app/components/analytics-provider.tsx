"use client";

import { useCallback, useEffect, useSyncExternalStore } from "react";
import { usePathname } from "next/navigation";
import { useReportWebVitals } from "next/web-vitals";
import { ANALYTICS_CONSENT_ID_KEY, ANALYTICS_CONSENT_KEY, ANALYTICS_POLICY_VERSION, ANALYTICS_READY_EVENT, analyticsConfig, trackEvent, trackPageView } from "@/lib/analytics";

type Consent = "accepted" | "declined" | null;
type ConsentDecision = Exclude<Consent, null> | "withdrawn";

function subscribeToConsent(callback: () => void) {
  window.addEventListener("storage", callback);
  window.addEventListener("simka-consent-change", callback);
  return () => {
    window.removeEventListener("storage", callback);
    window.removeEventListener("simka-consent-change", callback);
  };
}

function consentSnapshot(): Consent {
  try {
    const stored = window.localStorage.getItem(ANALYTICS_CONSENT_KEY);
    return stored === "accepted" || stored === "declined" ? stored : null;
  } catch {
    return "declined";
  }
}

function getConsentId() {
  const existing = window.localStorage.getItem(ANALYTICS_CONSENT_ID_KEY);
  if (existing) return existing;
  const created = crypto.randomUUID();
  window.localStorage.setItem(ANALYTICS_CONSENT_ID_KEY, created);
  return created;
}

function recordConsent(decision: ConsentDecision, source: "banner" | "settings") {
  try {
    const consentId = getConsentId();
    void fetch("/api/privacy/consent", {
      method: "POST",
      credentials: "same-origin",
      keepalive: true,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ eventId: crypto.randomUUID(), consentId, decision, source, policyVersion: ANALYTICS_POLICY_VERSION }),
    }).catch(() => undefined);
  } catch {
    // Consent still applies locally if storage or the audit endpoint is unavailable.
  }
}

function appendScript(id: string, src: string, configure?: (script: HTMLScriptElement) => void) {
  if (document.getElementById(id)) return;
  const script = document.createElement("script");
  script.id = id;
  script.src = src;
  script.async = true;
  configure?.(script);
  document.head.appendChild(script);
}

function initialiseGoogleAnalytics(measurementId: string) {
  window.dataLayer = window.dataLayer || [];
  window.gtag = window.gtag || ((...args: unknown[]) => window.dataLayer?.push(args));
  window.gtag("js", new Date());
  window.gtag("config", measurementId, { send_page_view: false, anonymize_ip: true });
  appendScript("simka-google-analytics", `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(measurementId)}`);
}

function initialiseYandexMetrika(counterId: string) {
  window.ym = window.ym || ((...args: unknown[]) => {
    (window.ym!.a = window.ym!.a || []).push(args);
  });
  window.ym.l = Date.now();
  window.ym(Number(counterId), "init", {
    clickmap: true,
    trackLinks: true,
    accurateTrackBounce: true,
    webvisor: false,
    trackHash: true,
  });
  appendScript("simka-yandex-metrika", "https://mc.yandex.ru/metrika/tag.js");
}

function initialisePlausible(domain: string) {
  window.plausible = window.plausible || ((eventName: string, options?: { props?: Record<string, string | number | boolean> }) => {
    (window.plausible!.q = window.plausible!.q || []).push([eventName, options]);
  });
  const scriptUrl = process.env.NEXT_PUBLIC_PLAUSIBLE_SCRIPT_URL?.trim() || "https://plausible.io/js/script.js";
  appendScript("simka-plausible", scriptUrl, (script) => {
    script.setAttribute("data-domain", domain);
    script.setAttribute("data-api", process.env.NEXT_PUBLIC_PLAUSIBLE_API_URL?.trim() || "https://plausible.io/api/event");
  });
}

export function AnalyticsProvider() {
  const pathname = usePathname();
  const consent = useSyncExternalStore(subscribeToConsent, consentSnapshot, () => "declined");

  useReportWebVitals(useCallback((metric) => {
    trackEvent("web_vital", { metric_name: metric.name, metric_id: metric.id, metric_rating: metric.rating, value: Math.round(metric.value) });
  }, []));

  useEffect(() => {
    if (consent !== "accepted" || window.__simkaAnalyticsInitialised) return;
    const { gaMeasurementId, yandexMetrikaId, plausibleDomain } = analyticsConfig();
    if (gaMeasurementId) initialiseGoogleAnalytics(gaMeasurementId);
    if (yandexMetrikaId) initialiseYandexMetrika(yandexMetrikaId);
    if (plausibleDomain) initialisePlausible(plausibleDomain);
    window.__simkaAnalyticsInitialised = Boolean(gaMeasurementId || yandexMetrikaId || plausibleDomain);
    if (window.__simkaAnalyticsInitialised) window.dispatchEvent(new Event(ANALYTICS_READY_EVENT));
  }, [consent]);

  useEffect(() => {
    if (consent === "accepted" && pathname) trackPageView(pathname);
  }, [consent, pathname]);

  useEffect(() => {
    if (consent !== "accepted") return;
    const url = new URL(window.location.href);
    const event = url.searchParams.get("analytics");
    if (!event || !["login", "sign_up", "password_reset"].includes(event)) return;
    trackEvent(event, { method: "email" });
    url.searchParams.delete("analytics");
    window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
  }, [consent]);

  useEffect(() => {
    if (consent !== "accepted") return;
    const onClick = (event: MouseEvent) => {
      const anchor = (event.target as Element | null)?.closest("a");
      if (!anchor) return;
      const href = anchor.getAttribute("href") || "";
      if (href.startsWith("mailto:")) trackEvent("contact", { method: "email" });
      else if (href.startsWith("tel:")) trackEvent("contact", { method: "phone" });
      else if (/t\.me|telegram/i.test(href)) trackEvent("contact", { method: "telegram" });
      else if (/wa\.me|whatsapp/i.test(href)) trackEvent("contact", { method: "whatsapp" });
      if (anchor.hasAttribute("download")) trackEvent("file_download", { file_extension: href.split(".").at(-1)?.split(/[?#]/)[0] || "unknown" });
    };
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, [consent]);

  useEffect(() => {
    if (consent !== "accepted") return;
    const onError = () => trackEvent("exception", { fatal: false, error_area: "window" });
    const onUnhandledRejection = () => trackEvent("exception", { fatal: false, error_area: "unhandled_promise" });
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onUnhandledRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onUnhandledRejection);
    };
  }, [consent]);

  const choose = (next: Exclude<Consent, null>) => {
    try { window.localStorage.setItem(ANALYTICS_CONSENT_KEY, next); } catch { return; }
    recordConsent(next, "banner");
    window.dispatchEvent(new Event("simka-consent-change"));
  };

  if (consent !== null) return null;
  return <div role="dialog" aria-label="Настройки аналитики" aria-live="polite" className="fixed inset-x-3 bottom-3 z-[100] mx-auto max-w-2xl rounded-2xl border border-[#cddbea] bg-white p-4 text-[#10213a] shadow-[0_18px_55px_rgba(16,33,58,.2)] sm:bottom-5 sm:flex sm:items-center sm:gap-5 sm:p-5">
    <div className="min-w-0 flex-1"><p className="font-black">Помогите нам улучшать SIMKA</p><p className="mt-1 text-sm leading-5 text-[#637389]">С вашего разрешения мы будем собирать обезличенную статистику посещений и заказов. Персональные и платёжные данные не передаются. <a href="/cookies" className="font-bold text-[#1168e8] hover:underline">Подробнее</a></p></div>
    <div className="mt-4 grid grid-cols-2 gap-2 sm:mt-0 sm:shrink-0"><button type="button" onClick={() => choose("declined")} className="min-h-11 rounded-xl border border-[#cddbea] px-4 text-sm font-bold hover:bg-[#f4f7fa]">Только необходимые</button><button type="button" onClick={() => choose("accepted")} className="min-h-11 rounded-xl bg-[#1168e8] px-4 text-sm font-bold text-white hover:bg-[#0d56c3]">Разрешить</button></div>
  </div>;
}

export function AnalyticsConsentReset() {
  const reset = () => {
    try {
      if (window.localStorage.getItem(ANALYTICS_CONSENT_KEY)) recordConsent("withdrawn", "settings");
      window.localStorage.removeItem(ANALYTICS_CONSENT_KEY);
      for (const key of Object.keys(window.localStorage)) {
        if (key.startsWith("simka-analytics-") && key !== ANALYTICS_CONSENT_ID_KEY) window.localStorage.removeItem(key);
      }
    } catch { /* Storage may be disabled. */ }
    const analyticsCookie = /^(?:_ga|_gid|_gat|_ym_|yandexuid)/;
    for (const cookie of document.cookie.split(";")) {
      const name = cookie.split("=", 1)[0]?.trim();
      if (!name || !analyticsCookie.test(name)) continue;
      document.cookie = `${name}=; Max-Age=0; path=/; SameSite=Lax`;
      document.cookie = `${name}=; Max-Age=0; path=/; domain=${window.location.hostname}; SameSite=Lax`;
    }
    window.location.reload();
  };
  return <button type="button" onClick={reset} className="mt-4 min-h-11 rounded-xl border border-[#cddbea] bg-white px-4 text-sm font-bold text-[#1168e8] hover:bg-[#f4f8fd]">Изменить настройки аналитики</button>;
}
