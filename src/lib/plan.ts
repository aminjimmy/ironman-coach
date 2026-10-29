import type { EventType, Profile, RaceEvent, Sport } from "./types";
import type { Thresholds } from "./metrics";
import { hrZones, runZones, swimZones, zoneRangeLabel, age } from "./metrics";
import { addDays, clamp, daysBetween, fmtDuration, fmtPace, ymd, weekStart } from "./format";

export interface EventSpec {
  label: string;
  swimKm: number;
  bikeKm: number;
  runKm: number;
  peakHours: Record<Profile["experience"], number>;
  recommendedWeeks: number;
  taperWeeks: number;
  split: { swim: number; bike: number; run: number };
  longBikeMax: number; // minutes
  longRunMax: number;
  targetCtl: [number, number];
  bikeIf: number; // race intensity factor
  runFrac: number; // race speed as fraction of threshold speed
  swimFrac: number;
  transitions: number; // minutes
}

export const EVENTS: Record<EventType, EventSpec> = {
  full: {
    label: "Ironman (140.6)",
    swimKm: 3.8, bikeKm: 180, runKm: 42.2,
    peakHours: { beginner: 13, intermediate: 16, advanced: 19 },
    recommendedWeeks: 24, taperWeeks: 2,
    split: { swim: 0.17, bike: 0.53, run: 0.3 },
    longBikeMax: 360, longRunMax: 150,
    targetCtl: [80, 110], bikeIf: 0.72, runFrac: 0.76, swimFrac: 0.9, transitions: 10,
  },
  half: {
    label: "Ironman 70.3",
    swimKm: 1.9, bikeKm: 90, runKm: 21.1,
    peakHours: { beginner: 9, intermediate: 11, advanced: 14 },
    recommendedWeeks: 16, taperWeeks: 1,
    split: { swim: 0.19, bike: 0.49, run: 0.32 },
    longBikeMax: 210, longRunMax: 120,
    targetCtl: [60, 85], bikeIf: 0.8, runFrac: 0.86, swimFrac: 0.92, transitions: 6,
  },
  olympic: {
    label: "Olympic",
    swimKm: 1.5, bikeKm: 40, runKm: 10,
    peakHours: { beginner: 6, intermediate: 8.5, advanced: 11 },
    recommendedWeeks: 12, taperWeeks: 1,
    split: { swim: 0.22, bike: 0.43, run: 0.35 },
    longBikeMax: 150, longRunMax: 90,
    targetCtl: [45, 65], bikeIf: 0.88, runFrac: 0.94, swimFrac: 0.95, transitions: 4,
  },
  sprint: {
    label: "Sprint",
    swimKm: 0.75, bikeKm: 20, runKm: 5,
    peakHours: { beginner: 4.5, intermediate: 6.5, advanced: 9 },
    recommendedWeeks: 8, taperWeeks: 0,
    split: { swim: 0.24, bike: 0.41, run: 0.35 },
    longBikeMax: 105, longRunMax: 60,
    targetCtl: [35, 50], bikeIf: 0.93, runFrac: 0.98, swimFrac: 0.97, transitions: 3,
  },
};

export type Phase = "prep" | "base" | "build" | "peak" | "taper" | "race";

export const PHASE_META: Record<Phase, { label: string; color: string; focus: string }> = {
  prep: { label: "Prep", color: "#7d8da6", focus: "Technique, strength and routine. Easy aerobic volume." },
  base: { label: "Base", color: "#2ec5ff", focus: "Aerobic engine: long Z2 sessions, swim technique, strength, sweet spot late in block." },
  build: { label: "Build", color: "#ffd23f", focus: "Threshold work, longer long sessions with race-pace blocks, bricks." },
  peak: { label: "Peak", color: "#ff6b4a", focus: "Race-specific simulations, nutrition rehearsal, biggest weeks." },
  taper: { label: "Taper", color: "#3ddc97", focus: "Volume drops, keep short sharp intensity. Sleep and fuel well." },
  race: { label: "Race week", color: "#d14dff", focus: "Openers only. Stay fresh, check kit, carb-load 36–48 h out." },
};

export interface PlannedSession {
  id: string;
  date: string;
  sport: Sport | "rest";
  title: string;
  minutes: number;
  zone: number; // 1-5 dominant intensity
  key: boolean;
  description: string;
  kind: "rest" | "easy" | "quality" | "long" | "brick" | "technique" | "strength" | "race" | "openers";
}

export interface PlanWeek {
  index: number;
  start: string; // Monday
  phase: Phase;
  recovery: boolean;
  targetHours: number;
  sessions: PlannedSession[];
}

export interface Plan {
  event: RaceEvent;
  spec: EventSpec;
  weeks: PlanWeek[];
  startHours: number;
  peakHours: number;
  warnings: string[];
}

// ---------- Phase layout ----------

export function layoutPhases(totalWeeks: number, type: EventType): Phase[] {
  if (totalWeeks <= 1) return ["race"];
  const spec = EVENTS[type];
  const taper = Math.min(spec.taperWeeks, Math.floor((totalWeeks - 1) / 4));
  const rem = totalWeeks - 1 - taper;
  const peak = Math.min(type === "full" ? 4 : 3, Math.round(rem * 0.18));
  const build = Math.min(12, Math.round(rem * 0.35));
  let base = rem - peak - build;
  let prep = 0;
  if (base > 16) {
    prep = base - 16;
    base = 16;
  }
  return [
    ...Array<Phase>(prep).fill("prep"),
    ...Array<Phase>(base).fill("base"),
    ...Array<Phase>(build).fill("build"),
    ...Array<Phase>(peak).fill("peak"),
    ...Array<Phase>(taper).fill("taper"),
    "race",
  ];
}

// ---------- Targets text ----------

interface Targets {
  t: Thresholds;
  weightKg: number;
  hr: (z: number) => string;
  pw: (lo: number, hi: number) => string;
  rp: (z: number) => string;
  sp: (z: number) => string;
  racePower: string;
  raceRunPace: string;
}

function targets(t: Thresholds, spec: EventSpec, weightKg: number): Targets {
  const hz = hrZones(t);
  const rz = runZones(t.runPace);
  const sz = swimZones(t.swimCss);
  const rpRace = t.runPace / spec.runFrac;
  return {
    t,
    weightKg,
    hr: (z) => zoneRangeLabel(hz[z - 1], "hr"),
    pw: (lo, hi) => `${Math.round(t.ftp * lo)}–${Math.round(t.ftp * hi)} W`,
    rp: (z) => zoneRangeLabel(rz[z - 1], "run"),
    sp: (z) => zoneRangeLabel(sz[z - 1], "swim"),
    racePower: `${Math.round(t.ftp * (spec.bikeIf - 0.02))}–${Math.round(t.ftp * (spec.bikeIf + 0.02))} W`,
    raceRunPace: `${fmtPace(rpRace - 5)}–${fmtPace(rpRace + 5)}/km`,
  };
}

const r5 = (m: number) => Math.max(0, Math.round(m / 5) * 5);

// ---------- Session library ----------

function bikeQuality(phase: Phase, type: EventType, wk: number, T: Targets, min: number): Omit<PlannedSession, "id" | "date"> {
  const long = type === "full" || type === "half";
  let title = "Bike intervals";
  let d = "";
  let zone = 3;
  switch (phase) {
    case "prep":
      title = "Bike skills & cadence";
      d = `Warm up 15 min, then 6×3 min high cadence (100–110 rpm) in Z2 (${T.pw(0.6, 0.72)}), 2 min easy. Add 4×1 min single-leg drills each leg.`;
      zone = 2;
      break;
    case "base":
      if (wk % 2 === 0) {
        title = "Tempo / force reps";
        d = `Warm up 15 min. 4×8 min tempo at ${T.pw(0.76, 0.88)}, low cadence 60–70 rpm, 4 min easy. Rest of ride Z2 (${T.pw(0.56, 0.75)}).`;
      } else {
        title = "Sweet spot";
        d = `Warm up 15 min. 3×12 min sweet spot at ${T.pw(0.88, 0.93)}, 5 min easy between. Cool down Z1–2.`;
      }
      break;
    case "build":
      if (long) {
        title = "Threshold intervals";
        d = `Warm up 15 min incl. 3×1 min fast. 4×10 min at ${T.pw(0.95, 1.0)} (FTP ${T.t.ftp} W), 5 min easy. Cool down.`;
      } else {
        title = "VO2max intervals";
        d = `Warm up 15 min. 5×4 min at ${T.pw(1.06, 1.15)}, 4 min easy. Then 10 min at ${T.pw(0.9, 0.95)}.`;
      }
      zone = 4;
      break;
    case "peak":
      title = "Race-power intervals";
      d = long
        ? `Warm up 15 min. ${type === "full" ? "3×25" : "3×20"} min at race power ${T.racePower}, aero position, 5 min easy. Practise drinking every 10–15 min.`
        : `Warm up 15 min. 4×8 min at race power ${T.racePower}, 3 min easy, then 4×1 min hard.`;
      zone = long ? 3 : 4;
      break;
    case "taper":
    case "race":
      title = "Bike openers";
      d = `Easy 20 min, 3×3 min at race power ${T.racePower} with 3 min easy, 4×20 s fast spin-ups. Keep the rest Z1–2.`;
      zone = 3;
      break;
  }
  return { sport: "bike", title, minutes: min, zone, key: phase !== "prep", description: d, kind: "quality" };
}

function runQuality(phase: Phase, type: EventType, wk: number, T: Targets, min: number): Omit<PlannedSession, "id" | "date"> {
  const long = type === "full" || type === "half";
  let title = "Run intervals";
  let d = "";
  let zone = 4;
  switch (phase) {
    case "prep":
      title = "Easy run + strides";
      d = `Easy Z2 (${T.hr(2)} · ${T.rp(2)}), finish with 6×20 s relaxed strides, full walk-back recovery. Focus on quick light cadence (170–180 spm).`;
      zone = 2;
      break;
    case "base":
      if (wk % 2 === 0) {
        title = "Hill repeats";
        d = `Warm up 15 min easy. 8×60 s strong uphill (RPE 8), jog down. Cool down easy. Builds strength without long intensity.`;
      } else {
        title = "Aerobic + tempo";
        d = `Warm up 15 min. 3×8 min tempo (${T.rp(3)} · ${T.hr(3)}), 2 min jog. Rest easy Z2.`;
        zone = 3;
      }
      break;
    case "build":
      if (long) {
        title = "Threshold run";
        d = `Warm up 15 min. 3×10 min at threshold (${T.rp(4)} · ${T.hr(4)}), 2 min jog. Cool down.`;
      } else {
        title = "Track intervals";
        d = `Warm up 15 min + drills. 6×800 m at 5k pace (${T.rp(5)}), 400 m jog. Cool down.`;
        zone = 5;
      }
      break;
    case "peak":
      title = "Race-pace run";
      d = long
        ? `Warm up 10 min. 2×20 min at goal race pace ${T.raceRunPace}, 3 min jog. Practise a gel at 30 min.`
        : `Warm up 15 min. 5×1 km at race pace ${T.raceRunPace}, 90 s jog. Cool down.`;
      zone = long ? 3 : 4;
      break;
    case "taper":
    case "race":
      title = "Run openers";
      d = `20–30 min easy with 4×1 min at race pace ${T.raceRunPace} and 4 strides.`;
      zone = 3;
      break;
  }
  return { sport: "run", title, minutes: min, zone, key: phase !== "prep", description: d, kind: "quality" };
}

function swimMain(phase: Phase, T: Targets, min: number): Omit<PlannedSession, "id" | "date"> {
  const css = fmtPace(T.t.swimCss);
  let title = "Swim technique";
  let d = `Drills: 8×50 (catch-up, fingertip drag, 6-kick switch), then 6×100 at ${T.sp(2)} with 20 s rest. Long, relaxed strokes.`;
  let zone = 2;
  if (phase === "base") {
    title = "Swim aerobic + drills";
    d = `400 easy, 6×50 drill. Main: 4×200 at ${T.sp(2)} (CSS ${css}/100m + 8–10 s), 20 s rest. Pull 300.`;
  } else if (phase === "build") {
    title = "CSS intervals";
    d = `Warm up 400. Main: 10×100 at CSS ${css}/100m, 15 s rest; 4×50 fast. Cool down 200.`;
    zone = 4;
  } else if (phase === "peak") {
    title = "Race-pace swim";
    d = `Warm up 400. 3×400 at CSS + 3–5 s, sighting every 6–8 strokes. Open water and wetsuit if you can.`;
    zone = 3;
  } else if (phase === "taper" || phase === "race") {
    title = "Swim sharpener";
    d = `Easy 300, 8×50 at race effort with 20 s rest, easy 200. Rehearse your start.`;
    zone = 3;
  }
  return { sport: "swim", title, minutes: min, zone, key: phase === "build" || phase === "peak", description: d, kind: phase === "prep" ? "technique" : "quality" };
}

function swimEndurance(phase: Phase, T: Targets, min: number): Omit<PlannedSession, "id" | "date"> {
  return {
    sport: "swim",
    title: "Endurance swim",
    minutes: min,
    zone: 2,
    key: false,
    kind: "easy",
    description:
      phase === "prep"
        ? `Easy continuous swimming with drills between sets. Bilateral breathing.`
        : `Continuous aerobic swim: ${min >= 50 ? "3" : "2"}×(${min >= 50 ? 800 : 500} m) at ${T.sp(2)}, 30 s rest. Use pull buoy on the last one.`,
  };
}

function longBike(phase: Phase, type: EventType, T: Targets, min: number): Omit<PlannedSession, "id" | "date"> {
  let d = `Steady Z2: ${T.pw(0.6, 0.72)} · ${T.hr(2)}. Fuel 60–90 g carbs/h and 500–750 ml fluid/h.`;
  let title = "Long ride";
  if (phase === "build") {
    d = `Z2 ride with ${type === "full" ? "3×20" : "2×20"} min at race power ${T.racePower} in the second half. Fuel 70–90 g carbs/h.`;
  } else if (phase === "peak") {
    title = "Race simulation ride";
    d = `Ride the second half at race power ${T.racePower}. Full race nutrition and kit rehearsal. Note what your stomach tolerates.`;
  } else if (phase === "prep") {
    d = `Relaxed Z2 (${T.pw(0.55, 0.7)}), smooth pedalling. Practise eating on the bike.`;
  }
  return { sport: "bike", title, minutes: min, zone: 2, key: true, description: d, kind: "long" };
}

function longRun(phase: Phase, T: Targets, min: number): Omit<PlannedSession, "id" | "date"> {
  let d = `Conversational Z2: ${T.rp(2)} · ${T.hr(2)}. Walk 1 min every 2 km if it keeps HR in Z2.`;
  if (phase === "build") d = `Z2 run, last 20–30 min at race pace ${T.raceRunPace}. Take a gel every 30–40 min.`;
  if (phase === "peak") d = `Long run with 3×10 min at race pace ${T.raceRunPace}. Rehearse race fueling.`;
  return { sport: "run", title: "Long run", minutes: min, zone: 2, key: true, description: d, kind: "long" };
}

const easyRun = (T: Targets, min: number): Omit<PlannedSession, "id" | "date"> => ({
  sport: "run", title: "Easy run", minutes: min, zone: 2, key: false, kind: "easy",
  description: `Easy Z2: ${T.rp(2)} · keep HR under ${hrZones(T.t)[1].hi} bpm. Cadence 170–180 spm.`,
});

const easyBike = (T: Targets, min: number): Omit<PlannedSession, "id" | "date"> => ({
  sport: "bike", title: "Endurance ride", minutes: min, zone: 2, key: false, kind: "easy",
  description: `Z1–2 spin at ${T.pw(0.55, 0.7)}, cadence 85–95 rpm.`,
});

const brickRun = (T: Targets, min: number): Omit<PlannedSession, "id" | "date"> => ({
  sport: "run", title: "Brick run (off the bike)", minutes: min, zone: 3, key: true, kind: "brick",
  description: `Straight off the bike: first 10 min at race pace ${T.raceRunPace} with quick cadence, then settle into Z2.`,
});

const strength = (phase: Phase, min: number): Omit<PlannedSession, "id" | "date"> => ({
  sport: "strength", title: phase === "build" || phase === "peak" ? "Maintenance strength" : "Strength & mobility", minutes: min, zone: 1, key: false, kind: "strength",
  description:
    phase === "build" || phase === "peak"
      ? "2×6–8 heavy squats or deadlifts, split squats, calf raises, 10 min core. Keep it short."
      : "Squats, hip hinge (RDL), step-ups, single-leg calf raises, plank variations: 3×8–12. Add 10 min mobility.",
});

// ---------- Plan generation ----------

export interface PlanInputs {
  event: RaceEvent;
  profile: Profile;
  t: Thresholds;
  currentWeeklyHours: number;
}

export function generatePlan({ event, profile, t, currentWeeklyHours }: PlanInputs): Plan {
  const spec = EVENTS[event.type];
  const warnings: string[] = [];
  const firstMonday = weekStart(event.trainingStart);
  const raceMonday = weekStart(event.date);
  const totalWeeks = Math.max(1, daysBetween(firstMonday, raceMonday) / 7 + 1);
  if (daysBetween(event.trainingStart, event.date) < 0) {
    return { event, spec, weeks: [], startHours: 0, peakHours: 0, warnings: ["Race date is before the training start date."] };
  }
  if (totalWeeks < spec.recommendedWeeks) {
    warnings.push(
      `${totalWeeks} week${totalWeeks === 1 ? "" : "s"} to race. ${spec.recommendedWeeks}+ weeks is typical for ${spec.label}, so the plan is compressed: build and peak are shortened and the volume ramp is capped for safety.`,
    );
  }
  const phases = layoutPhases(totalWeeks, event.type);

  let peak = Math.min(profile.weeklyHours, spec.peakHours[profile.experience]);
  const floor = Math.min(peak, Math.max(2.5, peak * 0.35));
  let start = clamp(currentWeeklyHours || floor, floor, peak * 0.8);
  if (currentWeeklyHours > peak) start = peak * 0.8;

  const loadingWeeks = phases.filter((p) => p === "base" || p === "build" || p === "peak").length;
  const reachable = start * Math.pow(1.08, Math.max(0, loadingWeeks * 0.75));
  if (reachable < peak * 0.95 && loadingWeeks > 0) {
    warnings.push(
      `Peak volume limited to ~${reachable.toFixed(1)} h/week (target ${peak.toFixed(1)} h) to keep weekly increases under ~10%.`,
    );
    peak = reachable;
  }
  if (profile.weeklyHours < spec.peakHours.beginner) {
    warnings.push(`Your available ${profile.weeklyHours} h/week is below the usual minimum for ${spec.label}. Key sessions are prioritised.`);
  }

  const cycle = age(profile) >= 50 ? 3 : 4; // 2:1 or 3:1 loading
  const weeks: PlanWeek[] = [];
  let lastLoad = start;
  let loadIdx = 0;
  let cycleIdx = 0;
  const T = targets(t, spec, profile.weightKg);

  for (let i = 0; i < phases.length; i++) {
    const phase = phases[i];
    const ws = addDays(firstMonday, i * 7);
    let hours: number;
    let recovery = false;
    if (phase === "race") {
      hours = peak * (event.type === "full" || event.type === "half" ? 0.35 : 0.5);
    } else if (phase === "taper") {
      const taperPos = phases.indexOf("taper");
      const k = i - taperPos;
      const nTaper = phases.filter((p) => p === "taper").length;
      hours = peak * (nTaper === 1 ? 0.6 : [0.75, 0.55][k] ?? 0.55);
    } else {
      cycleIdx++;
      recovery = cycleIdx % cycle === 0 && phase !== "peak" && i < phases.length - 2;
      if (recovery) {
        hours = lastLoad * 0.65;
      } else if (phase === "prep") {
        hours = start * 0.9;
        lastLoad = hours;
      } else {
        loadIdx++;
        const loadingTotal = Math.max(1, Math.round(loadingWeeks * ((cycle - 1) / cycle)));
        const target = start + (peak - start) * Math.min(1, loadIdx / loadingTotal);
        hours = Math.min(target, lastLoad * 1.1, peak);
        if (hours < lastLoad && !recovery) hours = Math.min(lastLoad, peak);
        lastLoad = hours;
      }
    }
    hours = Math.round(hours * 4) / 4;
    const sessions = phase === "race"
      ? raceWeek(ws, event, T, hours, spec)
      : buildWeek(ws, phase, recovery, hours, event.type, i, T, profile.restDay, spec);
    const kept = sessions.filter((s) => s.date >= event.trainingStart);
    // A first week that starts mid-week only keeps the remaining days, so its target shrinks too
    const partial = kept.length < sessions.length && phase !== "race";
    weeks.push({
      index: i,
      start: ws,
      phase,
      recovery,
      targetHours: partial ? Math.round((kept.reduce((m, s) => m + s.minutes, 0) / 60) * 4) / 4 : hours,
      sessions: kept,
    });
  }
  return { event, spec, weeks, startHours: start, peakHours: peak, warnings };
}

function buildWeek(
  ws: string, phase: Phase, recovery: boolean, hours: number, type: EventType, wk: number,
  T: Targets, restDay: number, spec: EventSpec,
): PlannedSession[] {
  const total = hours * 60;
  const strengthCount = phase === "prep" || phase === "base" ? 2 : phase === "build" ? 1 : 0;
  const strengthMin = strengthCount * 30;
  const endurance = Math.max(0, total - strengthMin);
  let swim = endurance * spec.split.swim;
  const bike = endurance * spec.split.bike;
  const run = endurance * spec.split.run;
  if (phase === "prep") swim *= 1.1;

  const day = (k: number) => addDays(ws, (restDay + k) % 7);
  const out: Omit<PlannedSession, "id">[] = [];
  const add = (k: number, s: Omit<PlannedSession, "id" | "date">) => {
    if (s.minutes >= 15 || s.sport === "rest") out.push({ ...s, minutes: r5(s.minutes), date: day(k) });
  };

  // Swim: 2 or 3 sessions
  const nSwim = swim >= 150 ? 3 : 2;
  const swimEach = swim / nSwim;
  add(2, swimMain(phase, T, swimEach));
  add(4, swimEndurance(phase, T, swimEach));
  if (nSwim === 3) add(6, { ...swimEndurance(phase, T, swimEach), title: "Recovery swim", description: "Easy swimming with drills and pull buoy. Loosen up after the long day." });

  // Bike
  const bikeHasEasy = bike >= 200;
  const longB = Math.min(spec.longBikeMax, bike * (bikeHasEasy ? 0.5 : 0.6));
  const qualB = Math.min(120, bikeHasEasy ? bike * 0.28 : bike - longB);
  const easyB = bikeHasEasy ? bike - longB - qualB : 0;
  if (recovery) {
    add(1, { ...easyBike(T, qualB), title: "Easy ride (recovery week)" });
  } else {
    add(1, bikeQuality(phase, type, wk, T, qualB));
  }
  if (easyB > 0) add(4, easyBike(T, Math.min(easyB, 120)));
  add(5, longBike(recovery ? "prep" : phase, type, T, longB));

  // Run
  const brick = (phase === "build" || phase === "peak") && !recovery ? clamp(run * 0.15, 15, type === "full" ? 45 : 30) : 0;
  let longR = Math.min(spec.longRunMax, run * 0.4);
  const qualR = Math.min(run * 0.3, 75);
  let easyR = run - longR - qualR - brick;
  if (easyR < 20) {
    longR += Math.max(0, easyR);
    longR = Math.min(longR, spec.longRunMax);
    easyR = 0;
  }
  if (recovery) {
    add(3, { ...easyRun(T, qualR), title: "Easy run + strides", description: easyRun(T, qualR).description + " Add 4×20 s strides." });
  } else {
    add(3, runQuality(phase, type, wk, T, qualR));
  }
  if (easyR > 0) add(2, easyRun(T, easyR));
  if (brick) add(5, brickRun(T, brick));
  add(6, longRun(recovery ? "base" : phase, T, longR));

  if (strengthCount >= 1) add(3, strength(phase, 30));
  if (strengthCount >= 2) add(1, strength(phase, 30));

  add(0, { sport: "rest", title: "Rest day", minutes: 0, zone: 0, key: false, kind: "rest", description: "Full rest or 15 min mobility. Sleep 8 h+." });

  return out
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
    .map((s, i) => ({ ...s, id: `${s.date}-${i}` }));
}

function raceWeek(ws: string, event: RaceEvent, T: Targets, hours: number, spec: EventSpec): PlannedSession[] {
  const out: PlannedSession[] = [];
  const pred = predictRace(T.t, spec, T.weightKg);
  for (let k = 0; k < 7; k++) {
    const date = addDays(ws, k);
    const before = daysBetween(date, event.date);
    const push = (s: Omit<PlannedSession, "id" | "date">) => out.push({ ...s, date, id: `${date}-${out.length}` });
    if (before < 0) {
      push({ sport: "rest", title: "Recovery", minutes: 0, zone: 0, key: false, kind: "rest", description: "Post-race recovery: walk, eat, sleep. No structured training for 5–10 days." });
    } else if (before === 0) {
      push({
        sport: "other", title: `🏁 RACE: ${event.name || spec.label}`, minutes: Math.round(pred.total / 60), zone: 3, key: true, kind: "race",
        description: `${spec.swimKm} km swim · ${spec.bikeKm} km bike · ${spec.runKm} km run. Bike at ${T.racePower}, run ${T.raceRunPace}. Fuel early and often. Estimated finish ${fmtDuration(pred.total)}.`,
      });
    } else if (before === 1) {
      push({ sport: "bike", title: "Shakeout ride", minutes: 20, zone: 2, key: false, kind: "openers", description: "20 min easy with 3×30 s at race power. Rack bike, check tyres. 10 min jog optional." });
    } else if (before === 2) {
      push({ sport: "swim", title: "Swim openers", minutes: 20, zone: 2, key: false, kind: "openers", description: "Easy 20 min, 4×50 at race pace. Start carb-loading (8–10 g/kg/day)." });
    } else if (before === 3) {
      push({ sport: "bike", title: "Mini brick", minutes: Math.min(45, Math.round((hours * 60) / 4)), zone: 3, key: false, kind: "openers", description: `30 min ride with 3×3 min at ${T.racePower}, then 10 min run with 3×1 min at ${T.raceRunPace}.` });
    } else if (before === 4) {
      push({ sport: "run", title: "Run openers", minutes: 30, zone: 3, key: false, kind: "openers", description: `30 min easy with 4×1 min at ${T.raceRunPace}.` });
      push({ sport: "swim", title: "Easy swim", minutes: 25, zone: 2, key: false, kind: "openers", description: "Relaxed with a few race-pace 50s." });
    } else if (before === 5) {
      push(bikeQuality("taper", event.type, 0, T, 45));
    } else {
      push({ sport: "rest", title: "Rest day", minutes: 0, zone: 0, key: false, kind: "rest", description: "Rest, hydrate and sleep." });
    }
  }
  return out;
}

// ---------- Race prediction ----------

/** Flat-course speed (m/s) for a given power using a simple aero + rolling model. */
export function bikeSpeedForPower(watts: number, massKg: number, cda = 0.3, crr = 0.005): number {
  const rho = 1.2;
  const g = 9.81;
  const eff = 0.97;
  let lo = 0;
  let hi = 25;
  for (let i = 0; i < 50; i++) {
    const v = (lo + hi) / 2;
    const p = (0.5 * rho * cda * v ** 3 + crr * massKg * g * v) / eff;
    if (p > watts) hi = v;
    else lo = v;
  }
  return lo;
}

export interface RacePrediction {
  swim: number;
  bike: number;
  run: number;
  transitions: number;
  total: number;
  bikePower: number;
  runPace: number;
  swimPace: number;
}

export function predictRace(t: Thresholds, spec: EventSpec, weightKg: number): RacePrediction {
  const swimPace = t.swimCss / spec.swimFrac;
  const swim = (spec.swimKm * 1000 * swimPace) / 100;
  const bikePower = t.ftp * spec.bikeIf;
  const bikeV = bikeSpeedForPower(bikePower, weightKg + 9) * 0.94; // course & cornering losses
  const bike = (spec.bikeKm * 1000) / bikeV;
  const runPace = t.runPace / spec.runFrac;
  const run = spec.runKm * runPace;
  const transitions = spec.transitions * 60;
  return { swim, bike, run, transitions, total: swim + bike + run + transitions, bikePower, runPace, swimPace };
}

export function sessionsOn(plan: Plan | undefined, date: string): PlannedSession[] {
  if (!plan) return [];
  const w = plan.weeks.find((w) => date >= w.start && date < addDays(w.start, 7));
  return w ? w.sessions.filter((s) => s.date === date) : [];
}

export function weekOf(plan: Plan | undefined, date = ymd()): PlanWeek | undefined {
  return plan?.weeks.find((w) => date >= w.start && date < addDays(w.start, 7));
}

