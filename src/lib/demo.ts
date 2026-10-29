import type { Activity, Sport, Streams } from "./types";
import { addDays, dayIndex, ymd } from "./format";

/** Deterministic PRNG so demo data is stable between reloads. */
function rng(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
}

/** ~14 weeks of plausible triathlon training ending yesterday. */
export function demoActivities(): Activity[] {
  const r = rng(42);
  const out: Activity[] = [];
  const today = ymd();
  const days = 98;
  // weekday templates: [sport, minutes, intensity 0..1]
  const week: [Sport, number, number][][] = [
    [],
    [["bike", 60, 0.85]],
    [["swim", 45, 0.6], ["run", 40, 0.5]],
    [["run", 50, 0.8]],
    [["swim", 50, 0.55]],
    [["bike", 150, 0.6], ["run", 20, 0.7]],
    [["run", 85, 0.55]],
  ];
  for (let i = days; i >= 1; i--) {
    const date = addDays(today, -i);
    const dow = dayIndex(date);
    const progress = 1 - i / days;
    const block = Math.floor((days - i) / 7) % 4 === 3 ? 0.65 : 1; // recovery week
    for (const [sport, baseMin, inten] of week[dow]) {
      if (r() < 0.1) continue; // missed session
      const minutes = Math.round(baseMin * (0.75 + 0.45 * progress) * block * (0.9 + r() * 0.2));
      const sec = minutes * 60;
      const fit = 0.92 + 0.1 * progress;
      let speed = 0;
      let watts: number | undefined;
      let cadence: number | undefined;
      if (sport === "run") {
        speed = (2.65 + inten * 0.9) * fit;
        cadence = 82 + inten * 6;
      } else if (sport === "bike") {
        watts = Math.round((140 + inten * 90) * fit);
        speed = 6.2 + watts / 70;
        cadence = 86;
      } else {
        speed = (0.78 + inten * 0.16) * fit;
      }
      const hr = Math.round(118 + inten * 48 - progress * 4 + (r() - 0.5) * 6);
      const hour = sport === "bike" && dow === 5 ? 7 : 6;
      out.push({
        id: `demo-${date}-${sport}-${out.length}`,
        source: "demo",
        sport,
        rawType: sport === "bike" ? "Ride" : sport === "run" ? "Run" : "Swim",
        name: `${sport === "bike" ? (inten > 0.8 ? "Interval ride" : "Endurance ride") : sport === "run" ? (inten > 0.7 ? "Tempo run" : minutes > 70 ? "Long run" : "Easy run") : "Pool swim"}`,
        start: `${date}T${String(hour).padStart(2, "0")}:${String(Math.floor(r() * 50) + 5).padStart(2, "0")}:00`,
        movingTime: sec,
        elapsedTime: Math.round(sec * 1.05),
        distance: Math.round(speed * sec),
        elevationGain: sport === "swim" ? 0 : Math.round(sec / 60 * (sport === "bike" ? 4 : 1.5) * r()),
        avgHr: hr,
        maxHr: Math.round(hr + 12 + inten * 15),
        avgSpeed: speed,
        maxSpeed: speed * 1.4,
        avgCadence: cadence,
        avgWatts: watts,
        weightedWatts: watts ? Math.round(watts * (1.03 + inten * 0.06)) : undefined,
        deviceWatts: !!watts,
        kilojoules: watts ? Math.round((watts * sec) / 1000) : undefined,
      });
    }
  }
  return out;
}

/** Synthesize 1 Hz-ish streams matching a demo activity summary. */
export function demoStreams(a: Activity): Streams {
  const r = rng(a.id.length * 7919 + a.movingTime);
  const n = Math.min(Math.floor(a.movingTime / 5), 2000);
  const step = a.movingTime / n;
  const s: Streams = { time: [], distance: [], heartrate: [], velocity: [], altitude: [], cadence: a.avgCadence ? [] : undefined, watts: a.avgWatts ? [] : undefined };
  let d = 0;
  let alt = 40;
  const intervals = /interval|tempo/i.test(a.name);
  for (let i = 0; i < n; i++) {
    const frac = i / n;
    const onInterval = intervals && frac > 0.2 && frac < 0.85 && Math.floor(frac * 20) % 2 === 0;
    const mult = onInterval ? 1.18 : intervals ? 0.9 : 1;
    const v = (a.avgSpeed ?? 2) * mult * (0.95 + r() * 0.1);
    d += v * step;
    alt += (r() - 0.5) * 2;
    const drift = frac * 6;
    s.time.push(Math.round(i * step));
    s.distance!.push(Math.round(d));
    s.velocity!.push(v);
    s.altitude!.push(alt);
    s.heartrate!.push(Math.round((a.avgHr ?? 140) * (onInterval ? 1.07 : intervals ? 0.95 : 1) - 3 + drift + (r() - 0.5) * 4 - (frac < 0.08 ? 20 * (1 - frac / 0.08) : 0)));
    s.cadence?.push(Math.round((a.avgCadence ?? 85) + (r() - 0.5) * 4));
    s.watts?.push(Math.max(0, Math.round((a.avgWatts ?? 150) * mult * (0.85 + r() * 0.3))));
  }
  return s;
}
