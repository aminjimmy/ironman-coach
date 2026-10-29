export type Sport = "swim" | "bike" | "run" | "strength" | "other";
export type Sex = "male" | "female";
export type Experience = "beginner" | "intermediate" | "advanced";

export interface Profile {
  name: string;
  sex: Sex;
  birthYear: number;
  heightCm: number;
  weightKg: number;
  restingHr?: number;
  maxHr?: number;
  lthr?: number; // lactate threshold heart rate
  ftp?: number; // watts
  runThresholdPace?: number; // seconds per km
  swimCss?: number; // seconds per 100 m
  weeklyHours: number; // max hours available per week
  experience: Experience;
  restDay: number; // 0 = Monday ... 6 = Sunday
  nutritionGoal: "maintain" | "lose" | "gain";
}

export interface WeightEntry {
  date: string; // YYYY-MM-DD
  kg: number;
}

export type EventType = "full" | "half" | "olympic" | "sprint";

export interface RaceEvent {
  id: string;
  name: string;
  type: EventType;
  date: string; // YYYY-MM-DD
  trainingStart: string; // YYYY-MM-DD
}

export interface Activity {
  id: string;
  source: "strava" | "file" | "demo";
  sport: Sport;
  rawType: string;
  name: string;
  start: string; // ISO datetime (local)
  movingTime: number; // s
  elapsedTime: number; // s
  distance: number; // m
  elevationGain?: number;
  avgHr?: number;
  maxHr?: number;
  avgSpeed?: number; // m/s
  maxSpeed?: number;
  avgCadence?: number; // as reported (Strava run cadence is per leg)
  avgWatts?: number;
  weightedWatts?: number;
  deviceWatts?: boolean;
  kilojoules?: number;
  calories?: number;
  hasStreams?: boolean;
}

export interface Streams {
  time: number[];
  distance?: number[];
  heartrate?: number[];
  cadence?: number[];
  watts?: number[];
  velocity?: number[];
  altitude?: number[];
}

export interface Macros {
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  fiber?: number;
}

export interface FoodItem extends Macros {
  name: string;
  grams: number;
}

export interface FoodEntry {
  id: string;
  date: string; // YYYY-MM-DD
  time: string; // HH:MM
  meal: "breakfast" | "lunch" | "dinner" | "snack" | "fuel";
  title: string;
  items: FoodItem[];
  photo?: string; // small data URL thumbnail
  confidence?: "low" | "medium" | "high";
  notes?: string;
}

export interface StravaAuth {
  accessToken: string;
  refreshToken: string;
  expiresAt: number; // epoch seconds
  athleteName?: string;
}

export interface Settings {
  stravaClientId: string;
  stravaClientSecret: string;
  anthropicKey: string;
  autoSync: boolean;
  lastSync?: number; // epoch ms
}
