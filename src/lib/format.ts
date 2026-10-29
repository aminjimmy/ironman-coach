import type { Sport } from "./types";

export const DAY_MS = 86_400_000;

/** Local calendar date as YYYY-MM-DD. */
export function ymd(d: Date | number | string = new Date()): string {
  const x = new Date(d);
  const m = String(x.getMonth() + 1).padStart(2, "0");
  const day = String(x.getDate()).padStart(2, "0");
  return `${x.getFullYear()}-${m}-${day}`;
}

/** Parse YYYY-MM-DD as a local-midnight Date. */
export function parseYmd(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function addDays(s: string, n: number): string {
  const d = parseYmd(s);
  d.setDate(d.getDate() + n);
  return ymd(d);
}

export function daysBetween(a: string, b: string): number {
  return Math.round((parseYmd(b).getTime() - parseYmd(a).getTime()) / DAY_MS);
}

/** Monday of the week containing the date (Mon = 0 index). */
export function weekStart(s: string): string {
  const d = parseYmd(s);
  const dow = (d.getDay() + 6) % 7;
  return addDays(s, -dow);
}

export function dayIndex(s: string): number {
  return (parseYmd(s).getDay() + 6) % 7;
}

export const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
export const DAY_NAMES_LONG = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

export function fmtDate(s: string, opts: Intl.DateTimeFormatOptions = { day: "numeric", month: "short" }): string {
  return parseYmd(s).toLocaleDateString(undefined, opts);
}

export function fmtDuration(sec: number): string {
  if (!isFinite(sec) || sec <= 0) return "0:00";
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.round(sec % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function fmtHours(sec: number): string {
  const h = sec / 3600;
  if (h < 1) return `${Math.round(sec / 60)}m`;
  const whole = Math.floor(h);
  const m = Math.round((h - whole) * 60);
  return m ? `${whole}h${String(m).padStart(2, "0")}` : `${whole}h`;
}

/** Pace in s/km -> "m:ss". */
export function fmtPace(secPerKm?: number): string {
  if (!secPerKm || !isFinite(secPerKm) || secPerKm <= 0) return "–";
  const m = Math.floor(secPerKm / 60);
  const s = Math.round(secPerKm % 60);
  return s === 60 ? `${m + 1}:00` : `${m}:${String(s).padStart(2, "0")}`;
}

export function paceFromSpeed(mps?: number): number | undefined {
  return mps && mps > 0 ? 1000 / mps : undefined;
}

/** Speed (m/s) formatted for the sport: run -> /km pace, swim -> /100m, bike -> km/h. */
export function fmtSpeedForSport(sport: Sport, mps?: number): string {
  if (!mps || mps <= 0) return "–";
  if (sport === "run") return `${fmtPace(1000 / mps)} /km`;
  if (sport === "swim") return `${fmtPace(100 / mps)} /100m`;
  return `${(mps * 3.6).toFixed(1)} km/h`;
}

export function fmtDistance(m: number, sport?: Sport): string {
  if (sport === "swim" || m < 1000) return `${Math.round(m).toLocaleString()} m`;
  return `${(m / 1000).toFixed(m >= 100_000 ? 0 : 1)} km`;
}

/** "5:30" or "5:30.5" -> seconds; returns undefined on bad input. */
export function parseMinSec(s: string): number | undefined {
  const t = s.trim();
  if (!t) return undefined;
  const parts = t.split(":").map(Number);
  if (parts.some((p) => !isFinite(p))) return undefined;
  if (parts.length === 1) return parts[0] * 60;
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return parts[0] * 3600 + parts[1] * 60 + parts[2];
}

export function uid(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

export const SPORT_META: Record<Sport, { label: string; color: string; icon: string }> = {
  swim: { label: "Swim", color: "#3987e5", icon: "🏊" },
  bike: { label: "Bike", color: "#c98500", icon: "🚴" },
  run: { label: "Run", color: "#d55181", icon: "🏃" },
  strength: { label: "Strength", color: "#9085e9", icon: "🏋️" },
  other: { label: "Other", color: "#8a96a8", icon: "⚡" },
};

export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
export const round = (v: number, dp = 0) => Math.round(v * 10 ** dp) / 10 ** dp;
