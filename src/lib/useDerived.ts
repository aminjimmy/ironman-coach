import { useMemo } from "react";
import { useApp } from "./store";
import { thresholds, loadSeries, weeklyHours, fitnessEstimate, type Thresholds, type LoadDay, type FitnessEstimate } from "./metrics";
import { generatePlan, type Plan } from "./plan";
import { applyOverrides } from "./overrides";
import { addDays, daysBetween, ymd } from "./format";

export interface Derived {
  t: Thresholds;
  load: LoadDay[];
  plan?: Plan;
  fitness: FitnessEstimate;
  daysSinceSwim?: number;
}

/** Thresholds, fitness/fatigue series and the training plan, recomputed when inputs change. */
export function useDerived(): Derived | null {
  const profile = useApp((s) => s.profile);
  const activities = useApp((s) => s.activities);
  const events = useApp((s) => s.events);
  const activeEventId = useApp((s) => s.activeEventId);
  const event = events.find((e) => e.id === activeEventId) ?? events[0];
  const marks = useApp((s) => s.sessionMarks);
  const disruptions = useApp((s) => s.disruptions);

  return useMemo(() => {
    if (!profile) return null;
    const t = thresholds(profile, activities);
    const load = loadSeries(activities, t);
    // Plan starting volume = recent volume measured just before training began (sport-agnostic)
    const lastSwim = activities.find((a) => a.sport === "swim")?.start; // activities are newest first
    const daysSinceSwim = lastSwim ? daysBetween(ymd(lastSwim), ymd()) : activities.length ? undefined : 0;
    const plan = event
      ? generatePlan({
          event,
          profile,
          t,
          currentWeeklyHours: weeklyHours(activities, 4, addDays(event.trainingStart, -1)) || weeklyHours(activities, 4),
          // swim gap is measured at the start of training so the plan doesn't reshuffle every day
          daysSinceSwim: lastSwim ? Math.max(0, daysBetween(ymd(lastSwim), event.trainingStart)) : activities.length ? undefined : 0,
        })
      : undefined;
    return { t, load, plan: applyOverrides(plan, marks, disruptions), fitness: fitnessEstimate(profile, activities, t), daysSinceSwim };
  }, [profile, activities, event, marks, disruptions]);
}
