import type { Activity, Sport } from "./types";
import { fmtPace } from "./format";

const median = (xs: number[]) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

const speedLabel = (sport: Sport, v: number) =>
  sport === "swim" ? `${fmtPace(100 / v)}/100m` : sport === "run" ? `${fmtPace(1000 / v)}/km` : `${(v * 3.6).toFixed(1)} km/h`;

/**
 * Flags workouts whose numbers are physically implausible or far outside the athlete's own norm
 * (e.g. a pool watch miscounting lengths). Returns activity id -> human-readable reason.
 * Flagged workouts still count as training load, but not toward threshold/fitness estimates.
 */
export function qualityFlags(acts: Activity[]): Map<string, string> {
  const flags = new Map<string, string>();
  const bySport = (sport: Sport) => acts.filter((a) => a.sport === sport && a.avgSpeed && a.distance > 0);
  const typical: Partial<Record<Sport, number>> = {};
  for (const sport of ["swim", "run", "bike"] as Sport[]) {
    const xs = bySport(sport).map((a) => a.avgSpeed!);
    if (xs.length >= 4) typical[sport] = median(xs);
  }
  const bikePowers = acts.filter((a) => a.sport === "bike" && a.weightedWatts).map((a) => a.weightedWatts!);
  const typicalPower = bikePowers.length >= 4 ? median(bikePowers) : undefined;

  for (const a of acts) {
    const v = a.avgSpeed ?? 0;
    const med = typical[a.sport];
    let reason: string | undefined;
    if (a.avgHr && (a.avgHr > 215 || a.avgHr < 40)) reason = `Average heart rate ${Math.round(a.avgHr)} bpm looks like a sensor error.`;
    else if (a.sport === "swim" && v > 0 && a.distance > 0) {
      if (v > 1.55) reason = `Pace ${speedLabel("swim", v)} is faster than is realistic for a training swim, likely a length-counting error.`;
      else if (med && v > med * 1.5) reason = `Pace ${speedLabel("swim", v)} is much faster than your usual ${speedLabel("swim", med)}, likely a length-counting error.`;
      else if (v < 0.3) reason = `Pace ${speedLabel("swim", v)} is unusually slow; distance may be missing lengths.`;
    } else if (a.sport === "run" && v > 0 && a.distance > 500) {
      if (v > 6.5) reason = `Pace ${speedLabel("run", v)} is faster than is realistic, likely a GPS or treadmill calibration error.`;
      else if (med && v > med * 1.45) reason = `Pace ${speedLabel("run", v)} is much faster than your usual ${speedLabel("run", med)}; check GPS/footpod calibration.`;
      else if (v < 1.4 && a.distance > 1000) reason = `Pace ${speedLabel("run", v)} looks like walking; not used for run-pace estimates.`;
    } else if (a.sport === "bike") {
      if (v > 16.7) reason = `Average speed ${speedLabel("bike", v)} is unrealistic for a ride; was this a drive?`;
      else if (a.weightedWatts && typicalPower && a.weightedWatts > typicalPower * 1.8 && a.movingTime > 1200)
        reason = `Power ${Math.round(a.weightedWatts)} W is far above your usual ${Math.round(typicalPower)} W; check power meter/trainer calibration.`;
    }
    if (reason) flags.set(a.id, reason);
  }
  return flags;
}

/** Usable for threshold/VO2 estimates: not excluded by the athlete and not auto-flagged (unless trusted). */
export function usableForEstimates(a: Activity, flags: Map<string, string>): boolean {
  if (a.excluded) return false;
  return !flags.has(a.id) || !!a.includeAnyway;
}
