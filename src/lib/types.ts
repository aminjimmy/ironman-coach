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
  trainingTime?: string; // "HH:MM" usual session start, for calendar export
  updatedAt?: number;
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
  updatedAt?: number;
}

export interface Activity {
  id: string;
  source: "strava" | "file" | "demo" | "manual";
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
  rpe?: number; // 1-10 perceived effort (manual entries)
  notes?: string;
  excluded?: boolean; // user: keep out of threshold/fitness estimates
  includeAnyway?: boolean; // user: trust data the quality filter flagged
  updatedAt?: number;
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
  updatedAt?: number;
}

export interface FoodTemplate {
  id: string;
  title: string;
  items: FoodItem[];
  meal?: FoodEntry["meal"];
}

/** Keyed by sessionKey(): stable across plan regeneration as long as the session itself is unchanged. */
export interface SessionMark {
  status?: "done" | "skipped";
  movedTo?: string; // YYYY-MM-DD
  updatedAt: number;
}

export interface Disruption {
  id: string;
  type: "sick" | "travel";
  from: string;
  to: string;
  note?: string;
  updatedAt?: number;
}

export interface Checkin {
  date: string;
  sleepHours: number;
  sleepQuality: number; // 1-5
  soreness: number; // 1-5 (5 = very sore)
  energy: number; // 1-5
  stress: number; // 1-5 (5 = very stressed)
  restingHr?: number;
  hrv?: number;
  ill?: boolean;
  updatedAt: number;
}

export interface SweatTest {
  id: string;
  date: string;
  sport: Sport;
  minutes: number;
  preKg: number;
  postKg: number;
  drankMl: number;
  urineMl: number;
  tempC?: number;
  humidity?: number;
  updatedAt?: number;
}

export interface RacePrefs {
  tempC: number;
  humidity: number;
  carbsPerHour: number;
  gelCarbs: number;
  drinkCarbsPer500: number;
  sodiumMgPerL: number;
  caffeine: boolean;
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
  lastSync?: number; // epoch ms of last successful sync
  lastSyncAttempt?: number;
  lastSyncCount?: number;
  lastSyncError?: string;
  stravaScope?: string; // scopes the athlete actually granted
  githubToken?: string;
  cloudPassphrase?: string;
  gistId?: string;
  gistOwner?: string;
  lastCloudSync?: number;
  cloudError?: string;
}
