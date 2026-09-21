const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;
const HAS_ZONE = /(Z|[+-]\d{2}:?\d{2})$/i;


export function formatMalaysiaTime(value: string, style: "full" | "compact" = "full"): string {
  if (!ISO_TIMESTAMP.test(value)) return value;


  const date = new Date(HAS_ZONE.test(value) ? value : `${value}Z`);
  if (Number.isNaN(date.getTime())) return value;

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
  //Compact narrow inbox rows: "21 Sep, 12:40 PM".
  if (style === "compact") return `${part("day")} ${part("month")}, ${clock}`;
  return `${part("day")} ${part("month")} ${part("year")}, ${clock} MYT`;
}
