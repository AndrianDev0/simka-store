"use client";

import { useEffect } from "react";
import { trackEvent, trackOnce, trackPurchase, type AnalyticsItem } from "@/lib/analytics";

export function IdentifyAnalyticsUser({ userId }: { userId: string }) {
  useEffect(() => {
    if (!userId) return;
    window.gtag?.("set", { user_id: userId });
  }, [userId]);
  return null;
}

export function SearchAnalytics({ query, results }: { query: string; results: number }) {
  useEffect(() => {
    if (!query) return;
    trackEvent("search", { search_term: query.slice(0, 100), results_count: results, no_results: results === 0 });
  }, [query, results]);
  return null;
}

export function CatalogAnalytics({ filters, items }: { filters: string; items: AnalyticsItem[] }) {
  useEffect(() => {
    trackEvent("view_item_list", { item_list_id: "catalog", item_list_name: "Каталог", items: items.slice(0, 100) });
    if (filters) trackEvent("catalog_filter", { filters: filters.slice(0, 300), results_count: items.length });
  }, [filters, items]);
  return null;
}

export function OrderStatusAnalytics({ orderNumber, status, value, currency, items }: { orderNumber: string; status: string; value: number; currency: string; items: AnalyticsItem[] }) {
  useEffect(() => {
    const params = { transaction_id: orderNumber, value, currency, items };
    if (["PAID", "PROCESSING", "SHIPPED", "DELIVERED", "COMPLETED"].includes(status)) trackPurchase(orderNumber, params);
    if (status === "CANCELLED") trackOnce(`cancel:${orderNumber}`, "order_cancelled", params);
    if (status === "REFUNDED") trackOnce(`refund:${orderNumber}`, "refund", params);
  }, [currency, items, orderNumber, status, value]);
  return null;
}
