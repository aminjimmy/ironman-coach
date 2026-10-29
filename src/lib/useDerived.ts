import { useMemo } from "react";
import { useApp } from "./store";
import { thresholds, loadSeries, weeklyHours, fitnessEstimate, type Thresholds, type LoadDay, type FitnessEstimate } from "./metrics";
import { generatePlan, type Plan } from "./plan";
import { addDays } from "./format";

export interface Derived {
  t: Thresholds;
  load: LoadDay[];
  plan?: Plan;
  fitness: FitnessEstimate;
}

/** Thresholds, fitness/fatigue series and the training plan, recomputed when inputs change. */
export function useDerived(): Derived | null {
  const profile = useApp((s) => s.profile);
  const activities = useApp((s) => s.activities);
  const events = useApp((s) => s.events);
  const activeEventId = useApp((s) => s.activeEventId);
  const event = events.find((e) => e.id === activeEventId) ?? events[0];

  return useMemo(() => {
    if (!profile) return null;
    const t = thresholds(profile, activities);
    const load = loadSeries(activities, t);
    // Plan starting volume = recent volume measured just before training began (sport-agnostic)
    const plan = event
      ? generatePlan({
          event,
          profile,
          t,
          currentWeeklyHours: weeklyHours(activities, 4, addDays(event.trainingStart, -1)) || weeklyHours(activities, 4),
        })
      : undefined;
    return { t, load, plan, fitness: fitnessEstimate(profile, activities, t) };
  }, [profile, activities, event]);
}
