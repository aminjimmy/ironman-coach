import type { Activity, Profile, Sport, Streams } from "./types";
import { addDays, clamp, daysBetween, fmtPace, round, ymd } from "./format";
import { qualityFlags, usableForEstimates } from "./quality";

// ---------- Thresholds ----------

export interface Thresholds {
  maxHr: number;
  restingHr: number;
  lthr: number;
  ftp: number;
  runPace: number; // s/km at threshold
  swimCss: number; // s/100m
  estimated: { maxHr: boolean; lthr: boolean; ftp: boolean; runPace: boolean; swimCss: boolean };
  /** activity id -> reason, for workouts with implausible data (see quality.ts) */
  flags: Map<string, string>;
}

export function age(p: Profile): number {
  return new Date().getFullYear() - p.birthYear;
}

const DAYS_FOR_ESTIMATES = 120;

function recent(acts: Activity[], sport: Sport, days = DAYS_FOR_ESTIMATES): Activity[] {
  const cutoff = Date.now() - days * 86_400_000;
  return acts.filter((a) => a.sport === sport && new Date(a.start).getTime() >= cutoff);
}

/** FTP lower-bound estimate from ride summaries: weighted watts / the IF a hard ride of that length allows. */
export function estimateFtp(acts: Activity[]): number | undefined {
  let best = 0;
  for (const a of recent(acts, "bike")) {
    const np = a.weightedWatts ?? (a.avgWatts ? a.avgWatts * 1.05 : 0);
    if (!np || a.deviceWatts === false || a.movingTime < 1200) continue;
    // Max sustainable IF by duration: ~1.05 for 20 min, 1.0 for 1 h, 0.9 for 2 h, 0.8 for 4 h
    const h = a.movingTime / 3600;
    const maxIf = h <= 1 ? 1 + 0.075 * (1 - Math.max(h, 0.33)) : clamp(1 - 0.1 * Math.log2(h), 0.65, 1);
    best = Math.max(best, np / maxIf);
  }
  return best ? Math.round(best) : undefined;
}

/** Threshold run pace (s/km) lower-bound estimate from run summaries. */
export function estimateRunPace(acts: Activity[]): number | undefined {
  let bestSpeed = 0;
  for (const a of recent(acts, "run")) {
    if (!a.avgSpeed || a.movingTime < 900 || a.distance < 2500) continue;
    // Sustainable fraction of threshold speed: ~1.06 for 15 min, 1.0 for 1 h, 0.93 for 2 h, 0.86 for 4 h
    const h = a.movingTime / 3600;
    const frac = h <= 1 ? 1 + 0.08 * (1 - Math.max(h, 0.25)) : clamp(1 - 0.07 * Math.log2(h), 0.75, 1);
    bestSpeed = Math.max(bestSpeed, a.avgSpeed / frac);
  }
  return bestSpeed ? Math.round((1000 / bestSpeed) * 1.03) : undefined;
}

export function estimateCss(acts: Activity[]): number | undefined {
  // Swim averages include wall rests and watch quirks, so use a high percentile rather than the single best
  const speeds = recent(acts, "swim", 180)
    .filter((a) => a.avgSpeed && a.distance >= 400)
    .map((a) => a.avgSpeed! / 0.92)
    .sort((a, b) => a - b);
  if (!speeds.length) return undefined;
  const v = speeds[Math.min(speeds.length - 1, Math.floor(speeds.length * 0.8))];
  return Math.round((100 / v) * 1.03);
}

export function thresholds(p: Profile, allActs: Activity[]): Thresholds {
  const a = age(p);
  const flags = qualityFlags(allActs);
  const acts = allActs.filter((x) => usableForEstimates(x, flags));
  const observedMax = Math.max(0, ...acts.map((x) => (x.maxHr && x.maxHr < 225 ? x.maxHr : 0)));
  const maxHr = p.maxHr ?? (observedMax > 150 ? observedMax : Math.round(208 - 0.7 * a));
  const lthr = p.lthr ?? Math.round(maxHr * 0.9);
  const fallbackFtp = Math.round(p.weightKg * { beginner: 2.2, intermediate: 2.8, advanced: 3.5 }[p.experience]);
  const fallbackRun = { beginner: 390, intermediate: 300, advanced: 255 }[p.experience];
  const fallbackCss = { beginner: 150, intermediate: 120, advanced: 95 }[p.experience];
  const ftpEst = estimateFtp(acts);
  const runEst = estimateRunPace(acts);
  const cssEst = estimateCss(acts);
  return {
    maxHr,
    restingHr: p.restingHr ?? 60,
    lthr,
    ftp: p.ftp ?? ftpEst ?? fallbackFtp,
    runPace: p.runThresholdPace ?? runEst ?? fallbackRun,
    swimCss: p.swimCss ?? cssEst ?? fallbackCss,
    estimated: {
      maxHr: !p.maxHr,
      lthr: !p.lthr,
      ftp: !p.ftp,
      runPace: !p.runThresholdPace,
      swimCss: !p.swimCss,
    },
    flags,
  };
}

/** Activities that may feed estimates (VO2max, thresholds), given the thresholds' quality flags. */
export const usable = (acts: Activity[], t: Thresholds) => acts.filter((a) => usableForEstimates(a, t.flags));

// ---------- Zones ----------

export interface Zone {
  name: string;
  label: string;
  lo: number;
  hi: number; // exclusive upper bound; Infinity for last
  color: string;
}

// single-hue intensity ramp (dim -> bright on the dark surface)
const ZC = ["#5b4038", "#7d4a36", "#a05535", "#c25f37", "#de6e3f", "#ef8a5e", "#f7aa86"];

export function hrZones(t: Thresholds): Zone[] {
  const l = t.lthr;
  const b = [0, 0.85 * l, 0.9 * l, 0.95 * l, l, Infinity].map(Math.round);
  const names = ["Recovery", "Aerobic", "Tempo", "Threshold", "VO2 / Anaerobic"];
  return names.map((label, i) => ({ name: `Z${i + 1}`, label, lo: b[i], hi: i === 4 ? Infinity : b[i + 1], color: ZC[i] }));
}

export function powerZones(ftp: number): Zone[] {
  const pct = [0, 0.56, 0.76, 0.91, 1.06, 1.21, 1.51, Infinity];
  const names = ["Active recovery", "Endurance", "Tempo", "Threshold", "VO2max", "Anaerobic", "Neuromuscular"];
  return names.map((label, i) => ({
    name: `Z${i + 1}`,
    label,
    lo: Math.round(pct[i] * ftp),
    hi: pct[i + 1] === Infinity ? Infinity : Math.round(pct[i + 1] * ftp),
    color: ZC[i],
  }));
}

/** Run zones in speed (m/s), derived from threshold pace. */
export function runZones(paceSecPerKm: number): Zone[] {
  const v = 1000 / paceSecPerKm;
  const f = [0, 0.78, 0.88, 0.95, 1.02, Infinity];
  const names = ["Recovery", "Aerobic", "Tempo", "Threshold", "VO2 / Speed"];
  return names.map((label, i) => ({ name: `Z${i + 1}`, label, lo: f[i] * v, hi: f[i + 1] * v, color: ZC[i] }));
}

/** Swim zones in speed (m/s), derived from CSS. */
export function swimZones(css: number): Zone[] {
  const pace = [Infinity, css + 15, css + 8, css + 3, css - 2, 0];
  const names = ["Recovery", "Aerobic", "Tempo", "CSS / Threshold", "Speed"];
  return names.map((label, i) => ({
    name: `Z${i + 1}`,
    label,
    lo: pace[i] === Infinity ? 0 : 100 / pace[i],
    hi: pace[i + 1] === 0 ? Infinity : 100 / pace[i + 1],
    color: ZC[i],
  }));
}

export function zoneRangeLabel(z: Zone, kind: "hr" | "power" | "run" | "swim"): string {
  if (kind === "hr") return z.hi === Infinity ? `≥${z.lo} bpm` : `${z.lo}–${z.hi - 1} bpm`;
  if (kind === "power") return z.hi === Infinity ? `≥${z.lo} W` : `${z.lo}–${z.hi - 1} W`;
  const unit = kind === "run" ? 1000 : 100;
  const slow = z.lo > 0 ? fmtPace(unit / z.lo) : "∞";
  const fast = z.hi === Infinity ? "" : fmtPace(unit / z.hi);
  const suffix = kind === "run" ? "/km" : "/100m";
  if (!fast) return `<${slow}${suffix}`;
  if (z.lo === 0) return `>${fast}${suffix}`;
  return `${fast}–${slow}${suffix}`;
}

// ---------- Stream helpers ----------

/** Resample a stream to 1 Hz using the time array (forward fill). Gaps > 10 s are treated as stopped (skipped). */
export function resample1Hz(time: number[], values: number[]): number[] {
  const out: number[] = [];
  for (let i = 0; i < time.length - 1; i++) {
    const dt = time[i + 1] - time[i];
    if (dt <= 0) continue;
    const n = dt > 10 ? 1 : dt;
    for (let k = 0; k < n; k++) out.push(values[i] ?? 0);
  }
  if (time.length) out.push(values[time.length - 1] ?? 0);
  return out;
}

export function timeInZones(time: number[], values: number[] | undefined, zones: Zone[]): number[] {
  const secs = zones.map(() => 0);
  if (!values) return secs;
  for (let i = 0; i < time.length - 1; i++) {
    const dt = Math.min(time[i + 1] - time[i], 10);
    const v = values[i];
    if (!v || dt <= 0) continue;
    const zi = zones.findIndex((z) => v >= z.lo && v < z.hi);
    if (zi >= 0) secs[zi] += dt;
  }
  return secs;
}

export function normalizedPower(time: number[], watts: number[]): number {
  const w = resample1Hz(time, watts);
  if (w.length < 30) return w.reduce((a, b) => a + b, 0) / Math.max(1, w.length);
  let sum = 0;
  let acc = 0;
  let n = 0;
  for (let i = 0; i < w.length; i++) {
    sum += w[i];
    if (i >= 30) sum -= w[i - 30];
    if (i >= 29) {
      acc += (sum / 30) ** 4;
      n++;
    }
  }
  return (acc / n) ** 0.25;
}

/** Best rolling average over windowSec (1 Hz resampled). */
export function bestEffort(time: number[], values: number[], windowSec: number): number | undefined {
  const v = resample1Hz(time, values);
  if (v.length < windowSec) return undefined;
  let sum = 0;
  let best = 0;
  for (let i = 0; i < v.length; i++) {
    sum += v[i];
    if (i >= windowSec) sum -= v[i - windowSec];
    if (i >= windowSec - 1) best = Math.max(best, sum / windowSec);
  }
  return best;
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

/** Aerobic decoupling: % drop in output:HR from first to second half. Positive = HR drifted up. */
export function decoupling(s: Streams, sport: Sport): number | undefined {
  const out = sport === "bike" && s.watts ? s.watts : s.velocity;
  if (!out || !s.heartrate || s.time.length < 600) return undefined;
  const mid = Math.floor(s.time.length / 2);
  const ef = (a: number, b: number) => {
    const o = mean(out.slice(a, b).filter((x) => x > 0));
    const h = mean(s.heartrate!.slice(a, b).filter((x) => x > 0));
    return h ? o / h : 0;
  };
  const e1 = ef(0, mid);
  const e2 = ef(mid, s.time.length);
  if (!e1 || !e2) return undefined;
  return ((e1 - e2) / e1) * 100;
}

// ---------- Training stress ----------

export interface Stress {
  tss: number;
  intensity: number; // IF
  method: "power" | "pace" | "rpe" | "hr" | "duration";
}

export function activityStress(a: Activity, t: Thresholds, s?: Streams): Stress {
  const hours = a.movingTime / 3600;
  const trusted = !t.flags.has(a.id) || !!a.includeAnyway;
  if (!trusted) return fallbackStress(a, t, hours);
  if (a.sport === "bike") {
    let np = a.weightedWatts ?? (a.avgWatts && a.deviceWatts !== false ? a.avgWatts * 1.05 : undefined);
    if (s?.watts && s.watts.some((w) => w > 0)) np = normalizedPower(s.time, s.watts);
    if (np) {
      const IF = np / t.ftp;
      return { tss: hours * IF * IF * 100, intensity: IF, method: "power" };
    }
  }
  if (a.sport === "run" && a.avgSpeed && a.distance > 500) {
    const grade = a.elevationGain && a.distance ? a.elevationGain / a.distance : 0;
    const v = a.avgSpeed * (1 + 3 * grade);
    const IF = clamp(v / (1000 / t.runPace), 0.3, 1.2);
    return { tss: hours * IF * IF * 100, intensity: IF, method: "pace" };
  }
  if (a.sport === "swim" && a.avgSpeed && a.distance > 100) {
    const IF = clamp(a.avgSpeed / (100 / t.swimCss), 0.3, 1.2);
    return { tss: hours * IF ** 3 * 100, intensity: IF, method: "pace" };
  }
  return fallbackStress(a, t, hours);
}

/** Effort-based stress when power/pace can't be used: perceived effort, then heart rate, then duration. */
function fallbackStress(a: Activity, t: Thresholds, hours: number): Stress {
  if (a.rpe) {
    const IF = clamp(0.5 + a.rpe * 0.05, 0.5, 1.05);
    return { tss: hours * IF * IF * 100, intensity: IF, method: "rpe" };
  }
  if (a.avgHr && a.avgHr >= 40 && a.avgHr <= 215) {
    const IF = clamp(a.avgHr / t.lthr, 0.4, 1.15);
    return { tss: hours * IF * IF * 100, intensity: IF, method: "hr" };
  }
  const perHour = a.sport === "strength" || a.sport === "other" ? 40 : 55;
  return { tss: hours * perHour, intensity: Math.sqrt(perHour / 100), method: "duration" };
}

export function intensityLabel(IF: number): string {
  if (IF < 0.65) return "Recovery";
  if (IF < 0.8) return "Endurance";
  if (IF < 0.9) return "Tempo";
  if (IF < 1.0) return "Threshold";
  return "Race / VO2";
}

// ---------- Fitness, fatigue, form ----------

export interface LoadDay {
  date: string;
  tss: number;
  ctl: number; // fitness, 42-day EWMA
  atl: number; // fatigue, 7-day EWMA
  tsb: number; // form = yesterday's CTL - ATL
}

export function loadSeries(acts: Activity[], t: Thresholds, until = ymd()): LoadDay[] {
  if (!acts.length) return [];
  const byDay = new Map<string, number>();
  let first = until;
  for (const a of acts) {
    const d = ymd(a.start);
    if (d < first) first = d;
    byDay.set(d, (byDay.get(d) ?? 0) + activityStress(a, t).tss);
  }
  const out: LoadDay[] = [];
  let ctl = 0;
  let atl = 0;
  const n = daysBetween(first, until);
  for (let i = 0; i <= n; i++) {
    const date = addDays(first, i);
    const tss = byDay.get(date) ?? 0;
    const tsb = ctl - atl;
    ctl += (tss - ctl) / 42;
    atl += (tss - atl) / 7;
    out.push({ date, tss, ctl, atl, tsb });
  }
  return out;
}

export function weeklyHours(acts: Activity[], weeks: number, until = ymd()): number {
  const from = addDays(until, -7 * weeks);
  const secs = acts.filter((a) => ymd(a.start) > from && ymd(a.start) <= until).reduce((s, a) => s + a.movingTime, 0);
  return secs / 3600 / weeks;
}

// ---------- VO2max & fitness level ----------

/** Estimate VO2max (ml/kg/min) from one steady run using %HRR ≈ %VO2R (Swain). */
export function runVo2(a: Activity, t: Thresholds): number | undefined {
  if (a.sport !== "run" || !a.avgHr || !a.avgSpeed || a.movingTime < 1200) return undefined;
  const hrr = (a.avgHr - t.restingHr) / (t.maxHr - t.restingHr);
  if (hrr < 0.5 || hrr > 0.97) return undefined;
  const sMin = a.avgSpeed * 60;
  const grade = a.elevationGain && a.distance ? (a.elevationGain / a.distance) * 0.5 : 0;
  const vo2 = 0.2 * sMin + 0.9 * sMin * grade + 3.5;
  const est = (vo2 - 3.5) / hrr + 3.5;
  return est > 20 && est < 90 ? est : undefined;
}

export interface FitnessEstimate {
  vo2max?: number;
  source?: "run" | "bike";
  category?: string;
  wattsPerKg: number;
}

const VO2_NORMS: Record<"male" | "female", [number, number[]][]> = {
  // [maxAge, [fair, good, excellent, superior] lower bounds] — approximate ACSM/Cooper norms
  male: [
    [29, [38, 44, 49, 55]],
    [39, [36, 42, 47, 53]],
    [49, [34, 39, 45, 51]],
    [59, [31, 36, 42, 48]],
    [200, [28, 33, 38, 44]],
  ],
  female: [
    [29, [32, 37, 42, 48]],
    [39, [30, 35, 40, 46]],
    [49, [28, 33, 38, 43]],
    [59, [26, 30, 35, 40]],
    [200, [24, 28, 32, 37]],
  ],
};

export function vo2Category(vo2: number, sex: "male" | "female", ageYears: number): string {
  const row = VO2_NORMS[sex].find(([max]) => ageYears <= max)![1];
  const labels = ["Poor", "Fair", "Good", "Excellent", "Superior"];
  let i = 0;
  while (i < row.length && vo2 >= row[i]) i++;
  return labels[i];
}

export function fitnessEstimate(p: Profile, acts: Activity[], t: Thresholds): FitnessEstimate {
  const ests = recent(usable(acts, t), "run", 60)
    .map((a) => runVo2(a, t))
    .filter((x): x is number => !!x)
    .sort((a, b) => a - b);
  let vo2: number | undefined;
  let source: "run" | "bike" | undefined;
  if (ests.length >= 2) {
    // upper-middle of the distribution: easy runs with cardiac drift under-read
    vo2 = ests[Math.floor(ests.length * 0.7)];
    source = "run";
  } else if (!t.estimated.ftp || estimateFtp(usable(acts, t))) {
    const p5 = t.ftp / 0.82;
    vo2 = (10.8 * p5) / p.weightKg + 7;
    source = "bike";
  }
  return {
    vo2max: vo2 ? round(vo2, 1) : undefined,
    source,
    category: vo2 ? vo2Category(vo2, p.sex, age(p)) : undefined,
    wattsPerKg: round(t.ftp / p.weightKg, 2),
  };
}

export function ctlLevel(ctl: number): string {
  if (ctl < 20) return "Starting out";
  if (ctl < 40) return "Recreational";
  if (ctl < 60) return "Trained";
  if (ctl < 85) return "Well trained";
  if (ctl < 110) return "Long-course ready";
  return "Elite-level load";
}
