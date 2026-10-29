import type { Plan } from "./plan";
import { SPORT_META, weekStart, ymd } from "./format";

const esc = (t: string) => t.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");

/** RFC 5545 lines must be folded at 75 octets. */
function fold(line: string): string {
  const bytes = new TextEncoder().encode(line);
  if (bytes.length <= 75) return line;
  const out: string[] = [];
  let cur = "";
  let len = 0;
  for (const ch of line) {
    const n = new TextEncoder().encode(ch).length;
    if (len + n > (out.length ? 74 : 75)) {
      out.push(cur);
      cur = "";
      len = 0;
    }
    cur += ch;
    len += n;
  }
  out.push(cur);
  return out.join("\r\n ");
}

const stamp = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");

/**
 * Calendar of upcoming sessions (from this week to race day). Times are "floating" (no time zone),
 * so they appear at the athlete's usual training time wherever the phone is. Each event has a reminder.
 */
export function planToIcs(plan: Plan, trainingTime = "06:00", reminderMin = 30): string {
  const from = weekStart(ymd());
  const [hh, mm] = trainingTime.split(":").map(Number);
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Ironman Coach//Training Plan//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${esc(`Training: ${plan.event.name || plan.spec.label}`)}`,
  ];
  const now = stamp(new Date());
  for (const w of plan.weeks) {
    for (const s of w.sessions) {
      if (s.date < from || s.sport === "rest" || s.status === "skipped") continue;
      const day = s.date.replace(/-/g, "");
      const start = `${day}T${String(hh).padStart(2, "0")}${String(mm).padStart(2, "0")}00`;
      const icon = s.sport === "other" ? "🏁" : SPORT_META[s.sport].icon;
      const desc = [s.description, s.treadmill].filter(Boolean).join("\n\n");
      lines.push(
        "BEGIN:VEVENT",
        `UID:${s.uid.replace(/\|/g, "-")}@ironman-coach`,
        `DTSTAMP:${now}`,
        `DTSTART:${start}`,
        `DURATION:PT${Math.max(15, s.minutes)}M`,
        `SUMMARY:${esc(`${icon} ${s.title}${s.minutes ? ` (${s.minutes} min)` : ""}`)}`,
        `DESCRIPTION:${esc(desc)}`,
        "BEGIN:VALARM",
        "ACTION:DISPLAY",
        `DESCRIPTION:${esc(s.title)}`,
        `TRIGGER:-PT${reminderMin}M`,
        "END:VALARM",
        "END:VEVENT",
      );
    }
  }
  lines.push("END:VCALENDAR");
  return lines.map(fold).join("\r\n") + "\r\n";
}
