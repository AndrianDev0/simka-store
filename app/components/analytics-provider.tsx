"use client";

import { useEffect, useSyncExternalStore } from "react";
import { usePathname } from "next/navigation";
import { analyticsConfig, trackEvent, trackPageView } from "@/lib/analytics";

const CONSENT_KEY = "simka-analytics-consent";
type Consent = "accepted" | "declined" | null;

function subscribeToConsent(callback: () => void) {
  window.addEventListener("storage", callback);
  window.addEventListener("simka-consent-change", callback);
  return () => {
    window.removeEventListener("storage", callback);
    window.removeEventListener("simka-consent-change", callback);
  };
}

function consentSnapshot(): Consent {
  const stored = window.localStorage.getItem(CONSENT_KEY);
  return stored === "accepted" || stored === "declined" ? stored : null;
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

  useEffect(() => {
    if (consent !== "accepted" || window.__simkaAnalyticsInitialised) return;
    const { gaMeasurementId, yandexMetrikaId, plausibleDomain } = analyticsConfig();
    if (gaMeasurementId) initialiseGoogleAnalytics(gaMeasurementId);
    if (yandexMetrikaId) initialiseYandexMetrika(yandexMetrikaId);
    if (plausibleDomain) initialisePlausible(plausibleDomain);
    window.__simkaAnalyticsInitialised = Boolean(gaMeasurementId || yandexMetrikaId || plausibleDomain);
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
    const report = (name: string, value: number) => {
      if (!Number.isFinite(value) || value < 0) return;
      window.gtag?.("event", "web_vital", { metric_name: name, value: Math.round(value), non_interaction: true });
    };
    const navigation = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
    if (navigation) report("TTFB", navigation.responseStart);
    let lcp = 0;
    let cls = 0;
    let inp = 0;
    const observers: PerformanceObserver[] = [];
    const observe = (type: string, callback: PerformanceObserverCallback) => {
      try {
        const observer = new PerformanceObserver(callback);
        observer.observe({ type, buffered: true });
        observers.push(observer);
      } catch { /* Unsupported browser metric. */ }
    };
    observe("largest-contentful-paint", (list) => { lcp = list.getEntries().at(-1)?.startTime ?? lcp; });
    observe("layout-shift", (list) => {
      for (const entry of list.getEntries() as Array<PerformanceEntry & { value?: number; hadRecentInput?: boolean }>) {
        if (!entry.hadRecentInput) cls += entry.value ?? 0;
      }
    });
    observe("event", (list) => {
      for (const entry of list.getEntries()) inp = Math.max(inp, entry.duration);
    });
    const flush = () => {
      report("LCP", lcp);
      report("CLS", cls * 1000);
      report("INP", inp);
    };
    window.addEventListener("pagehide", flush, { once: true });
    return () => {
      flush();
      observers.forEach((observer) => observer.disconnect());
      window.removeEventListener("pagehide", flush);
    };
  }, [consent]);

  const choose = (next: Exclude<Consent, null>) => {
    window.localStorage.setItem(CONSENT_KEY, next);
    window.dispatchEvent(new Event("simka-consent-change"));
  };

  if (consent !== null) return null;
  return <div role="dialog" aria-label="Настройки аналитики" aria-live="polite" className="fixed inset-x-3 bottom-3 z-[100] mx-auto max-w-2xl rounded-2xl border border-[#cddbea] bg-white p-4 text-[#10213a] shadow-[0_18px_55px_rgba(16,33,58,.2)] sm:bottom-5 sm:flex sm:items-center sm:gap-5 sm:p-5">
    <div className="min-w-0 flex-1"><p className="font-black">Помогите нам улучшать SIMKA</p><p className="mt-1 text-sm leading-5 text-[#637389]">С вашего разрешения мы будем собирать обезличенную статистику посещений и заказов. Персональные и платёжные данные не передаются. <a href="/cookies" className="font-bold text-[#1168e8] hover:underline">Подробнее</a></p></div>
    <div className="mt-4 grid grid-cols-2 gap-2 sm:mt-0 sm:shrink-0"><button type="button" onClick={() => choose("declined")} className="min-h-11 rounded-xl border border-[#cddbea] px-4 text-sm font-bold hover:bg-[#f4f7fa]">Только необходимые</button><button type="button" onClick={() => choose("accepted")} className="min-h-11 rounded-xl bg-[#1168e8] px-4 text-sm font-bold text-white hover:bg-[#0d56c3]">Разрешить</button></div>
  </div>;
}

export function AnalyticsConsentReset() {
  return <button type="button" onClick={() => { window.localStorage.removeItem(CONSENT_KEY); window.location.reload(); }} className="mt-4 min-h-11 rounded-xl border border-[#cddbea] bg-white px-4 text-sm font-bold text-[#1168e8] hover:bg-[#f4f8fd]">Изменить настройки аналитики</button>;
}
