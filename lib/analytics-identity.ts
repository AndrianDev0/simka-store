export function shouldRotateAnalyticsClientId(previousBoundary: string | null, currentBoundary: string) {
  if (!previousBoundary || previousBoundary === currentBoundary) return false;
  if (currentBoundary.startsWith("account-switch-")) return true;
  if (currentBoundary.startsWith("account-") && previousBoundary.startsWith("guest")) return false;
  return true;
}
