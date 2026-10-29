import { create } from "zustand";
import { persist, createJSONStorage, type StateStorage } from "zustand/middleware";
import { get as idbGet, set as idbSet, del as idbDel, keys as idbKeys } from "idb-keyval";
import type {
  Activity, Checkin, Disruption, FoodEntry, FoodTemplate, Profile, RaceEvent, RacePrefs, SessionMark, Settings,
  StravaAuth, Streams, SweatTest, WeightEntry,
} from "./types";
import { ymd } from "./format";

const idbStorage: StateStorage = {
  getItem: async (name) => (await idbGet<string>(name)) ?? null,
  setItem: (name, value) => idbSet(name, value),
  removeItem: (name) => idbDel(name),
};

export const DEFAULT_RACE_PREFS: RacePrefs = {
  tempC: 30,
  humidity: 75,
  carbsPerHour: 75,
  gelCarbs: 25,
  drinkCarbsPer500: 30,
  sodiumMgPerL: 800,
  caffeine: true,
};

/** Data that is synced between devices (no secrets, tokens or API keys). */
export interface SyncedData {
  profile: Profile | null;
  weights: WeightEntry[];
  events: RaceEvent[];
  activeEventId: string | null;
  activities: Activity[];
  foods: FoodEntry[];
  foodFavorites: FoodTemplate[];
  water: Record<string, number>; // date -> ml
  sessionMarks: Record<string, SessionMark>;
  disruptions: Disruption[];
  checkins: Record<string, Checkin>;
  sweatTests: SweatTest[];
  racePrefs: RacePrefs;
  tombstones: Record<string, number>; // deleted record id -> time, so deletions sync too
  modifiedAt: number;
}

export interface AppState extends SyncedData {
  hydrated: boolean;
  settings: Settings;
  strava: StravaAuth | null;

  setProfile: (p: Profile) => void;
  logWeight: (kg: number, date?: string) => void;
  upsertEvent: (e: RaceEvent) => void;
  deleteEvent: (id: string) => void;
  setActiveEvent: (id: string) => void;
  mergeActivities: (acts: Activity[]) => void;
  upsertActivity: (a: Activity) => void;
  patchActivity: (id: string, patch: Partial<Activity>) => void;
  deleteActivity: (id: string) => void;
  clearActivities: (source?: Activity["source"]) => void;
  addFood: (f: FoodEntry) => void;
  updateFood: (f: FoodEntry) => void;
  deleteFood: (id: string) => void;
  toggleFavorite: (t: FoodTemplate) => void;
  addWater: (date: string, ml: number) => void;
  markSession: (key: string, patch: Partial<Omit<SessionMark, "updatedAt">> | null) => void;
  upsertDisruption: (d: Disruption) => void;
  deleteDisruption: (id: string) => void;
  saveCheckin: (c: Checkin) => void;
  addSweatTest: (t: SweatTest) => void;
  deleteSweatTest: (id: string) => void;
  setRacePrefs: (p: Partial<RacePrefs>) => void;
  setSettings: (s: Partial<Settings>) => void;
  setStrava: (a: StravaAuth | null) => void;
  importBackup: (data: Partial<SyncedData>) => void;
}

const now = () => Date.now();
const sortActs = (a: Activity[]) => a.sort((x, y) => (x.start < y.start ? 1 : -1));

export const useApp = create<AppState>()(
  persist(
    (set) => {
      /** Every user-data change bumps modifiedAt so cloud sync knows this device has news. */
      const change = (fn: (s: AppState) => Partial<AppState>) => set((s) => ({ ...fn(s), modifiedAt: now() }));
      const bury = (s: AppState, id: string) => ({ ...s.tombstones, [id]: now() });
      return {
        hydrated: false,
        profile: null,
        weights: [],
        events: [],
        activeEventId: null,
        activities: [],
        foods: [],
        foodFavorites: [],
        water: {},
        sessionMarks: {},
        disruptions: [],
        checkins: {},
        sweatTests: [],
        racePrefs: DEFAULT_RACE_PREFS,
        tombstones: {},
        modifiedAt: 0,
        settings: { stravaClientId: "", stravaClientSecret: "", anthropicKey: "", autoSync: true },
        strava: null,

        setProfile: (p) =>
          change((s) => {
            const today = ymd();
            const changed = s.profile?.weightKg !== p.weightKg;
            const weights = changed ? [...s.weights.filter((w) => w.date !== today), { date: today, kg: p.weightKg }] : s.weights;
            return { profile: { ...p, updatedAt: now() }, weights };
          }),
        logWeight: (kg, date = ymd()) =>
          change((s) => ({
            weights: [...s.weights.filter((w) => w.date !== date), { date, kg }].sort((a, b) => (a.date < b.date ? -1 : 1)),
            profile: s.profile && date >= (s.weights.at(-1)?.date ?? "") ? { ...s.profile, weightKg: kg, updatedAt: now() } : s.profile,
          })),
        upsertEvent: (e) =>
          change((s) => {
            const ev = { ...e, updatedAt: now() };
            return {
              events: s.events.some((x) => x.id === e.id) ? s.events.map((x) => (x.id === e.id ? ev : x)) : [...s.events, ev],
              activeEventId: s.activeEventId ?? e.id,
            };
          }),
        deleteEvent: (id) =>
          change((s) => {
            const events = s.events.filter((e) => e.id !== id);
            return { events, activeEventId: s.activeEventId === id ? events[0]?.id ?? null : s.activeEventId, tombstones: bury(s, id) };
          }),
        setActiveEvent: (id) => change(() => ({ activeEventId: id })),
        mergeActivities: (acts) =>
          change((s) => {
            const map = new Map(s.activities.map((a) => [a.id, a]));
            for (const a of acts) {
              const prev = map.get(a.id);
              // keep the athlete's own flags when Strava re-sends an activity
              map.set(a.id, { ...prev, ...a, hasStreams: prev?.hasStreams ?? a.hasStreams, excluded: prev?.excluded ?? a.excluded, includeAnyway: prev?.includeAnyway ?? a.includeAnyway });
            }
            return { activities: sortActs([...map.values()]) };
          }),
        upsertActivity: (a) =>
          change((s) => ({ activities: sortActs([...s.activities.filter((x) => x.id !== a.id), { ...a, updatedAt: now() }]) })),
        patchActivity: (id, patch) =>
          change((s) => ({ activities: s.activities.map((a) => (a.id === id ? { ...a, ...patch, updatedAt: now() } : a)) })),
        deleteActivity: (id) => {
          idbDel(`streams:${id}`);
          change((s) => ({ activities: s.activities.filter((a) => a.id !== id), tombstones: bury(s, id) }));
        },
        clearActivities: (source) => {
          change((s) => ({ activities: source ? s.activities.filter((a) => a.source !== source) : [] }));
          idbKeys().then((ks) => ks.forEach((k) => typeof k === "string" && k.startsWith(`streams:${source ?? ""}`) && idbDel(k)));
        },
        addFood: (f) => change((s) => ({ foods: [...s.foods, { ...f, updatedAt: now() }] })),
        updateFood: (f) => change((s) => ({ foods: s.foods.map((x) => (x.id === f.id ? { ...f, updatedAt: now() } : x)) })),
        deleteFood: (id) => change((s) => ({ foods: s.foods.filter((f) => f.id !== id), tombstones: bury(s, id) })),
        toggleFavorite: (t) =>
          change((s) => {
            const exists = s.foodFavorites.some((f) => f.title.toLowerCase() === t.title.toLowerCase());
            return {
              foodFavorites: exists ? s.foodFavorites.filter((f) => f.title.toLowerCase() !== t.title.toLowerCase()) : [...s.foodFavorites, t],
            };
          }),
        addWater: (date, ml) => change((s) => ({ water: { ...s.water, [date]: Math.max(0, (s.water[date] ?? 0) + ml) } })),
        markSession: (key, patch) =>
          change((s) => {
            const marks = { ...s.sessionMarks };
            if (patch === null) delete marks[key];
            else {
              const next = { ...marks[key], ...patch, updatedAt: now() };
              if (!next.status) delete next.status;
              if (!next.movedTo) delete next.movedTo;
              marks[key] = next;
            }
            return { sessionMarks: marks };
          }),
        upsertDisruption: (d) =>
          change((s) => ({ disruptions: [...s.disruptions.filter((x) => x.id !== d.id), { ...d, updatedAt: now() }] })),
        deleteDisruption: (id) => change((s) => ({ disruptions: s.disruptions.filter((d) => d.id !== id), tombstones: bury(s, id) })),
        saveCheckin: (c) => change((s) => ({ checkins: { ...s.checkins, [c.date]: { ...c, updatedAt: now() } } })),
        addSweatTest: (t) => change((s) => ({ sweatTests: [...s.sweatTests, { ...t, updatedAt: now() }] })),
        deleteSweatTest: (id) => change((s) => ({ sweatTests: s.sweatTests.filter((t) => t.id !== id), tombstones: bury(s, id) })),
        setRacePrefs: (p) => change((s) => ({ racePrefs: { ...s.racePrefs, ...p } })),
        setSettings: (p) => set((s) => ({ settings: { ...s.settings, ...p } })),
        setStrava: (a) => set({ strava: a }),
        importBackup: (data) =>
          change(() => ({
            profile: data.profile ?? null,
            weights: data.weights ?? [],
            events: data.events ?? [],
            activeEventId: data.activeEventId ?? null,
            activities: data.activities ?? [],
            foods: data.foods ?? [],
            foodFavorites: data.foodFavorites ?? [],
            water: data.water ?? {},
            sessionMarks: data.sessionMarks ?? {},
            disruptions: data.disruptions ?? [],
            checkins: data.checkins ?? {},
            sweatTests: data.sweatTests ?? [],
            racePrefs: { ...DEFAULT_RACE_PREFS, ...data.racePrefs },
            tombstones: data.tombstones ?? {},
          })),
      };
    },
    {
      name: "ironman-coach",
      storage: createJSONStorage(() => idbStorage),
      partialize: ({ hydrated: _h, ...rest }) => rest,
      // fill fields added in later versions so older saved data keeps working
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<AppState>;
        return { ...current, ...p, racePrefs: { ...DEFAULT_RACE_PREFS, ...p.racePrefs }, settings: { ...current.settings, ...p.settings } };
      },
      onRehydrateStorage: () => () => useApp.setState({ hydrated: true }),
    },
  ),
);

export function syncedSnapshot(s: AppState): SyncedData {
  const { profile, weights, events, activeEventId, activities, foods, foodFavorites, water, sessionMarks, disruptions, checkins, sweatTests, racePrefs, tombstones, modifiedAt } = s;
  return { profile, weights, events, activeEventId, activities, foods, foodFavorites, water, sessionMarks, disruptions, checkins, sweatTests, racePrefs, tombstones, modifiedAt };
}

export const getStreams = (id: string) => idbGet<Streams>(`streams:${id}`);
export const saveStreams = (id: string, s: Streams) => idbSet(`streams:${id}`, s);
