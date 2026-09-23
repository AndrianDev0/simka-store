type VisitorReference = { clientId: string };
type ConsentReference = { consentId: string };
type OrderReference = { firstPartyClientId: string | null };
type OwnershipReference = { clientId: string; accountId: string | null };

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

export function exclusivelyOwnedAnalyticsClientIds(
  accountId: string,
  candidateClientIds: string[],
  ownershipReferences: OwnershipReference[],
) {
  const claimedByAnotherAccount = new Set(ownershipReferences
    .filter((reference) => reference.accountId && reference.accountId !== accountId)
    .map((reference) => reference.clientId));
  return candidateClientIds.filter((clientId) => !claimedByAnotherAccount.has(clientId));
}
