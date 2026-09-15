"use client";

import { useEffect } from "react";
import { trackEvent } from "@/lib/analytics";

export function ProductAnalytics({
  itemId,
  itemName,
  itemCategory,
  itemVariant,
  price,
  currency,
}: {
  itemId: string;
  itemName: string;
  itemCategory?: string;
  itemVariant?: string;
  price: number;
  currency: string;
}) {
  useEffect(() => {
    trackEvent("view_item", {
      currency,
      value: price,
      items: [{ item_id: itemId, item_name: itemName, item_category: itemCategory, item_variant: itemVariant, price, quantity: 1 }],
    });
  }, [currency, itemCategory, itemId, itemName, itemVariant, price]);

  return null;
}

