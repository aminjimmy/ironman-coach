import type { Disruption, SessionMark } from "./types";
import type { Plan, PlannedSession } from "./plan";
import { addDays } from "./format";

const inRange = (date: string, d: Disruption) => date >= d.from && date <= d.to;

/**
 * Applies the athlete's own changes to the generated plan:
 * moved sessions, done/skipped marks, and sick/travel periods (with an easy return after illness).
 */
export function applyOverrides(plan: Plan | undefined, marks: Record<string, SessionMark>, disruptions: Disruption[]): Plan | undefined {
  if (!plan) return plan;
  const all: PlannedSession[] = [];
  for (const w of plan.weeks) {
    for (const s of w.sessions) {
      const m = marks[s.uid];
      let out: PlannedSession = { ...s };
      if (m?.movedTo && m.movedTo !== s.date) out = { ...out, date: m.movedTo, originalDate: s.date };
      if (m?.status) out.status = m.status;

      const d = disruptions.find((x) => inRange(out.date, x));
      if (d && out.sport !== "rest" && out.kind !== "race") {
        if (d.type === "sick") {
          out = { ...out, disrupted: "sick", status: out.status ?? "skipped" };
        } else if (out.sport === "run" && out.kind !== "test") {
          out = { ...out, disrupted: "travel", title: "Travel run (optional)", minutes: Math.min(out.minutes, 40), zone: 2, key: false, description: "Easy 20–40 min run where you are (hotel treadmill or around the block). Skip if travel days are long." };
        } else if (out.sport === "strength") {
          out = { ...out, disrupted: "travel", title: "Hotel bodyweight circuit", minutes: 20, description: "3 rounds: 15 squats, 10 push-ups, 10 lunges/leg, 30 s plank, 15 glute bridges." };
        } else {
          out = { ...out, disrupted: "travel", status: out.status ?? "skipped" };
        }
      } else {
        // first 3 days after an illness: shorter and easy only
        const sick = disruptions.find((x) => x.type === "sick" && out.date > x.to && out.date <= addDays(x.to, 3));
        if (sick && out.sport !== "rest" && out.kind !== "race" && !out.status) {
          out = {
            ...out,
            title: `Easy return: ${out.title}`,
            minutes: Math.round((out.minutes * 0.6) / 5) * 5,
            zone: Math.min(out.zone, 2),
            key: false,
            description: `Coming back from illness: keep it Z1–2 and stop if you feel worse. ${out.description}`,
          };
        }
      }
      all.push(out);
    }
  }
  const weeks = plan.weeks.map((w) => {
    const end = addDays(w.start, 6);
    return {
      ...w,
      sessions: all
        .filter((s) => s.date >= w.start && s.date <= end)
        .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0)),
    };
  });
  return { ...plan, weeks };
}

/** Planned minutes that still count toward the week (sick/travel-skipped sessions don't). */
export const countsAsPlanned = (s: PlannedSession) => s.sport !== "rest" && s.kind !== "race" && !(s.disrupted && s.status === "skipped");
