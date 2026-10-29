import type { PlannedSession } from "./plan";
import { fmtPace } from "./format";

/** Power targets are fractions of FTP (Zwift's convention). */
export type Step =
  | { kind: "warmup" | "cooldown"; sec: number; from: number; to: number }
  | { kind: "steady"; sec: number; power: number; cadence?: number }
  | { kind: "intervals"; repeat: number; onSec: number; onPower: number; offSec: number; offPower: number; cadence?: number }
  | { kind: "free"; sec: number; label?: string };

const dur = (st: Step) => (st.kind === "intervals" ? st.repeat * (st.onSec + st.offSec) : st.sec);
export const stepsDuration = (steps: Step[]) => steps.reduce((s, st) => s + dur(st), 0);

/**
 * Structured version of a planned bike session. Fixed parts (warm-up, intervals, cool-down) come first;
 * any remaining time is endurance riding, so the total matches the planned duration.
 * Interval repeats shrink if the session is too short to hold them all.
 */
export function bikeSteps(s: PlannedSession, raceIf: number): Step[] | undefined {
  if (s.sport !== "bike") return undefined;
  const total = s.minutes * 60;
  const wu = (min = 15): Step => ({ kind: "warmup", sec: min * 60, from: 0.45, to: 0.7 });
  const cd = (min = 5): Step => ({ kind: "cooldown", sec: min * 60, from: 0.65, to: 0.45 });
  const set = (repeat: number, onMin: number, onPower: number, offMin: number, offPower = 0.55, cadence?: number): Step => ({
    kind: "intervals", repeat, onSec: Math.round(onMin * 60), onPower, offSec: Math.round(offMin * 60), offPower, cadence,
  });
  const fill = (parts: Step[], endurance = 0.65): Step[] => {
    const [head, ...rest] = parts;
    const tail = rest.pop()!;
    const middle = [...rest];
    // drop interval repeats until the structure fits in the planned time
    for (const m of middle) {
      if (m.kind !== "intervals") continue;
      while (m.repeat > 1 && stepsDuration([head, ...middle, tail]) > total) m.repeat--;
    }
    const left = total - stepsDuration([head, ...middle, tail]);
    const filler: Step[] = left >= 120 ? [{ kind: "steady", sec: left, power: endurance }] : [];
    return [head, ...middle, ...filler, tail];
  };

  if (s.test === "ftp") {
    return [
      { kind: "warmup", sec: 600, from: 0.45, to: 0.65 },
      set(3, 1, 1.0, 1, 0.5, 110),
      { kind: "steady", sec: 240, power: 0.55 },
      { kind: "free", sec: 300, label: "5 min hard" },
      { kind: "steady", sec: 600, power: 0.5 },
      { kind: "free", sec: 1200, label: "20 min all-out: FTP = 95% of the average" },
      cd(10),
    ];
  }
  switch (s.title) {
    case "Bike skills & cadence":
      return fill([wu(), set(6, 3, 0.66, 2, 0.55, 105), cd()], 0.62);
    case "Tempo / force reps":
      return fill([wu(), set(4, 8, 0.82, 4, 0.6, 65), cd()]);
    case "Sweet spot":
      return fill([wu(), set(3, 12, 0.905, 5, 0.6), cd()]);
    case "Threshold intervals":
      return fill([wu(), set(4, 10, 0.975, 5), cd()]);
    case "VO2max intervals":
      return fill([wu(), set(5, 4, 1.1, 4), { kind: "steady", sec: 600, power: 0.92 }, cd()]);
    case "Race-power intervals":
      return raceIf <= 0.82
        ? fill([wu(), set(3, raceIf <= 0.75 ? 25 : 20, raceIf, 5, 0.6), cd()])
        : fill([wu(), set(4, 8, raceIf, 3, 0.6), set(4, 1, 1.2, 1, 0.5), cd()]);
    case "Bike openers":
      return fill([wu(10), set(3, 3, raceIf, 3), set(4, 1 / 3, 1.3, 2 / 3, 0.5), cd()], 0.6);
    case "Long ride": {
      if (/race power/.test(s.description)) {
        const blocks = /3×20/.test(s.description) ? 3 : 2;
        const steps = fill([wu(), set(blocks, 20, raceIf, 10, 0.65), cd()], 0.68);
        // put the race-power blocks in the second half: move the endurance filler before them
        const filler = steps.find((x) => x.kind === "steady");
        return filler ? [steps[0], filler, ...steps.filter((x) => x !== steps[0] && x !== filler)] : steps;
      }
      return fill([wu(10), cd()], 0.67);
    }
    case "Race simulation ride": {
      const half = Math.round(total / 2);
      return [wu(10), { kind: "steady", sec: half - 600, power: 0.66 }, { kind: "steady", sec: total - half - 300, power: raceIf }, cd()];
    }
    case "Mini brick":
      return fill([wu(10), set(3, 3, raceIf, 3), cd()], 0.6);
    case "Shakeout ride":
      return fill([wu(5), set(3, 0.5, raceIf, 2.5), cd()], 0.55);
    default:
      // endurance / recovery rides
      return fill([wu(10), cd()], /recovery|Easy/i.test(s.title) ? 0.58 : 0.65);
  }
}

const xmlEscape = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const f2 = (x: number) => x.toFixed(3);

/** Zwift custom workout (.zwo). */
export function toZwo(s: PlannedSession, steps: Step[]): string {
  const body = steps
    .map((st) => {
      switch (st.kind) {
        case "warmup":
          return `    <Warmup Duration="${st.sec}" PowerLow="${f2(st.from)}" PowerHigh="${f2(st.to)}"/>`;
        case "cooldown":
          return `    <Cooldown Duration="${st.sec}" PowerLow="${f2(st.from)}" PowerHigh="${f2(st.to)}"/>`;
        case "steady":
          return `    <SteadyState Duration="${st.sec}" Power="${f2(st.power)}"${st.cadence ? ` Cadence="${st.cadence}"` : ""}/>`;
        case "intervals":
          return `    <IntervalsT Repeat="${st.repeat}" OnDuration="${st.onSec}" OffDuration="${st.offSec}" OnPower="${f2(st.onPower)}" OffPower="${f2(st.offPower)}"${st.cadence ? ` Cadence="${st.cadence}"` : ""}/>`;
        case "free":
          return `    <FreeRide Duration="${st.sec}" FlatRoad="1">${st.label ? `\n      <textevent timeoffset="0" message="${xmlEscape(st.label)}"/>\n    ` : ""}</FreeRide>`;
      }
    })
    .join("\n");
  return `<workout_file>
  <author>Ironman Coach</author>
  <name>${xmlEscape(`${s.date} ${s.title}`)}</name>
  <description>${xmlEscape(s.description)}</description>
  <sportType>bike</sportType>
  <tags><tag name="IronmanCoach"/></tags>
  <workout>
${body}
  </workout>
</workout_file>
`;
}

export function zwoFileName(s: PlannedSession): string {
  return `${s.date}-${s.title.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase()}.zwo`;
}

/** Offer a file: share sheet on phones (e.g. to Drive or email), download elsewhere. */
export async function shareOrDownload(name: string, text: string, type: string) {
  const file = new File([text], name, { type });
  const nav = navigator as Navigator & { canShare?: (d: { files: File[] }) => boolean };
  if (nav.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: name });
      return;
    } catch (e) {
      if ((e as Error).name === "AbortError") return;
    }
  }
  const a = document.createElement("a");
  a.href = URL.createObjectURL(file);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
}

// ---------- Treadmill ----------

/** Pace (s/km) -> treadmill speed (km/h). 1% incline approximates outdoor effort. */
export const kmh = (secPerKm: number) => (3600 / secPerKm).toFixed(1);

export function treadmillLine(paceFast: number, paceSlow: number): string {
  return `Treadmill: ${kmh(paceSlow)}–${kmh(paceFast)} km/h at 1% incline (${fmtPace(paceFast)}–${fmtPace(paceSlow)}/km)`;
}
