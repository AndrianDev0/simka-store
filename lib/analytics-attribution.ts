export type AnalyticsAttribution = {
  source?: string;
  medium?: string;
  campaign?: string;
  content?: string;
  term?: string;
  referrerHost?: string;
};

export type LandingAttribution = {
  attribution: AnalyticsAttribution;
  explicitTouch: boolean;
};

const campaignKeys = ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"] as const;

function bounded(value: string | null, maximum: number) {
  return value?.trim().slice(0, maximum) || undefined;
}

function knownReferrer(host: string) {
  const search = host.match(/(^|\.)(google|bing|yandex)\./)?.[2];
  if (search) return { source: search, medium: "organic" };
  if (/(^|\.)(t\.me|telegram\.me|telegram\.org)$/.test(host)) return { source: "telegram", medium: "social" };
  if (/(^|\.)(facebook\.com|fb\.com)$/.test(host)) return { source: "facebook", medium: "social" };
  if (/(^|\.)instagram\.com$/.test(host)) return { source: "instagram", medium: "social" };
  if (/(^|\.)tiktok\.com$/.test(host)) return { source: "tiktok", medium: "social" };
  if (/(^|\.)(youtube\.com|youtu\.be)$/.test(host)) return { source: "youtube", medium: "social" };
  if (/(^|\.)(x\.com|twitter\.com)$/.test(host)) return { source: "x", medium: "social" };
  if (/(^|\.)reddit\.com$/.test(host)) return { source: "reddit", medium: "social" };
  return { source: host, medium: "referral" };
}

export function resolveLandingAttribution(href: string, referrer: string, siteOrigin: string): LandingAttribution {
  let url: URL;
  try { url = new URL(href); }
  catch { return { attribution: { source: "direct", medium: "none" }, explicitTouch: false }; }

  const hasCampaign = campaignKeys.some((key) => url.searchParams.has(key));
  if (hasCampaign) {
    return {
      attribution: {
        source: bounded(url.searchParams.get("utm_source"), 120),
        medium: bounded(url.searchParams.get("utm_medium"), 120),
        campaign: bounded(url.searchParams.get("utm_campaign"), 160),
        content: bounded(url.searchParams.get("utm_content"), 160),
        term: bounded(url.searchParams.get("utm_term"), 160),
      },
      explicitTouch: true,
    };
  }

  try {
    const referringUrl = referrer ? new URL(referrer) : null;
    if (referringUrl && referringUrl.origin !== siteOrigin) {
      const referrerHost = bounded(referringUrl.hostname.toLowerCase(), 255);
      if (referrerHost) return { attribution: { ...knownReferrer(referrerHost), referrerHost }, explicitTouch: true };
    }
  } catch { /* Invalid referrers are treated as direct traffic. */ }

  return { attribution: { source: "direct", medium: "none" }, explicitTouch: false };
}

export function reusableAnalyticsSession(id: unknown, lastSeen: unknown, now: number, explicitTouch: boolean, timeoutMs: number) {
  return typeof id === "string"
    && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)
    && typeof lastSeen === "number"
    && now - lastSeen <= timeoutMs
    && !explicitTouch;
}
