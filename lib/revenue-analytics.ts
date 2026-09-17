export type RevenueOrder = {
  id: string;
  status: string;
  subtotalAmount: number;
  discountAmount: number;
  deliveryAmount: number;
  totalAmount: number;
  currency: string;
  partnerCode: string | null;
  /** Commission rate captured on the order. Null means a legacy order. */
  partnerCommissionBpsSnapshot?: number | null;
  /** Actual costs are nullable until an operator records them. */
  deliveryExpenseAmount?: number | null;
  paymentFeeAmount?: number | null;
  otherExpenseAmount?: number | null;
};

export type RevenueOrderItem = {
  orderId: string;
  unitCost: number | null;
  quantity: number;
};

export type RevenuePartner = { code: string; commissionBps: number };
export type RevenueMarketingCost = { amount: number; currency: string; startsAt: string; endsAt: string };

export type RevenueAnalyticsRow = {
  currency: string;
  orders: number;
  grossRevenue: number;
  discounts: number;
  refunds: number;
  netProductRevenue: number;
  deliveryRevenue: number;
  costOfGoods: number;
  partnerCommission: number;
  marketingCost: number;
  deliveryExpense: number;
  paymentFees: number;
  otherExpenses: number;
  totalExpenses: number;
  profit: number;
  marginPercent: number | null;
  roas: number | null;
  roiPercent: number | null;
  knownCostItems: number;
  totalCostItems: number;
  missingDeliveryExpenseOrders: number;
  missingPaymentFeeOrders: number;
  missingOtherExpenseOrders: number;
  estimatedPartnerCommissionOrders: number;
};

const DAY_MS = 86_400_000;

function utcDateStart(value: string) {
  const parsed = new Date(`${value.slice(0, 10)}T00:00:00.000Z`).getTime();
  return Number.isFinite(parsed) ? parsed : null;
}

export function proratedMarketingCost(cost: RevenueMarketingCost, reportStart: string | null, reportEnd: string | null) {
  const campaignStart = utcDateStart(cost.startsAt);
  const campaignEnd = utcDateStart(cost.endsAt);
  if (campaignStart === null || campaignEnd === null || campaignEnd < campaignStart) return 0;
  const start = reportStart ? Math.max(campaignStart, new Date(reportStart).getTime()) : campaignStart;
  const end = reportEnd ? Math.min(campaignEnd + DAY_MS, new Date(reportEnd).getTime()) : campaignEnd + DAY_MS;
  if (end <= start) return 0;
  const campaignDays = Math.max(1, Math.round((campaignEnd - campaignStart) / DAY_MS) + 1);
  const overlapDays = (end - start) / DAY_MS;
  return Math.round(cost.amount * Math.min(1, overlapDays / campaignDays));
}

export function calculateRevenueAnalytics(
  orders: RevenueOrder[],
  items: RevenueOrderItem[],
  partners: RevenuePartner[],
  marketingCosts: RevenueMarketingCost[],
  reportStart: string | null,
  reportEnd: string | null,
): RevenueAnalyticsRow[] {
  const byCurrency = new Map<string, RevenueAnalyticsRow>();
  const partnerBps = new Map(partners.map((partner) => [partner.code, partner.commissionBps]));
  const itemRows = new Map<string, RevenueOrderItem[]>();
  for (const item of items) itemRows.set(item.orderId, [...(itemRows.get(item.orderId) ?? []), item]);

  const rowFor = (currency: string) => {
    const existing = byCurrency.get(currency);
    if (existing) return existing;
    const row: RevenueAnalyticsRow = {
      currency, orders: 0, grossRevenue: 0, discounts: 0, refunds: 0, netProductRevenue: 0,
      deliveryRevenue: 0, costOfGoods: 0, partnerCommission: 0, marketingCost: 0,
      deliveryExpense: 0, paymentFees: 0, otherExpenses: 0, totalExpenses: 0, profit: 0,
      marginPercent: null, roas: null, roiPercent: null, knownCostItems: 0, totalCostItems: 0,
      missingDeliveryExpenseOrders: 0, missingPaymentFeeOrders: 0, missingOtherExpenseOrders: 0,
      estimatedPartnerCommissionOrders: 0,
    };
    byCurrency.set(currency, row);
    return row;
  };

  for (const order of orders) {
    const row = rowFor(order.currency);
    const refunded = order.status === "REFUNDED";
    row.orders += 1;
    row.grossRevenue += order.subtotalAmount;
    row.discounts += order.discountAmount;
    const discountedProductRevenue = order.subtotalAmount - order.discountAmount;
    if (refunded) row.refunds += discountedProductRevenue;
    else {
      row.netProductRevenue += discountedProductRevenue;
      row.deliveryRevenue += order.deliveryAmount;
      if (order.partnerCode) {
        const snapshot = order.partnerCommissionBpsSnapshot;
        const commissionBps = snapshot === null || snapshot === undefined ? partnerBps.get(order.partnerCode) ?? 0 : snapshot;
        if (snapshot === null || snapshot === undefined) row.estimatedPartnerCommissionOrders += 1;
        row.partnerCommission += Math.round(order.totalAmount * commissionBps / 10_000);
      }
    }
    if (order.deliveryExpenseAmount === null || order.deliveryExpenseAmount === undefined) {
      if (order.deliveryAmount > 0) row.missingDeliveryExpenseOrders += 1;
    } else row.deliveryExpense += Math.max(0, order.deliveryExpenseAmount);
    if (order.paymentFeeAmount === null || order.paymentFeeAmount === undefined) row.missingPaymentFeeOrders += 1;
    else row.paymentFees += Math.max(0, order.paymentFeeAmount);
    if (order.otherExpenseAmount === null || order.otherExpenseAmount === undefined) row.missingOtherExpenseOrders += 1;
    else row.otherExpenses += Math.max(0, order.otherExpenseAmount);
    for (const item of itemRows.get(order.id) ?? []) {
      row.totalCostItems += item.quantity;
      if (item.unitCost !== null) {
        row.knownCostItems += item.quantity;
        row.costOfGoods += item.unitCost * item.quantity;
      }
    }
  }

  for (const cost of marketingCosts) rowFor(cost.currency).marketingCost += proratedMarketingCost(cost, reportStart, reportEnd);

  for (const row of byCurrency.values()) {
    const realizedRevenue = row.netProductRevenue + row.deliveryRevenue;
    row.totalExpenses = row.costOfGoods + row.partnerCommission + row.marketingCost + row.deliveryExpense + row.paymentFees + row.otherExpenses;
    row.profit = realizedRevenue - row.totalExpenses;
    row.marginPercent = realizedRevenue > 0 ? row.profit / realizedRevenue * 100 : null;
    row.roas = row.marketingCost > 0 ? row.netProductRevenue / row.marketingCost : null;
    row.roiPercent = row.marketingCost > 0 ? row.profit / row.marketingCost * 100 : null;
  }
  return [...byCurrency.values()].sort((left, right) => left.currency.localeCompare(right.currency));
}
