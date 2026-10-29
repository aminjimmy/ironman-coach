import type { SweatTest } from "./types";
import { clamp } from "./format";

/** Dew point (°C) from temperature and relative humidity (Magnus formula). */
export function dewPoint(tempC: number, rh: number): number {
  const a = 17.62;
  const b = 243.12;
  const g = Math.log(clamp(rh, 1, 100) / 100) + (a * tempC) / (b + tempC);
  return (b * g) / (a - g);
}

/**
 * Running pace slowdown (%) for heat, from the common "temperature + dew point (°F)" rule of thumb:
 * ≤100 no change … 161–170 ≈ 6–8% … above 180 hard running isn't advisable.
 */
export function heatAdjustPct(tempC: number, rh: number): number {
  const sumF = tempC * 1.8 + 32 + (dewPoint(tempC, rh) * 1.8 + 32);
  const table: [number, number][] = [[100, 0], [110, 0.5], [120, 1], [130, 2], [140, 3], [150, 4.5], [160, 6], [170, 8], [180, 10], [190, 12]];
  if (sumF <= 100) return 0;
  for (let i = 1; i < table.length; i++) {
    const [x1, y1] = table[i];
    const [x0, y0] = table[i - 1];
    if (sumF <= x1) return y0 + ((sumF - x0) / (x1 - x0)) * (y1 - y0);
  }
  return 12;
}

export function heatRisk(pct: number): { label: string; tone: "good" | "caution" | "warn" } {
  if (pct < 1) return { label: "Ideal", tone: "good" };
  if (pct < 4) return { label: "Warm: slow down a little", tone: "good" };
  if (pct < 8) return { label: "Hot and humid: pace by HR, drink to a plan", tone: "caution" };
  if (pct < 10) return { label: "Very hot: easy running only", tone: "warn" };
  return { label: "Extreme: move hard sessions indoors or early", tone: "warn" };
}

/** Sweat rate (L/h): body-mass loss + fluid drunk − urine, over the session. 1 kg ≈ 1 L. */
export function sweatRate(t: SweatTest): number {
  const lossL = t.preKg - t.postKg + t.drankMl / 1000 - t.urineMl / 1000;
  return Math.max(0, lossL / (t.minutes / 60));
}

/** Typical sweat rate for the athlete: average of their tests, else a weight-based estimate for hot climates. */
export function typicalSweatRate(tests: SweatTest[], weightKg: number): { lph: number; measured: boolean } {
  const rates = tests.map(sweatRate).filter((r) => r > 0.2 && r < 3.5);
  if (rates.length) return { lph: rates.reduce((a, b) => a + b, 0) / rates.length, measured: true };
  return { lph: clamp(weightKg * 0.015, 0.8, 1.5), measured: false };
}

/** Drink ~70% of sweat losses (never more than ~1 L/h; overdrinking risks hyponatraemia). */
export function fluidPlan(sweatLph: number, sodiumMgPerL: number) {
  const drinkLph = clamp(sweatLph * 0.7, 0.4, 1.0);
  return { drinkLph, sodiumMgPerHour: Math.round(drinkLph * sodiumMgPerL), deficitLph: Math.max(0, sweatLph - drinkLph) };
}

export interface Weather {
  tempC: number;
  rh: number;
  dewC: number;
  feelsC: number;
  place?: string;
}

/** Current conditions from Open-Meteo (free, no key). */
export async function fetchWeather(lat: number, lon: number): Promise<Weather> {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat.toFixed(3)}&longitude=${lon.toFixed(3)}&current=temperature_2m,relative_humidity_2m,dew_point_2m,apparent_temperature`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Weather unavailable (${res.status})`);
  const c = (await res.json()).current;
  return { tempC: c.temperature_2m, rh: c.relative_humidity_2m, dewC: c.dew_point_2m, feelsC: c.apparent_temperature };
}

export function currentPosition(): Promise<{ lat: number; lon: number }> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error("Location isn't available on this device"));
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lon: p.coords.longitude }),
      (e) => reject(new Error(e.code === 1 ? "Location permission denied" : "Couldn't get your location")),
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 30 * 60_000 },
    );
  });
}
