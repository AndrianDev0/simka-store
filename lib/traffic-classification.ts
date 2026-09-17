export const trafficClasses = ["HUMAN", "SUSPICIOUS", "BOT"] as const;

export type TrafficClass = (typeof trafficClasses)[number];

export type TrafficClassification = {
  trafficClass: TrafficClass;
  reasons: string[];
};

type TrafficClassificationInput = {
  userAgent: string;
  automation?: boolean;
  eventName: string;
  sessionStartedAt: string;
  occurredAt: string;
  priorEventCount: number;
  priorPageViews: number;
  priorClass?: TrafficClass | null;
  priorReasons?: string[] | null;
};

const automatedUserAgent = /(?:bot\b|crawler|spider|headless|phantomjs|selenium|playwright|puppeteer|curl\/|wget\/|python-requests|httpclient|go-http-client)/i;

const classRank: Record<TrafficClass, number> = { HUMAN: 0, SUSPICIOUS: 1, BOT: 2 };

function elapsedMs(startedAt: string, occurredAt: string) {
  const value = new Date(occurredAt).getTime() - new Date(startedAt).getTime();
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

function strongerClass(left: TrafficClass, right: TrafficClass) {
  return classRank[left] >= classRank[right] ? left : right;
}

/**
 * Classifies only durable, non-identifying signals. The classification is
 * monotonic for a session: a later event cannot downgrade a prior warning.
 */
export function classifyTraffic(input: TrafficClassificationInput): TrafficClassification {
  const reasons = new Set((input.priorReasons || []).filter((reason) => /^[a-z_]{1,40}$/.test(reason)));
  let detected: TrafficClass = "HUMAN";
  const userAgent = input.userAgent.trim();
  const elapsed = elapsedMs(input.sessionStartedAt, input.occurredAt);
  const eventCount = Math.max(0, input.priorEventCount) + 1;
  const pageViews = Math.max(0, input.priorPageViews) + (input.eventName === "page_view" ? 1 : 0);

  if (input.automation) {
    detected = "BOT";
    reasons.add("browser_automation");
  } else if (automatedUserAgent.test(userAgent)) {
    detected = "BOT";
    reasons.add("automated_user_agent");
  } else {
    if (!userAgent) {
      detected = "SUSPICIOUS";
      reasons.add("missing_user_agent");
    }
    if (eventCount >= 30 && elapsed < 60_000) {
      detected = strongerClass(detected, "SUSPICIOUS");
      reasons.add("event_burst");
    }
    if (pageViews >= 10 && elapsed < 15_000) {
      detected = strongerClass(detected, "SUSPICIOUS");
      reasons.add("page_view_burst");
    }
  }

  return {
    trafficClass: strongerClass(input.priorClass || "HUMAN", detected),
    reasons: [...reasons].sort(),
  };
}
