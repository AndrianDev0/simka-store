"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { analyticsConfig, trackPageView } from "@/lib/analytics";

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

  useEffect(() => {
    if (window.__simkaAnalyticsInitialised) return;
    const { gaMeasurementId, yandexMetrikaId, plausibleDomain } = analyticsConfig();
    if (gaMeasurementId) initialiseGoogleAnalytics(gaMeasurementId);
    if (yandexMetrikaId) initialiseYandexMetrika(yandexMetrikaId);
    if (plausibleDomain) initialisePlausible(plausibleDomain);
    window.__simkaAnalyticsInitialised = Boolean(gaMeasurementId || yandexMetrikaId || plausibleDomain);
  }, []);

  useEffect(() => {
    if (pathname) trackPageView(pathname);
  }, [pathname]);

  return null;
}
