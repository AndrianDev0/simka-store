const DAY_MS = 86_400_000;

export const TELEGRAM_ANALYTICS_PERIODS = [0, 1, 7, 14, 30, 90, 365] as const;

export type AnalyticsDateRange = {
  start: string;
  end: string;
};

export type AnalyticsPeriodBounds = {
  days: number;
  start: string | null;
  end: string;
  previousStart: string | null;
  previousEnd: string | null;
  yearAgoStart: string | null;
  yearAgoEnd: string | null;
};

export function normalizeAnalyticsDays(days: number) {
  return TELEGRAM_ANALYTICS_PERIODS.includes(days as (typeof TELEGRAM_ANALYTICS_PERIODS)[number]) ? days : 7;
}

function daysInUtcMonth(year: number, month: number) {
  return new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
}

export function shiftIsoYear(iso: string, years: number) {
  const value = new Date(iso);
  const targetYear = value.getUTCFullYear() + years;
  const targetDay = Math.min(value.getUTCDate(), daysInUtcMonth(targetYear, value.getUTCMonth()));
  return new Date(Date.UTC(
    targetYear,
    value.getUTCMonth(),
    targetDay,
    value.getUTCHours(),
    value.getUTCMinutes(),
    value.getUTCSeconds(),
    value.getUTCMilliseconds(),
  )).toISOString();
}

export function buildAnalyticsPeriodBounds(days: number, now = new Date(), custom?: AnalyticsDateRange): AnalyticsPeriodBounds {
  const normalizedDays = custom ? 0 : normalizeAnalyticsDays(days);
  const end = custom?.end ?? now.toISOString();
  const start = custom?.start ?? (normalizedDays ? new Date(now.getTime() - normalizedDays * DAY_MS).toISOString() : null);
  if (!start) return { days: normalizedDays, start: null, end, previousStart: null, previousEnd: null, yearAgoStart: null, yearAgoEnd: null };
  const duration = new Date(end).getTime() - new Date(start).getTime() + (custom ? 1 : 0);
  return {
    days: normalizedDays,
    start,
    end,
    previousStart: new Date(new Date(start).getTime() - duration).toISOString(),
    previousEnd: start,
    yearAgoStart: shiftIsoYear(start, -1),
    yearAgoEnd: shiftIsoYear(end, -1),
  };
}

export function parseAnalyticsDateRange(input: string): AnalyticsDateRange | null {
  const parts = input.split("|").map((part) => part.trim());
  const pattern = /^\d{4}-\d{2}-\d{2}$/;
  if (parts.length !== 2 || !pattern.test(parts[0]) || !pattern.test(parts[1])) return null;
  const startDate = new Date(`${parts[0]}T00:00:00.000Z`);
  const endDate = new Date(`${parts[1]}T23:59:59.999Z`);
  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) return null;
  if (startDate.toISOString().slice(0, 10) !== parts[0] || endDate.toISOString().slice(0, 10) !== parts[1]) return null;
  if (startDate > endDate) return null;
  return { start: startDate.toISOString(), end: endDate.toISOString() };
}

export function formatAnalyticsDateRange(range: AnalyticsDateRange) {
  const format = (iso: string) => new Intl.DateTimeFormat("ru-RU", { timeZone: "UTC", day: "2-digit", month: "2-digit", year: "numeric" }).format(new Date(iso));
  return `${format(range.start)}–${format(range.end)}`;
}

export function calendarAnalyticsDateRange(mode: "today" | "yesterday", now = new Date()): AnalyticsDateRange {
  const day = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  if (mode === "yesterday") day.setUTCDate(day.getUTCDate() - 1);
  const date = day.toISOString().slice(0, 10);
  return {
    start: `${date}T00:00:00.000Z`,
    end: `${date}T23:59:59.999Z`,
  };
}
