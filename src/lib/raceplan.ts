import type { RacePrefs } from "./types";
import type { Thresholds } from "./metrics";
import type { EventSpec } from "./plan";
import { bikeSpeedForPower } from "./plan";
import { fluidPlan, heatAdjustPct } from "./heat";
import { fmtDuration, fmtPace, round } from "./format";

export interface FuelStep {
  at: number; // seconds from the start of that leg
  text: string;
}

export interface RacePlan {
  heatPct: number;
  swim: { time: number; pace: number; notes: string[] };
  bike: { time: number; power: number; powerFirstHour: number; hrCap: number; speedKmh: number; fuel: FuelStep[]; notes: string[] };
  run: { time: number; pace: number; walkStrategy?: string; hrCap: number; fuel: FuelStep[]; notes: string[] };
  transitions: number;
  total: number;
  carbsTotal: number;
  fluidLph: number;
  sodiumMgPerHour: number;
  carbLoad: { days: number; gPerKg: number; gramsPerDay: number };
  breakfast: string;
}

/**
 * Race-day pacing and fueling, adjusted for heat and humidity.
 * Heat lowers sustainable bike power by ~half the run slowdown; swim pace is unaffected.
 */
export function buildRacePlan(spec: EventSpec, t: Thresholds, weightKg: number, prefs: RacePrefs, sweatLph: number): RacePlan {
  const heatPct = heatAdjustPct(prefs.tempC, prefs.humidity);
  const long = spec.bikeKm >= 90;

  const swimPace = t.swimCss / spec.swimFrac;
  const swimTime = (spec.swimKm * 1000 * swimPace) / 100;

  const power = t.ftp * spec.bikeIf * (1 - heatPct / 200);
  const speed = bikeSpeedForPower(power, weightKg + 9) * 0.94;
  const bikeTime = (spec.bikeKm * 1000) / speed;

  const runPace = (t.runPace / spec.runFrac) * (1 + heatPct / 100);
  const walk = spec.runKm >= 21;
  const runTime = spec.runKm * runPace * (walk ? 1.02 : 1);
  const transitions = spec.transitions * 60;

  const { drinkLph, sodiumMgPerHour } = fluidPlan(sweatLph, prefs.sodiumMgPerL);
  const carbsBike = spec.bikeKm >= 40 ? prefs.carbsPerHour : Math.min(prefs.carbsPerHour, 45);
  const carbsRun = spec.runKm >= 21 ? Math.round(prefs.carbsPerHour * 0.75) : spec.runKm >= 10 ? 30 : 0;

  // Bike: every 20 min drink a third of the hourly fluid; gels top up the carbs the drink doesn't cover
  const bikeFuel: FuelStep[] = [];
  let carbsGot = 0;
  let caffeineGiven = false;
  if (spec.bikeKm >= 40) {
    const interval = 20 * 60;
    for (let at = 15 * 60; at < bikeTime - 10 * 60; at += interval) {
      const ml = Math.round((drinkLph * 1000) / 3 / 10) * 10;
      const drinkCarbs = (ml / 500) * prefs.drinkCarbsPer500;
      carbsGot += drinkCarbs;
      const due = (carbsBike * (at + interval)) / 3600;
      const parts = [`${ml} ml sports drink (${Math.round(drinkCarbs)} g carbs)`];
      if (due - carbsGot >= prefs.gelCarbs * 0.6) {
        carbsGot += prefs.gelCarbs;
        const caff = prefs.caffeine && !caffeineGiven && at > bikeTime * 0.6;
        if (caff) caffeineGiven = true;
        parts.push(`1 ${caff ? "caffeinated " : ""}gel (${prefs.gelCarbs} g)`);
      }
      bikeFuel.push({ at, text: parts.join(" + ") });
    }
  } else {
    bikeFuel.push({ at: 5 * 60, text: "Sip sports drink; one gel at the halfway point if the bike is over 45 min" });
  }

  // Run: aid stations roughly every 15 min (every ~2.5 km); gels every 30–40 min for longer runs
  const runFuel: FuelStep[] = [];
  let runCarbs = 0;
  if (spec.runKm >= 10) {
    const step = 15 * 60;
    for (let at = 10 * 60; at < runTime - 5 * 60; at += step) {
      const due = (carbsRun * (at + step)) / 3600;
      const parts = ["Water + sponge/ice at the aid station"];
      if (carbsRun && due - runCarbs >= prefs.gelCarbs * 0.8) {
        runCarbs += prefs.gelCarbs;
        parts.push(`1 gel (${prefs.gelCarbs} g)`);
      } else if (carbsRun) parts.push("cola or sports drink sips");
      if (prefs.caffeine && at > runTime * 0.55 && at <= runTime * 0.55 + step) parts.push("caffeine (gel or cola)");
      runFuel.push({ at, text: parts.join(" + ") });
    }
  } else {
    runFuel.push({ at: 0, text: "No fuel needed; water and a sponge if it's hot" });
  }

  const ftpPct = (x: number) => Math.round(t.ftp * x);
  const carbsTotal = Math.round(carbsGot + runCarbs);
  return {
    heatPct: round(heatPct, 1),
    swim: {
      time: swimTime,
      pace: swimPace,
      notes: [
        "Start wide or at the back of your pace group; first 200 m controlled.",
        `Settle at ~${fmtPace(swimPace)}/100m, sight every 6–8 strokes.`,
        prefs.tempC >= 26 ? "Water is likely non-wetsuit: practise non-wetsuit swims." : "Check the wetsuit rule the day before.",
      ],
    },
    bike: {
      time: bikeTime,
      power,
      powerFirstHour: power * 0.95,
      hrCap: Math.round(t.lthr * (long ? 0.85 : 0.92)),
      speedKmh: speed * 3.6,
      fuel: bikeFuel,
      notes: [
        `Target ${Math.round(power)} W (${Math.round((power / t.ftp) * 100)}% FTP); first hour at ~${Math.round(power * 0.95)} W.`,
        `Hills: stay under ~${ftpPct(spec.bikeIf + 0.1)} W. Don't chase speed on climbs.`,
        `Heart-rate cap ~${Math.round(t.lthr * (long ? 0.85 : 0.92))} bpm; if HR drifts above it in the heat, ease power.`,
        `Drink ${Math.round(drinkLph * 1000)} ml/h with ~${sodiumMgPerHour} mg sodium/h.`,
      ],
    },
    run: {
      time: runTime,
      pace: runPace,
      walkStrategy: walk ? "Walk every aid station (~20–30 s) from the start: drink, ice under the cap, then run again." : undefined,
      hrCap: Math.round(t.lthr * (long ? 0.88 : 0.97)),
      fuel: runFuel,
      notes: [
        `Run ${fmtPace(runPace)}/km${heatPct >= 1 ? ` (${round(heatPct, 1)}% slower for heat)` : ""}; the first 5 km should feel too easy.`,
        long ? `Cap HR at ~${Math.round(t.lthr * 0.88)} bpm until the last 10 km.` : "Build into the second half.",
        heatPct >= 4 ? "Cool aggressively: ice in the hat and down the suit at every station." : "Keep drinking to thirst plus a little.",
      ],
    },
    transitions,
    total: swimTime + bikeTime + runTime + transitions,
    carbsTotal,
    fluidLph: drinkLph,
    sodiumMgPerHour,
    carbLoad: {
      days: long ? 2 : 1,
      gPerKg: long ? 9 : 7,
      gramsPerDay: Math.round(weightKg * (long ? 9 : 7)),
    },
    breakfast: `3 h before: ${Math.round(weightKg * 1.5)} g carbs, low fibre and fat (e.g. white rice/bread, banana, honey) plus 500 ml fluid with electrolytes. 15 min before the start: 1 gel.`,
  };
}

export const clock = (sec: number) => fmtDuration(sec);
