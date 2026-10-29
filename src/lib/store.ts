import { create } from "zustand";
import { persist, createJSONStorage, type StateStorage } from "zustand/middleware";
import { get as idbGet, set as idbSet, del as idbDel, keys as idbKeys } from "idb-keyval";
import type { Activity, FoodEntry, Profile, RaceEvent, Settings, StravaAuth, Streams, WeightEntry } from "./types";
import { ymd } from "./format";

const idbStorage: StateStorage = {
  getItem: async (name) => (await idbGet<string>(name)) ?? null,
  setItem: (name, value) => idbSet(name, value),
  removeItem: (name) => idbDel(name),
};

export interface AppState {
  hydrated: boolean;
  profile: Profile | null;
  weights: WeightEntry[];
  events: RaceEvent[];
  activeEventId: string | null;
  activities: Activity[];
  foods: FoodEntry[];
  settings: Settings;
  strava: StravaAuth | null;

  setProfile: (p: Profile) => void;
  logWeight: (kg: number, date?: string) => void;
  upsertEvent: (e: RaceEvent) => void;
  deleteEvent: (id: string) => void;
  setActiveEvent: (id: string) => void;
  mergeActivities: (acts: Activity[]) => void;
  patchActivity: (id: string, patch: Partial<Activity>) => void;
  deleteActivity: (id: string) => void;
  clearActivities: (source?: Activity["source"]) => void;
  addFood: (f: FoodEntry) => void;
  updateFood: (f: FoodEntry) => void;
  deleteFood: (id: string) => void;
  setSettings: (s: Partial<Settings>) => void;
  setStrava: (a: StravaAuth | null) => void;
  importBackup: (data: Partial<AppState>) => void;
}

export const useApp = create<AppState>()(
  persist(
    (set) => ({
      hydrated: false,
      profile: null,
      weights: [],
      events: [],
      activeEventId: null,
      activities: [],
      foods: [],
      settings: { stravaClientId: "", stravaClientSecret: "", anthropicKey: "", autoSync: true },
      strava: null,

      setProfile: (p) =>
        set((s) => {
          const today = ymd();
          const changed = s.profile?.weightKg !== p.weightKg;
          const weights = changed ? [...s.weights.filter((w) => w.date !== today), { date: today, kg: p.weightKg }] : s.weights;
          return { profile: p, weights };
        }),
      logWeight: (kg, date = ymd()) =>
        set((s) => ({
          weights: [...s.weights.filter((w) => w.date !== date), { date, kg }].sort((a, b) => (a.date < b.date ? -1 : 1)),
          profile: s.profile && date >= (s.weights.at(-1)?.date ?? "") ? { ...s.profile, weightKg: kg } : s.profile,
        })),
      upsertEvent: (e) =>
        set((s) => ({
          events: s.events.some((x) => x.id === e.id) ? s.events.map((x) => (x.id === e.id ? e : x)) : [...s.events, e],
          activeEventId: s.activeEventId ?? e.id,
        })),
      deleteEvent: (id) =>
        set((s) => {
          const events = s.events.filter((e) => e.id !== id);
          return { events, activeEventId: s.activeEventId === id ? events[0]?.id ?? null : s.activeEventId };
        }),
      setActiveEvent: (id) => set({ activeEventId: id }),
      mergeActivities: (acts) =>
        set((s) => {
          const map = new Map(s.activities.map((a) => [a.id, a]));
          for (const a of acts) map.set(a.id, { ...map.get(a.id), ...a, hasStreams: map.get(a.id)?.hasStreams ?? a.hasStreams });
          return { activities: [...map.values()].sort((a, b) => (a.start < b.start ? 1 : -1)) };
        }),
      patchActivity: (id, patch) => set((s) => ({ activities: s.activities.map((a) => (a.id === id ? { ...a, ...patch } : a)) })),
      deleteActivity: (id) => {
        idbDel(`streams:${id}`);
        set((s) => ({ activities: s.activities.filter((a) => a.id !== id) }));
      },
      clearActivities: (source) => {
        set((s) => ({ activities: source ? s.activities.filter((a) => a.source !== source) : [] }));
        idbKeys().then((ks) => ks.forEach((k) => typeof k === "string" && k.startsWith(`streams:${source ?? ""}`) && idbDel(k)));
      },
      addFood: (f) => set((s) => ({ foods: [...s.foods, f] })),
      updateFood: (f) => set((s) => ({ foods: s.foods.map((x) => (x.id === f.id ? f : x)) })),
      deleteFood: (id) => set((s) => ({ foods: s.foods.filter((f) => f.id !== id) })),
      setSettings: (p) => set((s) => ({ settings: { ...s.settings, ...p } })),
      setStrava: (a) => set({ strava: a }),
      importBackup: (data) =>
        set(() => ({
          profile: data.profile ?? null,
          weights: data.weights ?? [],
          events: data.events ?? [],
          activeEventId: data.activeEventId ?? null,
          activities: data.activities ?? [],
          foods: data.foods ?? [],
        })),
    }),
    {
      name: "ironman-coach",
      storage: createJSONStorage(() => idbStorage),
      partialize: ({ hydrated: _h, ...rest }) => rest,
      onRehydrateStorage: () => () => useApp.setState({ hydrated: true }),
    },
  ),
);

export const getStreams = (id: string) => idbGet<Streams>(`streams:${id}`);
export const saveStreams = (id: string, s: Streams) => idbSet(`streams:${id}`, s);
