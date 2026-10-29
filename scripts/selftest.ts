import "fake-indexeddb/auto"; // the app store persists to IndexedDB
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
// Data quality: the athlete's real swims (km/h from Strava), two of which have length-counting errors
{
  const { qualityFlags } = await import("../src/lib/quality");
  const { estimateCss } = await import("../src/lib/metrics");
  const swims: [string, number, number, number][] = [
    ["2026-08-09", 1.6127, 1968.8, 4395], ["2026-07-29", 4.3805, 1650, 1356], ["2026-07-27", 1.3344, 671.3, 1811],
    ["2026-07-25", 1.728, 124.8, 260], ["2026-06-15", 2.2465, 1200, 1923], ["2026-05-18", 2.9851, 2000, 2412],
    ["2026-03-23", 2.091, 600, 1033], ["2026-02-17", 5.0, 450, 324], ["2026-01-03", 2.3489, 950, 1456], ["2025-11-20", 3.3482, 1250, 1344],
  ];
  const acts = swims.map(([d, kmh, dist, mt], i) => ({ id: `s${i}`, source: "strava" as const, sport: "swim" as const, rawType: "Swim", name: "Swim", start: `${d}T08:00:00`, movingTime: mt, elapsedTime: mt, distance: dist, avgSpeed: kmh / 3.6 }));
  const flags = qualityFlags(acts);
  console.log("swim flags:", [...flags.entries()].map(([id, r]) => `${id}: ${r}`));
  check(flags.has("s1") && flags.has("s7"), "flags the 1:22 and 1:12 /100m swims");
  check(flags.size === 2, "does not flag normal swims");
  const t2 = thresholds(profile, acts);
  console.log("CSS estimate (s/100m):", t2.swimCss, "raw max-based would be", estimateCss(acts));
  check(t2.swimCss > 100, "CSS estimate no longer driven by bad swims");
}
// Comeback swims, tests, uids, Zwift steps, overrides, calendar
{
  const { bikeSteps, stepsDuration, toZwo } = await import("../src/lib/workouts");
  const { applyOverrides } = await import("../src/lib/overrides");
  const { planToIcs } = await import("../src/lib/calendar");
  const fs = await import("node:fs");
  const start = ymd();
  const ev = { id: "e", name: "IM Test", type: "full" as const, date: addDays(start, 7 * 24), trainingStart: start };
  const plan = generatePlan({ event: ev, profile, t, currentWeeklyHours: 4, daysSinceSwim: 81 });
  const swims = (i: number) => plan.weeks[i].sessions.filter((x) => x.sport === "swim");
  check(swims(1).every((x) => x.title.startsWith("Swim comeback")) && swims(1).every((x) => x.minutes <= 30), "comeback swims capped in week 2");
  check(swims(4).some((x) => x.test === "css"), "CSS test right after the comeback block");
  check(plan.weeks[1].sessions.some((x) => x.test === "ftp") && plan.weeks[1].sessions.some((x) => x.test === "run"), "FTP + run tests in week 2");
  const testWeeks = plan.weeks.filter((w) => w.sessions.some((x) => x.test === "ftp")).map((w) => w.index);
  console.log("test weeks:", testWeeks.join(","), "| warnings:", plan.warnings.join(" / "));
  const all = plan.weeks.flatMap((w) => w.sessions);
  check(new Set(all.map((x) => x.uid)).size === all.length, "session uids unique");
  check(all.filter((x) => x.sport === "run").every((x) => !!x.treadmill), "every run has treadmill guidance");
  let zwoOk = true;
  for (const x of all.filter((x) => x.sport === "bike")) {
    const st = bikeSteps(x, plan.spec.bikeIf)!;
    const diff = Math.abs(stepsDuration(st) - x.minutes * 60);
    if (diff > 120) { zwoOk = false; console.log("  step duration mismatch", x.title, x.minutes, stepsDuration(st) / 60); }
  }
  check(zwoOk, "Zwift step durations match planned minutes");
  const sample = all.filter((x) => x.sport === "bike" && x.kind !== "long").slice(0, 3).concat(all.filter((x) => x.test === "ftp").slice(0, 1), all.filter((x) => x.kind === "long" && x.sport === "bike").slice(-2));
  fs.mkdirSync("/tmp/claude-0/-home-user/830b6425-ed98-5e65-a5c2-a2339e6be2ae/scratchpad/zwo", { recursive: true });
  for (const x of sample) fs.writeFileSync(`/tmp/claude-0/-home-user/830b6425-ed98-5e65-a5c2-a2339e6be2ae/scratchpad/zwo/${x.uid.replace(/\|/g, "_")}.zwo`, toZwo(x, bikeSteps(x, plan.spec.bikeIf)!));

  const w1 = plan.weeks[1];
  const bikeQ = w1.sessions.find((x) => x.sport === "bike" && x.kind === "test")!;
  const longRun = w1.sessions.find((x) => x.kind === "long" && x.sport === "run")!;
  const moved = applyOverrides(plan, { [bikeQ.uid]: { movedTo: addDays(bikeQ.date, 1), updatedAt: 1 }, [longRun.uid]: { status: "skipped", updatedAt: 1 } }, [
    { id: "d", type: "sick", from: plan.weeks[2].start, to: addDays(plan.weeks[2].start, 2) },
  ])!;
  const mv = moved.weeks[1].sessions.find((x) => x.uid === bikeQ.uid)!;
  check(mv.date === addDays(bikeQ.date, 1) && mv.originalDate === bikeQ.date, "session moved to next day");
  check(moved.weeks[1].sessions.find((x) => x.uid === longRun.uid)!.status === "skipped", "skip mark applied");
  const sickWeek = moved.weeks[2].sessions;
  check(sickWeek.filter((x) => x.date <= addDays(plan.weeks[2].start, 2) && x.sport !== "rest").every((x) => x.disrupted === "sick" && x.status === "skipped"), "sick days skipped");
  check(sickWeek.some((x) => x.title.startsWith("Easy return")), "easy return after illness");

  const ics = planToIcs(plan, "06:15");
  const events = (ics.match(/BEGIN:VEVENT/g) ?? []).length;
  const longest = Math.max(...ics.split("\r\n").map((l) => new TextEncoder().encode(l).length));
  console.log(`ics: ${events} events, longest line ${longest} octets`);
  check(events > 50 && longest <= 75 && ics.includes("DTSTART:") && ics.includes("T061500"), "calendar file valid");
  fs.writeFileSync("/tmp/claude-0/-home-user/830b6425-ed98-5e65-a5c2-a2339e6be2ae/scratchpad/plan.ics", ics);
}
// Heat, race plan, readiness, cloud crypto + merge
{
  const { heatAdjustPct, dewPoint, sweatRate } = await import("../src/lib/heat");
  const { buildRacePlan } = await import("../src/lib/raceplan");
  const { readiness } = await import("../src/lib/readiness");
  const { encrypt, decrypt, mergeData } = await import("../src/lib/cloud");
  const { EVENTS } = await import("../src/lib/plan");
  const { DEFAULT_RACE_PREFS } = await import("../src/lib/store");
  const kl = heatAdjustPct(30, 75);
  console.log(`heat 30°C/75%: dew ${dewPoint(30, 75).toFixed(1)}°C -> +${kl.toFixed(1)}% ; 15°C/50%: +${heatAdjustPct(15, 50).toFixed(1)}%`);
  check(kl > 5 && kl < 9 && heatAdjustPct(15, 50) === 0, "heat adjustment sensible");
  check(Math.abs(sweatRate({ id: "x", date: "2026-10-01", sport: "run", minutes: 60, preKg: 70, postKg: 69, drankMl: 500, urineMl: 0 }) - 1.5) < 0.01, "sweat rate formula");
  const rp = buildRacePlan(EVENTS.full, t, 72, DEFAULT_RACE_PREFS, 1.2);
  console.log(`race plan full: ${fmtDuration(rp.total)} bike ${Math.round(rp.bike.power)}W fuel stops ${rp.bike.fuel.length}/${rp.run.fuel.length} carbs ${rp.carbsTotal}g fluid ${Math.round(rp.fluidLph * 1000)}ml/h`);
  const bikeH = rp.bike.time / 3600;
  check(rp.carbsTotal > bikeH * 60 && rp.bike.fuel.length > 10, "bike fueling hits carb target");
  check(rp.run.walkStrategy !== undefined && rp.heatPct > 5, "heat + walk strategy in hot full-distance plan");
  const hist: Record<string, any> = {};
  for (let i = 1; i <= 10; i++) hist[addDays("2026-10-20", -i)] = { date: addDays("2026-10-20", -i), sleepHours: 7.5, sleepQuality: 4, soreness: 2, energy: 4, stress: 2, restingHr: 52, updatedAt: 1 };
  const good = readiness({ date: "2026-10-20", sleepHours: 8, sleepQuality: 4, soreness: 2, energy: 4, stress: 2, restingHr: 52, updatedAt: 1 }, hist)!;
  const bad = readiness({ date: "2026-10-20", sleepHours: 5, sleepQuality: 2, soreness: 4, energy: 2, stress: 4, restingHr: 61, updatedAt: 1 }, hist)!;
  console.log(`readiness good ${good.score}, bad ${bad.score}: ${bad.notes.join(" ")}`);
  check(good.score >= 75 && bad.score < 40, "readiness separates good and bad days");

  const base = { profile: null, weights: [], events: [], activeEventId: null, activities: [], foods: [], foodFavorites: [], water: {}, sessionMarks: {}, disruptions: [], checkins: {}, sweatTests: [], racePrefs: DEFAULT_RACE_PREFS, tombstones: {}, modifiedAt: 0 };
  const phone = { ...base, modifiedAt: 200, foods: [{ id: "f1", date: "2026-10-20", time: "08:00", meal: "breakfast" as const, title: "Oats", items: [], updatedAt: 200 }], sessionMarks: { a: { status: "done" as const, updatedAt: 150 } } };
  const tablet = { ...base, modifiedAt: 300, foods: [{ id: "f2", date: "2026-10-20", time: "13:00", meal: "lunch" as const, title: "Nasi lemak", items: [], updatedAt: 300 }], sessionMarks: { a: { status: "skipped" as const, updatedAt: 100 } }, tombstones: { f9: 250 } };
  const m = mergeData(phone, tablet);
  check(m.foods.length === 2 && m.sessionMarks.a.status === "done" && m.modifiedAt === 300, "merge keeps both devices' meals and newest mark");
  const deleted = mergeData({ ...phone, foods: [...phone.foods, { id: "f9", date: "2026-10-19", time: "", meal: "snack" as const, title: "x", items: [], updatedAt: 100 }] }, tablet);
  check(!deleted.foods.some((f) => f.id === "f9"), "deletions propagate via tombstones");
  const enc = await encrypt(m, "correct horse battery");
  check(!enc.includes("Nasi lemak"), "backup is encrypted");
  const dec = await decrypt<typeof m>(enc, "correct horse battery");
  check(dec.foods.length === 2, "backup decrypts with the passphrase");
  let wrongFails = false;
  try { await decrypt(enc, "wrong pass"); } catch { wrongFails = true; }
  check(wrongFails, "wrong passphrase is rejected");
}
console.log(fails ? `${fails} FAILURES` : "ALL CHECKS PASSED");
process.exit(fails ? 1 : 0);
