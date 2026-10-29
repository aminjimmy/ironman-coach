import { useMemo, useState } from "react";
import { useApp } from "../lib/store";
import type { Derived } from "../lib/useDerived";
import { coachAdvice, compliance, macroTargets, matchSession, sumMacros } from "../lib/coach";
import { sessionsOn, weekOf, predictRace, PHASE_META } from "../lib/plan";
import { ctlLevel } from "../lib/metrics";
import { addDays, daysBetween, fmtDate, fmtDuration, fmtHours, fmtPace, round, SPORT_META, weekStart, ymd } from "../lib/format";
import { Card, MacroRing, Stat } from "../components/ui";
import { CheckinCard } from "../components/Checkin";
import { readiness } from "../lib/readiness";
import { SessionCard } from "../components/SessionCard";
import { FitnessChart, WeeklyVolumeChart } from "../components/charts";

const ICONS = { good: "✅", caution: "⚠️", warn: "🛑", info: "💡" };

export function Today({ d, go }: { d: Derived; go: (r: string) => void }) {
  const profile = useApp((s) => s.profile)!;
  const acts = useApp((s) => s.activities);
  const foods = useApp((s) => s.foods);
  const today = ymd();
  const { plan, load, t, fitness } = d;
  const [open, setOpen] = useState<string | null>(null);

  const checkins = useApp((s) => s.checkins);
  const ready = useMemo(() => {
    const last = load[load.length - 1];
    return readiness(checkins[today], checkins, last ? last.ctl - last.atl : undefined);
  }, [checkins, today, load]);
  const coach = useMemo(
    () => coachAdvice({ plan, acts, load, profile, daysSinceSwim: d.daysSinceSwim, readiness: ready }),
    [plan, acts, load, profile, d.daysSinceSwim, ready],
  );
  const todays = sessionsOn(plan, today);
  const week = weekOf(plan, today);
  const last = load[load.length - 1];
  const daysToRace = plan ? daysBetween(today, plan.event.date) : undefined;
  const ws = weekStart(today);
  const weekComp = compliance(plan, acts, ws, addDays(ws, 6));

  const volume = useMemo(() => {
    const out = [];
    for (let i = 11; i >= 0; i--) {
      const start = addDays(ws, -7 * i);
      const end = addDays(start, 6);
      const w = { label: fmtDate(start), swim: 0, bike: 0, run: 0, other: 0, planned: weekOf(plan, start)?.targetHours };
      for (const a of acts) {
        const day = ymd(a.start);
        if (day < start || day > end) continue;
        const key = a.sport === "swim" || a.sport === "bike" || a.sport === "run" ? a.sport : "other";
        w[key] += a.movingTime / 3600;
      }
      out.push(w);
    }
    return out;
  }, [acts, plan, ws]);

  const todaysActs = acts.filter((a) => ymd(a.start) === today);
  const targets = macroTargets(profile, todaysActs, todays);
  const eaten = sumMacros(foods.filter((f) => f.date === today));
  const pred = plan ? predictRace(t, plan.spec, profile.weightKg) : undefined;

  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <h1>Hi {profile.name || "athlete"} 👋</h1>
          <div className="sub">{new Date().toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" })}</div>
        </div>
        <button className="icon-btn" onClick={() => go("settings")} aria-label="Settings">⚙️</button>
      </div>

      {plan ? (
        <Card>
          <div className="spread">
            <div className="grow">
              <div className="muted small">{plan.spec.label}</div>
              <h2 style={{ marginTop: 2 }}>{plan.event.name || plan.spec.label}</h2>
              <div className="muted small">{fmtDate(plan.event.date, { weekday: "short", day: "numeric", month: "short", year: "numeric" })}</div>
            </div>
            <div className="hero" style={{ flexDirection: "column", alignItems: "flex-end", gap: 0 }}>
              <span className="big">{Math.max(0, daysToRace ?? 0)}</span>
              <span className="muted small">days to go</span>
            </div>
          </div>
          {week && (
            <>
              <hr className="hr" />
              <div className="row">
                <span className="pill" style={{ color: PHASE_META[week.phase].color, borderColor: PHASE_META[week.phase].color }}>
                  {PHASE_META[week.phase].label}{week.recovery ? " · recovery" : ""}
                </span>
                <span className="small muted">Week {week.index + 1} of {plan.weeks.length} · target {week.targetHours} h</span>
              </div>
              <div className="small" style={{ marginTop: 6, color: "var(--text-2)" }}>{PHASE_META[week.phase].focus}</div>
              <div style={{ marginTop: 10 }}>
                <div className="spread small"><span className="muted">This week</span><span className="num">{fmtHours(weekComp.doneMin * 60)} / {fmtHours(weekComp.plannedMin * 60)}</span></div>
                <div className="bar" style={{ marginTop: 4 }}><i style={{ width: `${Math.min(100, weekComp.pct)}%`, background: "var(--accent)" }} /></div>
              </div>
            </>
          )}
        </Card>
      ) : (
        <Card title="No target race yet">
          <p className="muted small">Pick an event to generate your periodised plan.</p>
          <button className="btn primary" onClick={() => go("me")}>Choose an event</button>
        </Card>
      )}

      <CheckinCard r={ready} />

      <div className="grid two">
        <Card title="Coach">
          {coach.advice.map((a, i) => (
            <div key={i} className={`advice ${a.tone}`}>
              <div className="badge" aria-hidden>{ICONS[a.tone]}</div>
              <div>
                <div style={{ fontWeight: 600 }}>{a.headline}</div>
                <div className="small" style={{ color: "var(--text-2)" }}>{a.detail}</div>
              </div>
            </div>
          ))}
          {coach.suggestedNextWeekHours != null && (
            <div className="small muted" style={{ marginTop: 8 }}>
              Volume-based suggestion for next week: <b style={{ color: "var(--text)" }}>{coach.suggestedNextWeekHours} h</b> total (any mix of swim/bike/run)
            </div>
          )}
        </Card>

        <Card title="Today's training" right={<button className="btn ghost sm" onClick={() => go("plan")}>Full plan →</button>}>
          <div className="stack" style={{ gap: 8 }}>
            {todays.length === 0 && <div className="muted small">Nothing planned today.</div>}
            {todays.map((s) => (
              <SessionCard
                raceIf={plan?.spec.bikeIf}
                key={s.uid}
                s={s}
                done={matchSession(s, acts)}
                scale={coach.todayScale}
                expanded={open === s.uid}
                onToggle={() => setOpen(open === s.uid ? null : s.uid)}
              />
            ))}
            {todaysActs.filter((a) => !todays.some((s) => matchSession(s, [a]))).map((a) => (
              <button key={a.id} className="session done" style={{ ["--c" as string]: SPORT_META[a.sport].color }} onClick={() => go(`workouts/${a.id}`)}>
                <span className="ic">{SPORT_META[a.sport].icon}</span>
                <div className="grow"><div className="spread"><span className="title">{a.name}</span><span className="check">✓ {fmtHours(a.movingTime)}</span></div><div className="desc">Unplanned session</div></div>
              </button>
            ))}
          </div>
        </Card>
      </div>

      <Card title="Fitness & fatigue" right={last && <span className="pill">{ctlLevel(last.ctl)}</span>}>
        {last ? (
          <>
            <div className="stats" style={{ marginBottom: 12 }}>
              <Stat label="Fitness (CTL)" value={round(last.ctl)} sub={plan ? `race-ready ${plan.spec.targetCtl[0]}–${plan.spec.targetCtl[1]}` : undefined} />
              <Stat label="Fatigue (ATL)" value={round(last.atl)} />
              <Stat label="Form (TSB)" value={round(last.ctl - last.atl)} sub={last.ctl - last.atl < -30 ? "very fatigued" : last.ctl - last.atl < -10 ? "productive" : last.ctl - last.atl > 15 ? "very fresh" : "fresh"} />
              <Stat label="Est. VO₂max" value={fitness.vo2max ?? "–"} sub={fitness.category ? `${fitness.category} · from ${fitness.source}` : "needs HR runs"} />
              <Stat label="FTP" value={`${t.ftp} W`} sub={`${fitness.wattsPerKg} W/kg${t.estimated.ftp ? " · est." : ""}`} />
              <Stat label="Threshold pace" value={fmtPace(t.runPace)} sub={`/km${t.estimated.runPace ? " · est." : ""}`} />
            </div>
            <FitnessChart data={load.slice(-120)} targetCtl={plan?.spec.targetCtl} />
            <p className="tiny muted" style={{ marginTop: 8 }}>
              Calculated in-app from your workouts (TSS from power, pace or heart rate). VO₂max and thresholds marked "est." are estimates. Set tested values in Me → Profile.
            </p>
          </>
        ) : (
          <div className="muted small">Sync Strava or import workouts to see fitness trends.</div>
        )}
      </Card>

      <div className="grid two">
        <Card title="Weekly volume">
          <WeeklyVolumeChart weeks={volume} />
        </Card>

        <div className="stack">
          {pred && plan && (
            <Card title="Race-day estimate" right={<span className="pill est">estimate</span>}>
              <div className="hero"><span className="big">{fmtDuration(pred.total)}</span></div>
              <div className="stats" style={{ marginTop: 8 }}>
                <Stat label="Swim" value={fmtDuration(pred.swim)} sub={`${fmtPace(pred.swimPace)}/100m`} />
                <Stat label="Bike" value={fmtDuration(pred.bike)} sub={`${Math.round(pred.bikePower)} W`} />
                <Stat label="Run" value={fmtDuration(pred.run)} sub={`${fmtPace(pred.runPace)}/km`} />
              </div>
              <p className="tiny muted" style={{ marginTop: 8 }}>From current thresholds on a flat course, no wind. Improves as your FTP, CSS and run pace improve.</p>
            </Card>
          )}
          <Card title="Fuel today" right={<button className="btn ghost sm" onClick={() => go("fuel")}>Log food →</button>}>
            <div className="ring-wrap">
              <MacroRing label="kcal" value={eaten.calories} target={targets.calories} color="#eef2f6" unit="" />
              <MacroRing label="Carbs" value={eaten.carbs} target={targets.carbs} color="#c98500" />
              <MacroRing label="Protein" value={eaten.protein} target={targets.protein} color="#3987e5" />
              <MacroRing label="Fat" value={eaten.fat} target={targets.fat} color="#d55181" />
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
