import { getPrincipal } from "./identity";

// Legacy name retained for compatibility. Values use principal timezone.
export interface PSTComponents {
  year: number;
  month: string;
  day: string;
  hours: string;
  minutes: string;
  seconds: string;
}

function getTimezone(): string {
  return getPrincipal().timezone || "UTC";
}

function getSafeTimezone(): string {
  const candidate = getTimezone();
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: candidate }).format(new Date());
    return candidate;
  } catch {
    return "UTC";
  }
}

function toParts(date: Date): PSTComponents {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: getSafeTimezone(),
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    hourCycle: "h23",
  });

  const parts = formatter.formatToParts(date);
  const byType = new Map(parts.map((part) => [part.type, part.value]));

  return {
    year: Number(byType.get("year") ?? "1970"),
    month: byType.get("month") ?? "01",
    day: byType.get("day") ?? "01",
    hours: byType.get("hour") ?? "00",
    minutes: byType.get("minute") ?? "00",
    seconds: byType.get("second") ?? "00",
  };
}

function normalizeOffset(timeZoneName: string): string | null {
  const normalized = timeZoneName.trim().replace("−", "-");
  if (!normalized) {
    return null;
  }

  if (normalized === "GMT" || normalized === "UTC") {
    return "+00:00";
  }

  const match = /^(?:GMT|UTC)([+-])(\d{1,2})(?::?(\d{2}))?$/.exec(normalized);
  if (!match) {
    return null;
  }

  const [, sign, hoursRaw, minutesRaw] = match;
  return `${sign}${hoursRaw.padStart(2, "0")}:${(minutesRaw ?? "00").padStart(2, "0")}`;
}

function getOffsetFromParts(date: Date, timeZoneName: "longOffset" | "shortOffset"): string | null {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: getSafeTimezone(),
    timeZoneName,
  });
  const parts = formatter.formatToParts(date);
  const offsetPart = parts.find((part) => part.type === "timeZoneName")?.value;

  return offsetPart ? normalizeOffset(offsetPart) : null;
}

function getOffset(date: Date): string {
  return getOffsetFromParts(date, "longOffset") ?? getOffsetFromParts(date, "shortOffset") ?? "+00:00";
}

export function getPSTComponents(date: Date = new Date()): PSTComponents {
  return toParts(date);
}

export function getISOTimestamp(date: Date = new Date()): string {
  const parts = toParts(date);
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hours}:${parts.minutes}:${parts.seconds}${getOffset(date)}`;
}
