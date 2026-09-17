type VisitorReference = { clientId: string };
type ConsentReference = { consentId: string };
type OrderReference = { firstPartyClientId: string | null };

export function collectAccountAnalyticsClientIds(
  visitors: VisitorReference[],
  consents: ConsentReference[],
  orders: OrderReference[],
) {
  return [...new Set([
    ...visitors.map((visitor) => visitor.clientId),
    ...consents.map((consent) => consent.consentId),
    ...orders.flatMap((order) => order.firstPartyClientId ? [order.firstPartyClientId] : []),
  ])];
}
