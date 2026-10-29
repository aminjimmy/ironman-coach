import { useEffect, useRef, useState } from "react";
import { useApp } from "../lib/store";
import type { Derived } from "../lib/useDerived";
import { PHASE_META, type Phase } from "../lib/plan";
import { compliance, matchSession } from "../lib/coach";
import { addDays, DAY_NAMES_LONG, dayIndex, fmtDate, fmtHours, SPORT_META, ymd } from "../lib/format";
import { Card, Sheet } from "../components/ui";
import { SessionCard } from "../components/SessionCard";
import { DisruptionManager } from "../components/Disruptions";
import { planToIcs } from "../lib/calendar";
import { shareOrDownload } from "../lib/workouts";

export function PlanPage({ d, go }: { d: Derived; go: (r: string) => void }) {
  const acts = useApp((s) => s.activities);
  const trainingTime = useApp((s) => s.profile?.trainingTime);
  const [disruptSheet, setDisruptSheet] = useState(false);
  const plan = d.plan;
  const today = ymd();
  const current = plan?.weeks.find((w) => today >= w.start && today < addDays(w.start, 7));
  const [openWeeks, setOpenWeeks] = useState<Set<number>>(() => new Set(current ? [current.index] : [0]));
  const [openSession, setOpenSession] = useState<string | null>(null);
  const currentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    currentRef.current?.scrollIntoView({ block: "start" });
  }, []);

  if (!plan) {
    return (
      <Card title="No plan yet">
        <p className="muted">Add a target event in Me to generate your plan.</p>
        <button className="btn primary" onClick={() => go("me")}>Add event</button>
      </Card>
    );
  }

  const phaseRuns: { phase: Phase; n: number }[] = [];
  for (const w of plan.weeks) {
    const lastRun = phaseRuns[phaseRuns.length - 1];
    if (lastRun?.phase === w.phase) lastRun.n++;
    else phaseRuns.push({ phase: w.phase, n: 1 });
  }

  const toggle = (i: number) => {
    const next = new Set(openWeeks);
    if (next.has(i)) next.delete(i);
    else next.add(i);
    setOpenWeeks(next);
  };

  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <h1>Training plan</h1>
          <div className="sub">{plan.event.name || plan.spec.label} · {plan.weeks.length} weeks · {plan.startHours.toFixed(1)} → {plan.peakHours.toFixed(1)} h/week</div>
        </div>
      </div>
      <div className="row">
        <button className="btn sm" onClick={() => setDisruptSheet(true)}>🤒 Sick / ✈️ travel</button>
        <button
          className="btn sm"
          onClick={() => shareOrDownload("training-plan.ics", planToIcs(plan, trainingTime), "text/calendar")}
          title="Add upcoming sessions to Google Calendar with reminders"
        >
          📆 Add to calendar
        </button>
      </div>
      {disruptSheet && (
        <Sheet onClose={() => setDisruptSheet(false)}>
          <DisruptionManager onDone={() => setDisruptSheet(false)} />
        </Sheet>
      )}

      <Card>
        <div className="phase-strip" role="img" aria-label="Plan phases">
          {phaseRuns.map((r, i) => (
            <div key={i} style={{ flex: r.n, background: PHASE_META[r.phase].color }} title={`${PHASE_META[r.phase].label}: ${r.n} wk`}>
              {r.n >= 2 ? PHASE_META[r.phase].label : ""}
            </div>
          ))}
        </div>
        <div className="legend">
          {phaseRuns.filter((r, i, arr) => arr.findIndex((x) => x.phase === r.phase) === i).map((r) => (
            <span key={r.phase}><i className="swatch" style={{ background: PHASE_META[r.phase].color }} />{PHASE_META[r.phase].label} · {plan.weeks.filter((w) => w.phase === r.phase).length} wk</span>
          ))}
        </div>
        {plan.warnings.map((w, i) => (
          <div key={i} className="small" style={{ color: "var(--warn)", marginTop: 8 }}>⚠️ {w}</div>
        ))}
      </Card>

      {plan.weeks.map((w) => {
        const end = addDays(w.start, 6);
        const isCurrent = w === current;
        const past = end < today;
        const comp = compliance(plan, acts, w.start, end);
        const open = openWeeks.has(w.index);
        const bySport = { swim: 0, bike: 0, run: 0 };
        for (const s of w.sessions) if (s.sport === "swim" || s.sport === "bike" || s.sport === "run") bySport[s.sport] += s.minutes;
        const days = [...new Set(w.sessions.map((s) => s.date))].sort();
        return (
          <div key={w.index} ref={isCurrent ? currentRef : undefined} className={`week ${isCurrent ? "current" : ""}`} style={{ scrollMarginTop: 12 }}>
            <button className="week-head" onClick={() => toggle(w.index)} aria-expanded={open}>
              <span className="dot" style={{ background: PHASE_META[w.phase].color }} />
              <div className="grow">
                <div className="spread">
                  <span style={{ fontWeight: 600 }}>
                    Week {w.index + 1} · {PHASE_META[w.phase].label}{w.recovery ? " (recovery)" : ""}
                  </span>
                  <span className="small num">{w.targetHours} h</span>
                </div>
                <div className="spread small muted">
                  <span>{fmtDate(w.start)} – {fmtDate(end)}{isCurrent ? " · this week" : ""}</span>
                  <span>
                    {(["swim", "bike", "run"] as const).map((s) => `${SPORT_META[s].icon}${fmtHours(bySport[s] * 60)}`).join(" ")}
                  </span>
                </div>
                {(past || isCurrent) && comp.plannedMin > 0 && (
                  <div className="bar" style={{ marginTop: 6, height: 5 }}>
                    <i style={{ width: `${Math.min(100, comp.pct)}%`, background: comp.pct >= 80 ? "var(--good)" : comp.pct >= 50 ? "var(--warn)" : "var(--bad)" }} />
                  </div>
                )}
              </div>
              <span className="muted">{open ? "▾" : "▸"}</span>
            </button>
            {open && (
              <div className="week-body">
                {days.map((day) => (
                  <div key={day} className="stack" style={{ gap: 6 }}>
                    <div className="day-label">{DAY_NAMES_LONG[dayIndex(day)]} {fmtDate(day)}{day === today ? " · today" : ""}</div>
                    {w.sessions.filter((s) => s.date === day).map((s) => (
                      <SessionCard
                        key={s.uid}
                        s={s}
                        raceIf={plan.spec.bikeIf}
                        done={matchSession(s, acts)}
                        expanded={openSession === s.uid}
                        onToggle={() => setOpenSession(openSession === s.uid ? null : s.uid)}
                      />
                    ))}
                  </div>
                ))}
                {(past || isCurrent) && (
                  <div className="small muted">Completed {fmtHours(comp.doneMin * 60)} of {fmtHours(comp.plannedMin * 60)} planned ({Math.round(comp.pct)}%)</div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
