import type { Checkin } from "./types";
import { addDays, clamp } from "./format";

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : undefined;
};

export interface Readiness {
  score: number;
  ill?: boolean;
  notes: string[];
}

/** 0–100 readiness from the morning check-in, compared with the athlete's own 14-day baselines. */
export function readiness(c: Checkin | undefined, history: Record<string, Checkin>, tsb?: number): Readiness | undefined {
  if (!c) return undefined;
  const notes: string[] = [];
  let score = 100;
  if (c.sleepHours < 6) { score -= 20; notes.push(`Only ${c.sleepHours} h sleep.`); }
  else if (c.sleepHours < 7) { score -= 10; notes.push(`${c.sleepHours} h sleep is a bit short.`); }
  score -= (5 - c.sleepQuality) * 4;
  if (c.soreness >= 4) notes.push("Legs are sore.");
  score -= (c.soreness - 1) * 6;
  if (c.energy <= 2) notes.push("Energy is low.");
  score -= (5 - c.energy) * 5;
  if (c.stress >= 4) notes.push("Life stress is high; it counts as training load too.");
  score -= (c.stress - 1) * 4;

  const past = Array.from({ length: 14 }, (_, i) => history[addDays(c.date, -(i + 1))]).filter(Boolean) as Checkin[];
  const rhrBase = median(past.map((p) => p.restingHr).filter((x): x is number => !!x));
  if (c.restingHr && rhrBase) {
    const d = c.restingHr - rhrBase;
    if (d >= 7) { score -= 15; notes.push(`Resting HR is ${d} bpm above your normal ${rhrBase}.`); }
    else if (d >= 4) { score -= 8; notes.push(`Resting HR is ${d} bpm above normal.`); }
  }
  const hrvBase = median(past.map((p) => p.hrv).filter((x): x is number => !!x));
  if (c.hrv && hrvBase && c.hrv < hrvBase * 0.85) { score -= 12; notes.push(`HRV is ${Math.round((1 - c.hrv / hrvBase) * 100)}% below your normal.`); }
  if (tsb != null && tsb < -30) { score -= 10; notes.push("Training fatigue is very high."); }
  if (c.ill) { notes.unshift("You reported feeling ill."); score = Math.min(score, 20); }
  return { score: clamp(Math.round(score), 0, 100), ill: c.ill, notes };
}
