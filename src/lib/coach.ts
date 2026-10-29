import type { Activity, FoodEntry, Macros, Profile, Sport } from "./types";
import type { LoadDay } from "./metrics";
import { age } from "./metrics";
import type { Plan, PlannedSession } from "./plan";
import { sessionsOn, weekOf } from "./plan";
import { addDays, round, ymd } from "./format";
import { countsAsPlanned } from "./overrides";

export interface Advice {
  tone: "good" | "caution" | "warn" | "info";
  headline: string;
  detail: string;
}

export interface Compliance {
  plannedMin: number;
  doneMin: number;
  pct: number;
}

export function compliance(plan: Plan | undefined, acts: Activity[], from: string, to: string): Compliance {
  let plannedMin = 0;
  let markedDoneMin = 0;
  const inRange = acts.filter((a) => ymd(a.start) >= from && ymd(a.start) <= to);
  if (plan) {
    for (const w of plan.weeks)
      for (const s of w.sessions) {
        if (s.date < from || s.date > to || !countsAsPlanned(s)) continue;
        plannedMin += s.minutes;
        // ticked "done" without a recorded workout (e.g. swim without a watch): credit the planned time
        if (s.status === "done" && !matchSession({ ...s, status: undefined }, inRange)) markedDoneMin += s.minutes;
      }
  }
  const doneMin = inRange.reduce((m, a) => m + a.movingTime / 60, 0) + markedDoneMin;
  return { plannedMin, doneMin, pct: plannedMin ? (doneMin / plannedMin) * 100 : 0 };
}

/** Does an actual activity on that date satisfy the planned session? */
export function matchSession(s: PlannedSession, acts: Activity[]): Activity | undefined {
  if (s.sport === "rest" || s.status === "skipped") return undefined;
  return acts.find((a) => ymd(a.start) === s.date && (a.sport === s.sport || (s.kind === "race" && a.sport !== "strength")));
}

export function sportSplit(acts: Activity[], from: string, to: string): Record<"swim" | "bike" | "run", number> {
  const r = { swim: 0, bike: 0, run: 0 };
  for (const a of acts) {
    const d = ymd(a.start);
    if (d < from || d > to) continue;
    if (a.sport === "swim" || a.sport === "bike" || a.sport === "run") r[a.sport] += a.movingTime / 3600;
  }
  return r;
}

export function coachAdvice(opts: {
  plan?: Plan;
  acts: Activity[];
  load: LoadDay[];
  profile: Profile;
  today?: string;
  daysSinceSwim?: number;
  readiness?: { score: number; ill?: boolean; notes: string[] };
}): { advice: Advice[]; suggestedNextWeekHours?: number; todayScale: number } {
  const { plan, acts, load, profile, readiness } = opts;
  const today = opts.today ?? ymd();
  const advice: Advice[] = [];
  const last = load[load.length - 1];
  const weekAgo = load[load.length - 8];
  const ctl = last?.ctl ?? 0;
  const atl = last?.atl ?? 0;
  const tsb = ctl - atl;
  const ramp = weekAgo ? ctl - weekAgo.ctl : 0;
  const week = weekOf(plan, today);
  const todays = sessionsOn(plan, today).filter((s) => s.sport !== "rest");
  const keyToday = todays.find((s) => s.key);
  let todayScale = 1;

  if (readiness?.ill) {
    todayScale = 0;
    advice.push({
      tone: "warn",
      headline: "Feeling ill: rest today",
      detail: "Skip training until symptoms are gone. Use Plan → Sick / travel so the plan eases you back in afterwards.",
    });
  } else if (readiness && readiness.score < 40) {
    todayScale = Math.min(todayScale, 0.6);
    advice.push({
      tone: "warn",
      headline: `Low readiness (${readiness.score}/100): go easy`,
      detail: `${readiness.notes.join(" ")} Swap today's key session for 30–45 min Z1–2 or rest.`,
    });
  } else if (readiness && readiness.score < 60) {
    todayScale = Math.min(todayScale, 0.85);
    advice.push({
      tone: "caution",
      headline: `Readiness ${readiness.score}/100: trim today`,
      detail: `${readiness.notes.join(" ")} Do the session but cut 15% of the volume and cap intensity at the bottom of the target range.`,
    });
  } else if (readiness) {
    advice.push({ tone: "good", headline: `Readiness ${readiness.score}/100`, detail: readiness.notes.length ? readiness.notes.join(" ") : "Sleep, energy and soreness all look good." });
  }

  if (!acts.length) {
    advice.push({
      tone: "info",
      headline: "Connect Strava or import workouts",
      detail: "Fitness, fatigue and adaptive suggestions use your recent training. Until then the plan starts from a conservative volume.",
    });
  } else if (tsb < -30) {
    todayScale = 0.5;
    advice.push({
      tone: "warn",
      headline: "High fatigue: back off today",
      detail: `Form is ${round(tsb)} (fatigue ${round(atl)} vs fitness ${round(ctl)}). ${keyToday ? `Swap "${keyToday.title}" for 30–45 min Z1, or rest, ` : "Keep today easy or rest, "}then reassess tomorrow. Below −30 sharply raises injury and illness risk.`,
    });
  } else if (tsb < -10) {
    advice.push({
      tone: "good",
      headline: "In the productive training zone",
      detail: `Form ${round(tsb)}: you're carrying normal training fatigue. Do the plan as written${keyToday ? `, and hit the targets on "${keyToday.title}"` : ""}.`,
    });
  } else if (tsb <= 10) {
    advice.push({
      tone: "good",
      headline: keyToday ? "Fresh: great day for a key session" : "Fresh and ready",
      detail: `Form ${round(tsb)}. ${keyToday ? `Push the quality in "${keyToday.title}".` : "If you feel good you can extend today's aerobic session by 10–20%."}`,
    });
    if (keyToday) todayScale = 1.05;
  } else if (!week || (week.phase !== "taper" && week.phase !== "race")) {
    todayScale = 1.1;
    advice.push({
      tone: "caution",
      headline: "Very fresh: fitness may be slipping",
      detail: `Form +${round(tsb)} outside a taper means load has dropped. Get back to the planned volume; add 10–15 min to easy sessions this week.`,
    });
  } else {
    advice.push({ tone: "good", headline: "Taper is working", detail: `Form +${round(tsb)}: freshness is building for race day. Keep the short race-pace efforts.` });
  }

  if (ramp > 7) {
    advice.push({
      tone: "caution",
      headline: `Fitness ramping fast (+${round(ramp, 1)} CTL/week)`,
      detail: "Sustained ramps above ~5–7 per week are hard to absorb. Make sure the next recovery week really is easy.",
    });
  }

  // Volume compliance over the last 14 days
  const comp = compliance(plan, acts, addDays(today, -14), addDays(today, -1));
  if (plan && comp.plannedMin > 120) {
    if (comp.pct < 65) {
      advice.push({
        tone: "caution",
        headline: `Behind plan: ${Math.round(comp.pct)}% of the last 2 weeks done`,
        detail: "Don't try to make up missed sessions. Prioritise the key sessions (long ride, long run, one quality each) and let easy sessions go if time is short.",
      });
    } else if (comp.pct > 125) {
      advice.push({
        tone: "caution",
        headline: `Over plan: ${Math.round(comp.pct)}% of planned volume`,
        detail: "Extra volume is only useful if you absorb it. Keep easy days truly easy.",
      });
    }
  }

  // Key sessions skipped in the last 7 days
  if (plan) {
    const skippedKeys = plan.weeks.flatMap((w) => w.sessions).filter((s) => s.key && s.status === "skipped" && !s.disrupted && s.date >= addDays(today, -7) && s.date < today);
    if (skippedKeys.length >= 2) {
      advice.push({
        tone: "caution",
        headline: `${skippedKeys.length} key sessions skipped this past week`,
        detail: `${skippedKeys.map((s) => s.title).join(", ")}. If time is the issue, shorten easy sessions instead and protect the long ride, long run and one quality session.`,
      });
    }
  }

  // Swimming gap
  if (plan && opts.daysSinceSwim != null && opts.daysSinceSwim >= 14) {
    advice.push({
      tone: opts.daysSinceSwim >= 42 ? "caution" : "info",
      headline: `No swim logged for ${opts.daysSinceSwim} days`,
      detail: "Swim fitness and feel for the water fade fastest. Short, frequent sessions beat one long one; the comeback block in your plan starts at 25 min. Swimming without a watch? Tick the session done or log it manually.",
    });
  }

  // Discipline balance over 4 weeks (independent of sport mix asked by user: volume based)
  const split = sportSplit(acts, addDays(today, -28), today);
  const tot = split.swim + split.bike + split.run;
  if (plan && tot > 4) {
    const target = plan.spec.split;
    const gaps = (["swim", "bike", "run"] as const)
      .map((s) => ({ s, gap: target[s] - split[s] / tot }))
      .sort((a, b) => b.gap - a.gap);
    if (gaps[0].gap > 0.08) {
      const label = { swim: "swimming", bike: "cycling", run: "running" }[gaps[0].s];
      advice.push({
        tone: "info",
        headline: `Under-trained discipline: ${label}`,
        detail: `${label[0].toUpperCase() + label.slice(1)} is ${Math.round((split[gaps[0].s] / tot) * 100)}% of your last 4 weeks vs ~${Math.round(target[gaps[0].s] * 100)}% for ${plan.spec.label}. Don't skip the planned ${gaps[0].s} sessions.`,
      });
    }
  }

  // Volume-based next-week suggestion (sport-agnostic total hours)
  const last4 = acts.filter((a) => ymd(a.start) > addDays(today, -28) && ymd(a.start) <= today).reduce((s, a) => s + a.movingTime, 0) / 3600 / 4;
  let suggestedNextWeekHours: number | undefined;
  if (acts.length) {
    const factor = tsb < -25 ? 0.7 : tsb < -15 ? 1.0 : tsb > 5 ? 1.1 : 1.07;
    suggestedNextWeekHours = round(Math.min(profile.weeklyHours, Math.max(2, last4 * factor)), 1);
    const nextWeek = weekOf(plan, addDays(today, 7));
    if (nextWeek && Math.abs(nextWeek.targetHours - suggestedNextWeekHours) > 1.5) {
      const more = nextWeek.targetHours > suggestedNextWeekHours;
      advice.push({
        tone: "info",
        headline: `Next week: plan ${nextWeek.targetHours} h, your load suggests ~${suggestedNextWeekHours} h`,
        detail: more
          ? "The plan ramps faster than your recent 4-week volume. Build toward it gradually. Keep the key sessions and trim easy sessions first."
          : "You're handling more than the plan prescribes. Stick to the plan unless form stays above −10 all week.",
      });
    }
  }

  return { advice, suggestedNextWeekHours, todayScale };
}

// ---------- Nutrition ----------

export interface MacroTargets extends Macros {
  bmr: number;
  trainingKcal: number;
  trainingHours: number;
  carbsPerKg: number;
}

export function bmr(p: Profile): number {
  const base = 10 * p.weightKg + 6.25 * p.heightCm - 5 * age(p);
  return Math.round(base + (p.sex === "male" ? 5 : -161));
}

const KCAL_PER_HOUR: Record<Sport, number> = { swim: 550, bike: 600, run: 750, strength: 300, other: 400 };

export function trainingKcal(acts: Activity[], planned: PlannedSession[], profile: Profile): { kcal: number; hours: number } {
  if (acts.length) {
    let kcal = 0;
    let secs = 0;
    for (const a of acts) {
      secs += a.movingTime;
      kcal += a.calories ?? a.kilojoules ?? (KCAL_PER_HOUR[a.sport] * (profile.weightKg / 70) * a.movingTime) / 3600;
    }
    return { kcal: Math.round(kcal), hours: secs / 3600 };
  }
  let kcal = 0;
  let min = 0;
  for (const s of planned) {
    if (s.sport === "rest") continue;
    min += s.minutes;
    kcal += (KCAL_PER_HOUR[s.sport] * (profile.weightKg / 70) * s.minutes) / 60;
  }
  return { kcal: Math.round(kcal), hours: min / 60 };
}

export function macroTargets(p: Profile, acts: Activity[], planned: PlannedSession[], carbLoadGPerKg?: number): MacroTargets {
  const b = bmr(p);
  const { kcal: tk, hours } = trainingKcal(acts, planned, p);
  const carbsPerKg = carbLoadGPerKg ?? (hours < 0.75 ? 4 : hours < 1.5 ? 5.5 : hours < 2.5 ? 7 : hours < 4 ? 8.5 : 10);
  const adj = p.nutritionGoal === "lose" ? -350 : p.nutritionGoal === "gain" ? 300 : 0;
  const calories = Math.round(Math.max(b * 1.35 + tk + adj, carbLoadGPerKg ? p.weightKg * carbLoadGPerKg * 4 + p.weightKg * 1.6 * 4 + p.weightKg * 0.8 * 9 : 0));
  const protein = Math.round(p.weightKg * (p.nutritionGoal === "lose" ? 2.0 : 1.8));
  let carbs = Math.round(p.weightKg * carbsPerKg);
  let fat = Math.round((calories - protein * 4 - carbs * 4) / 9);
  const minFat = Math.round(p.weightKg * 0.8);
  if (fat < minFat) {
    fat = minFat;
    carbs = Math.max(Math.round(p.weightKg * 3), Math.round((calories - protein * 4 - fat * 9) / 4));
  }
  return { calories, protein, carbs, fat, fiber: 30, bmr: b, trainingKcal: tk, trainingHours: hours, carbsPerKg };
}

export function sumMacros(entries: FoodEntry[]): Macros {
  const m = { calories: 0, protein: 0, carbs: 0, fat: 0, fiber: 0 };
  for (const e of entries)
    for (const i of e.items) {
      m.calories += i.calories;
      m.protein += i.protein;
      m.carbs += i.carbs;
      m.fat += i.fat;
      m.fiber += i.fiber ?? 0;
    }
  return m;
}

/** Simple on-the-go fueling guidance for a session. */
export function sessionFueling(minutes: number, kind: PlannedSession["kind"]): string {
  if (minutes < 60) return "Water is enough. Eat normally 2–3 h before.";
  if (minutes < 90) return "30–45 g carbs/h if intense. Fluids to thirst.";
  if (minutes < 150) return "45–60 g carbs/h, 500–750 ml fluid/h with electrolytes.";
  return `${kind === "long" || kind === "race" ? "70–90" : "60–80"} g carbs/h (glucose+fructose), 500–800 ml/h with sodium 500–1000 mg/L. Practise race nutrition.`;
}
