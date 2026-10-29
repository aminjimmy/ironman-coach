// Sanity checks for plan generation and metrics across very different race gaps.
import { generatePlan, predictRace, EVENTS } from "../src/lib/plan";
import { thresholds, loadSeries } from "../src/lib/metrics";
import { coachAdvice, macroTargets } from "../src/lib/coach";
import { demoActivities } from "../src/lib/demo";
import { addDays, ymd, fmtDuration } from "../src/lib/format";
import type { Profile, EventType } from "../src/lib/types";

const profile: Profile = { name: "T", sex: "male", birthYear: 1990, heightCm: 175, weightKg: 72, weeklyHours: 14, experience: "intermediate", restDay: 0, nutritionGoal: "maintain" };
const acts = demoActivities();
const t = thresholds(profile, acts);
console.log("thresholds", { ftp: t.ftp, runPace: t.runPace, css: t.swimCss, lthr: t.lthr, maxHr: t.maxHr });
let fails = 0;
const check = (cond: boolean, msg: string) => { if (!cond) { fails++; console.log("  FAIL:", msg); } };

for (const type of ["full", "half", "olympic", "sprint"] as EventType[]) {
  for (const weeks of [0, 1, 3, 6, 12, 20, 30, 52, 80]) {
    const start = ymd();
    const date = addDays(start, weeks * 7 + 3);
    const plan = generatePlan({ event: { id: "x", name: "", type, date, trainingStart: start }, profile, t, currentWeeklyHours: 6 });
    const hrs = plan.weeks.map((w) => w.targetHours);
    const phases = plan.weeks.map((w) => w.phase[0]).join("");
    const sessions = plan.weeks.flatMap((w) => w.sessions);
    console.log(`${type.padEnd(7)} ${String(weeks).padStart(2)}wk -> ${plan.weeks.length} weeks [${phases}] hrs ${Math.min(...hrs)}..${Math.max(...hrs)} sessions ${sessions.length}`);
    check(plan.weeks.length >= 1, "has weeks");
    check(plan.weeks.at(-1)!.phase === "race", "ends with race week");
    check(sessions.some((s) => s.kind === "race" && s.date === date), "race day session on race date");
    check(sessions.every((s) => s.date >= start), "no sessions before start");
    check(sessions.every((s) => Number.isFinite(s.minutes) && s.minutes >= 0), "finite minutes");
    for (let i = 2; i < plan.weeks.length; i++) {
      const a = plan.weeks[i - 1], b = plan.weeks[i];
      if (!a.recovery && !b.recovery && ["base", "build", "peak"].includes(b.phase) && ["base", "build", "peak"].includes(a.phase))
        check(b.targetHours <= a.targetHours * 1.12 + 0.25, `ramp ${a.targetHours}->${b.targetHours} at week ${i}`);
    }
    for (const w of plan.weeks.filter((w) => w.phase !== "race" && w.sessions.length > 3)) {
      // targetHours is the sum of kept sessions for a partial first week; others must match the target
      const sum = w.sessions.reduce((m, s) => m + s.minutes, 0) / 60;
      check(Math.abs(sum - w.targetHours) <= Math.max(1.5, w.targetHours * 0.2), `week ${w.index} sessions ${sum.toFixed(1)}h vs target ${w.targetHours}h`);
    }
  }
  const p = predictRace(t, EVENTS[type], 72);
  console.log(`  predicted ${type}: ${fmtDuration(p.total)} (swim ${fmtDuration(p.swim)} bike ${fmtDuration(p.bike)} run ${fmtDuration(p.run)})`);
}
const load = loadSeries(acts, t);
const last = load.at(-1)!;
console.log("load", { ctl: last.ctl.toFixed(1), atl: last.atl.toFixed(1), tsb: (last.ctl - last.atl).toFixed(1) });
const plan = generatePlan({ event: { id: "x", name: "", type: "full", date: addDays(ymd(), 200), trainingStart: addDays(ymd(), -60) }, profile, t, currentWeeklyHours: 7 });
const adv = coachAdvice({ plan, acts, load, profile });
adv.advice.forEach((a) => console.log(" advice:", a.tone, a.headline));
console.log("macros rest day", macroTargets(profile, [], []));
console.log(fails ? `${fails} FAILURES` : "ALL CHECKS PASSED");
process.exit(fails ? 1 : 0);
