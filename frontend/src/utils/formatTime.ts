const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}/;
const TIME_ONLY = /^\d{1,2}:\d{2}(\s*(AM|PM))?$/i;
const HAS_ZONE = /(Z|[+-]\d{2}:?\d{2})$/i;

/**
 * Formats a timestamp in Asia/Kuala_Lumpur time with Gmail / Outlook relative date logic.
 * E.g.:
 * - Today: "Today, 3:25 AM"
 * - Yesterday: "Yesterday, 10:45 PM"
 * - Same Year: "21 Sep, 12:40 PM"
 * - Older: "21 Sep 2025"
 */
export function formatMalaysiaTime(value: string, style: "full" | "compact" = "full"): string {
  if (!value) return "";

  // If already a time-only format like "9:00 AM" or "10:07", treat as today's message
  if (TIME_ONLY.test(value.trim())) {
    if (style === "compact") return `Today, ${value.trim()}`;
    return `Today at ${value.trim()} MYT`;
  }

  if (!ISO_TIMESTAMP.test(value)) return value;

  const normalized = value.replace(" ", "T");
  const date = new Date(HAS_ZONE.test(normalized) ? normalized : `${normalized}Z`);
  if (Number.isNaN(date.getTime())) return value;

  // Formatter for calendar date comparison in Asia/Kuala_Lumpur ("YYYY-MM-DD")
  const caFormatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kuala_Lumpur",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });

  const todayStr = caFormatter.format(new Date());
  const targetDateStr = caFormatter.format(date);

  const todayMidnight = new Date(`${todayStr}T00:00:00Z`).getTime();
  const targetMidnight = new Date(`${targetDateStr}T00:00:00Z`).getTime();
  const diffDays = Math.round((todayMidnight - targetMidnight) / (24 * 60 * 60 * 1000));

  // Time & date components in Asia/Kuala_Lumpur
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Kuala_Lumpur",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).formatToParts(date);
  const part = (type: string) => parts.find((p) => p.type === type)?.value ?? "";

  const clock = `${part("hour")}:${part("minute")} ${part("dayPeriod")}`;

  if (style === "compact") {
    if (diffDays === 0) return `Today, ${clock}`;
    if (diffDays === 1) return `Yesterday, ${clock}`;
    const nowYear = todayStr.slice(0, 4);
    const targetYear = targetDateStr.slice(0, 4);
    if (nowYear === targetYear) {
      return `${part("day")} ${part("month")}, ${clock}`;
    }
    return `${part("day")} ${part("month")} ${part("year")}`;
  }

  // style === "full"
  if (diffDays === 0) return `Today at ${clock} MYT`;
  if (diffDays === 1) return `Yesterday at ${clock} MYT`;
  return `${part("day")} ${part("month")} ${part("year")}, ${clock} MYT`;
}
