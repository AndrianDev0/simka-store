export const ANALYTICS_POLICY_VERSION = "2026-09-17";

export type AnalyticsConsentSnapshot = {
  decision: "accepted" | "declined" | "withdrawn";
  policyVersion: string;
} | null | undefined;

export function allowsAnalytics(snapshot: AnalyticsConsentSnapshot) {
  return snapshot?.decision === "accepted" && snapshot.policyVersion === ANALYTICS_POLICY_VERSION;
}
