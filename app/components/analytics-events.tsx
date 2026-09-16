"use client";

import { useEffect, useSyncExternalStore } from "react";
import { ANALYTICS_CONSENT_ID_KEY, ANALYTICS_CONSENT_KEY, ANALYTICS_READY_EVENT, trackEvent, trackOnce, trackPurchase, type AnalyticsItem } from "@/lib/analytics";

function subscribeReady(callback: () => void) {
  window.addEventListener(ANALYTICS_READY_EVENT, callback);
  window.addEventListener("simka-consent-change", callback);
  return () => {
    window.removeEventListener(ANALYTICS_READY_EVENT, callback);
    window.removeEventListener("simka-consent-change", callback);
  };
}

function readySnapshot() {
  try { return window.localStorage.getItem(ANALYTICS_CONSENT_KEY) === "accepted" && window.__simkaAnalyticsInitialised === true; }
  catch { return false; }
}

function consentSnapshot() {
  try { return window.localStorage.getItem(ANALYTICS_CONSENT_KEY) === "accepted"; }
  catch { return false; }
}

export function useAnalyticsReady() {
  return useSyncExternalStore(subscribeReady, readySnapshot, () => false);
}

function useAnalyticsConsent() {
  return useSyncExternalStore(subscribeReady, consentSnapshot, () => false);
}

export function IdentifyAnalyticsUser({ userId }: { userId: string }) {
  const ready = useAnalyticsReady();
  useEffect(() => {
    if (!ready || !userId) return;
    window.gtag?.("set", { user_id: userId });
  }, [ready, userId]);
  return null;
}

export function SearchAnalytics({ query, results }: { query: string; results: number }) {
  const ready = useAnalyticsReady();
  const consent = useAnalyticsConsent();
  useEffect(() => {
    if (!ready || !query) return;
    trackEvent("search", { query_length: Math.min(query.length, 100), results_count: results, no_results: results === 0 });
  }, [query, ready, results]);
  useEffect(() => {
    if (!consent || !query) return;
    const consentId = window.localStorage.getItem(ANALYTICS_CONSENT_ID_KEY);
    if (consentId) void fetch("/api/analytics/search", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ consentId, query, results }), keepalive: true });
  }, [consent, query, results]);
  return null;
}

export function CatalogAnalytics({ filters, hasSearch, items, totalResults }: { filters: string; hasSearch: boolean; items: AnalyticsItem[]; totalResults?: number }) {
  const ready = useAnalyticsReady();
  useEffect(() => {
    if (!ready) return;
    trackEvent("view_item_list", { item_list_id: "catalog", item_list_name: "Каталог", items: items.slice(0, 100) });
    if (filters || hasSearch) trackEvent("catalog_filter", { filters: filters.slice(0, 300), has_search: hasSearch, results_count: totalResults ?? items.length });
  }, [filters, hasSearch, items, ready, totalResults]);
  return null;
}

export function OrderStatusAnalytics({ orderNumber, status, value, currency, items, serverTracked = false }: { orderNumber: string; status: string; value: number; currency: string; items: AnalyticsItem[]; serverTracked?: boolean }) {
  const ready = useAnalyticsReady();
  useEffect(() => {
    if (!ready) return;
    const params = { transaction_id: orderNumber, value, currency, items };
    if (!serverTracked && ["PAID", "PROCESSING", "SHIPPED", "DELIVERED", "COMPLETED"].includes(status)) trackPurchase(orderNumber, params);
    if (!serverTracked && status === "CANCELLED") trackOnce(`cancel:${orderNumber}`, "order_cancelled", params);
    if (!serverTracked && status === "REFUNDED") trackOnce(`refund:${orderNumber}`, "refund", params);
  }, [currency, items, orderNumber, ready, serverTracked, status, value]);
  return null;
}
