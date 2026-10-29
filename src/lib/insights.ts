import type { Activity, Streams } from "./types";
import type { Thresholds, Zone, Stress } from "./metrics";
import {
  activityStress, bestEffort, decoupling, hrZones, intensityLabel, normalizedPower, powerZones, runVo2, runZones, swimZones, timeInZones,
} from "./metrics";
import { fmtPace, round } from "./format";

export interface Split {
  n: number;
  dist: number; // m
  time: number; // s
  hr?: number;
  watts?: number;
  cadence?: number;
}

export interface Analysis {
  stress: Stress;
  np?: number;
  vi?: number;
  ef?: number;
  decoupling?: number;
  spm?: number; // running steps per minute
  strideM?: number;
  vo2?: number;
  hrZ?: { zones: Zone[]; secs: number[] };
  powerZ?: { zones: Zone[]; secs: number[] };
  paceZ?: { zones: Zone[]; secs: number[]; kind: "run" | "swim" };
  splits: Split[];
  best: { label: string; value: string }[];
  notes: { tone: "good" | "caution" | "info"; text: string }[];
}

const avg = (xs: number[]) => {
  const v = xs.filter((x) => x > 0);
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : undefined;
};

function splits(s: Streams, every: number): Split[] {
  if (!s.distance || s.distance.length < 2) return [];
  const out: Split[] = [];
  let startIdx = 0;
  let next = every;
  for (let i = 1; i < s.distance.length; i++) {
    const last = i === s.distance.length - 1;
    if (s.distance[i] >= next || last) {
      const dist = s.distance[i] - s.distance[startIdx];
      if (dist < every * 0.25 && last && out.length) break;
      const sl = (arr?: number[]) => arr?.slice(startIdx, i + 1) ?? [];
      out.push({
        n: out.length + 1,
        dist,
        time: s.time[i] - s.time[startIdx],
        hr: avg(sl(s.heartrate)),
        watts: avg(sl(s.watts)),
        cadence: avg(sl(s.cadence)),
      });
      startIdx = i;
      next += every;
    }
  }
  return out;
}

export function analyze(a: Activity, t: Thresholds, s?: Streams): Analysis {
  const stress = activityStress(a, t, s);
  const notes: Analysis["notes"] = [];
  const out: Analysis = { stress, splits: [], best: [], notes };

  // Power
  if (a.sport === "bike" && (s?.watts?.some((w) => w > 0) || a.weightedWatts)) {
    const np = s?.watts ? normalizedPower(s.time, s.watts) : a.weightedWatts!;
    out.np = np;
    if (a.avgWatts) out.vi = np / a.avgWatts;
    if (a.avgHr) out.ef = np / a.avgHr;
    if (s?.watts) {
      const pz = powerZones(t.ftp);
      out.powerZ = { zones: pz, secs: timeInZones(s.time, s.watts, pz) };
      for (const [w, label] of [[60, "1 min"], [300, "5 min"], [1200, "20 min"], [3600, "60 min"]] as const) {
        const b = bestEffort(s.time, s.watts, w);
        if (b) out.best.push({ label: `Best ${label} power`, value: `${Math.round(b)} W` });
      }
      const b20 = bestEffort(s.time, s.watts, 1200);
      if (b20 && b20 * 0.95 > t.ftp * 1.02) {
        notes.push({ tone: "good", text: `Best 20 min was ${Math.round(b20)} W, which suggests FTP ≈ ${Math.round(b20 * 0.95)} W (current ${t.ftp} W). Consider updating your profile.` });
      }
    }
  } else if (a.avgSpeed && a.avgHr) {
    out.ef = (a.avgSpeed * 60) / a.avgHr; // metres per minute per beat
  }

  // HR zones
  if (s?.heartrate?.some((h) => h > 0)) {
    const hz = hrZones(t);
    out.hrZ = { zones: hz, secs: timeInZones(s.time, s.heartrate, hz) };
  }

  // Pace zones
  if (s?.velocity && (a.sport === "run" || a.sport === "swim")) {
    const z = a.sport === "run" ? runZones(t.runPace) : swimZones(t.swimCss);
    out.paceZ = { zones: z, secs: timeInZones(s.time, s.velocity, z), kind: a.sport };
  }

  // Running dynamics
  if (a.sport === "run" && a.avgCadence) {
    out.spm = a.avgCadence < 120 ? a.avgCadence * 2 : a.avgCadence;
    if (a.avgSpeed) out.strideM = a.avgSpeed / (out.spm / 60);
    if (out.spm < 160) notes.push({ tone: "caution", text: `Cadence ${Math.round(out.spm)} spm is low. A quicker, shorter stride (aim 170–180) reduces impact and helps late in an Ironman marathon.` });
    else notes.push({ tone: "good", text: `Cadence ${Math.round(out.spm)} spm with ${round(out.strideM ?? 0, 2)} m stride length.` });
  }
  out.vo2 = runVo2(a, t);
  if (a.sport === "run" && s?.velocity && s.distance) {
    const best1k = bestEffort(s.time, s.velocity, 240);
    if (best1k) out.best.push({ label: "Best 4 min pace", value: `${fmtPace(1000 / best1k)}/km` });
  }

  // Decoupling
  if (s) {
    const dc = decoupling(s, a.sport);
    if (dc != null && a.movingTime >= 2700) {
      out.decoupling = dc;
      if (dc < 5) notes.push({ tone: "good", text: `Aerobic decoupling ${dc.toFixed(1)}%: your heart rate stayed coupled to output. Good aerobic durability at this intensity.` });
      else if (dc < 10) notes.push({ tone: "caution", text: `Decoupling ${dc.toFixed(1)}%: HR drifted up relative to output in the second half. Check heat, hydration and fueling, or the pace was a bit above aerobic threshold.` });
      else notes.push({ tone: "caution", text: `Decoupling ${dc.toFixed(1)}% is high: the second half cost much more. More Z2 volume will build durability.` });
    }
  }

  // Intensity distribution narrative
  const zSource = out.powerZ ?? out.hrZ;
  if (zSource) {
    const tot = zSource.secs.reduce((x, y) => x + y, 0) || 1;
    const low = (zSource.secs[0] + zSource.secs[1]) / tot;
    const high = zSource.secs.slice(3).reduce((x, y) => x + y, 0) / tot;
    if (low > 0.75) notes.push({ tone: "info", text: `${Math.round(low * 100)}% in Z1–2: an aerobic base session. Exactly what most of your training should be.` });
    else if (high > 0.25) notes.push({ tone: "info", text: `${Math.round(high * 100)}% at threshold or above: a hard session. Allow 24–48 h before the next key workout.` });
    else notes.push({ tone: "info", text: `Mostly tempo ("grey zone"). Fine on purpose, but easy days should be easier and hard days harder.` });
  }

  notes.push({
    tone: "info",
    text: `${intensityLabel(stress.intensity)} session: IF ${stress.intensity.toFixed(2)}, ${Math.round(stress.tss)} TSS (from ${stress.method}). ${stress.tss > 250 ? "Big day: expect 2+ days to recover." : stress.tss > 150 ? "Solid load: recovery day recommended after." : ""}`,
  });

  if (s?.distance) out.splits = splits(s, a.sport === "run" ? 1000 : a.sport === "bike" ? 5000 : 100);
  return out;
}
