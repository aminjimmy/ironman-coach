import { useState, type MouseEvent } from "react";
import { useApp } from "../lib/store";
import type { PlannedSession } from "../lib/plan";
import type { Activity } from "../lib/types";
import { addDays, DAY_NAMES, fmtDate, fmtHours, SPORT_META, weekStart } from "../lib/format";
import { sessionFueling } from "../lib/coach";
import { bikeSteps, shareOrDownload, toZwo, zwoFileName } from "../lib/workouts";
import { Sheet, toast } from "./ui";
import { ManualWorkoutForm } from "./ManualWorkout";

export function SessionCard({ s, done, scale = 1, expanded, onToggle, raceIf = 0.75 }: {
  s: PlannedSession;
  done?: Activity;
  scale?: number;
  expanded?: boolean;
  onToggle?: () => void;
  raceIf?: number;
}) {
  const markSession = useApp((st) => st.markSession);
  const [sheet, setSheet] = useState<"move" | "log" | null>(null);
  const meta = s.sport === "rest" ? { color: "#3a4352", icon: "😴", label: "Rest" } : SPORT_META[s.sport];
  const minutes = s.kind === "race" ? s.minutes : Math.round((s.minutes * scale) / 5) * 5;
  const isDone = !!done || s.status === "done";
  const skipped = s.status === "skipped";
  const stop = (fn: () => void) => (e: MouseEvent) => {
    e.stopPropagation();
    fn();
  };
  const steps = expanded ? bikeSteps({ ...s, minutes }, raceIf) : undefined;

  return (
    <>
      <div
        className={`session ${isDone || skipped ? "done" : ""}`}
        style={{ ["--c" as string]: meta.color }}
        role="button"
        tabIndex={0}
        aria-expanded={expanded}
        onClick={onToggle}
        onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && onToggle?.()}
      >
        <span className="ic" aria-hidden>{meta.icon}</span>
        <div className="grow">
          <div className="spread">
            <span className="title" style={skipped ? { textDecoration: "line-through" } : undefined}>{s.title}</span>
            {done ? (
              <span className="check">✓ {fmtHours(done.movingTime)}</span>
            ) : s.status === "done" ? (
              <span className="check">✓ done</span>
            ) : (
              s.minutes > 0 && <span className="muted small num">{fmtHours(minutes * 60)}</span>
            )}
          </div>
          <div className="row" style={{ marginTop: 3 }}>
            {s.key && !skipped && <span className="pill key">Key</span>}
            {s.kind === "test" && <span className="pill est">Test</span>}
            {s.zone > 0 && !skipped && <span className="pill">Z{s.zone}</span>}
            {skipped && <span className="pill">{s.disrupted === "sick" ? "Sick" : s.disrupted === "travel" ? "Travel" : "Skipped"}</span>}
            {s.disrupted === "travel" && !skipped && <span className="pill">Travel</span>}
            {s.originalDate && <span className="pill">moved from {DAY_NAMES[(new Date(s.originalDate + "T00:00").getDay() + 6) % 7]}</span>}
            {scale === 0 && s.sport !== "rest" && !skipped && <span className="pill est">rest today</span>}
            {scale !== 1 && scale !== 0 && s.kind !== "race" && s.sport !== "rest" && !skipped && (
              <span className="pill est">adjusted {scale > 1 ? "+" : ""}{Math.round((scale - 1) * 100)}%</span>
            )}
          </div>
          {expanded && (
            <>
              <div className="desc">{s.description}</div>
              {s.treadmill && <div className="desc">🏃‍♂️ {s.treadmill}</div>}
              {s.sport !== "rest" && s.sport !== "strength" && <div className="desc">⛽ {sessionFueling(minutes, s.kind)}</div>}
              {s.sport !== "rest" && s.kind !== "race" && (
                <div className="row" style={{ marginTop: 8 }}>
                  {s.status || (done && s.status) ? (
                    <button className="btn sm" onClick={stop(() => markSession(s.uid, { status: undefined }))}>Undo {s.status}</button>
                  ) : (
                    <>
                      {!done && <button className="btn sm" onClick={stop(() => { markSession(s.uid, { status: "done" }); toast("Marked done"); })}>✓ Done</button>}
                      {!done && <button className="btn sm" onClick={stop(() => { markSession(s.uid, { status: "skipped" }); toast("Marked skipped"); })}>Skip</button>}
                    </>
                  )}
                  <button className="btn sm" onClick={stop(() => setSheet("move"))}>Move</button>
                  {!done && <button className="btn sm" onClick={stop(() => setSheet("log"))}>Log details</button>}
                  {steps && (
                    <button
                      className="btn sm"
                      onClick={stop(() => shareOrDownload(zwoFileName(s), toZwo({ ...s, minutes }, steps), "application/xml"))}
                      title="Zwift custom workout file"
                    >
                      ⬇ Zwift file
                    </button>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {sheet === "move" && (
        <Sheet onClose={() => setSheet(null)}>
          <MoveSession s={s} onDone={() => setSheet(null)} />
        </Sheet>
      )}
      {sheet === "log" && (
        <Sheet onClose={() => setSheet(null)}>
          <ManualWorkoutForm
            initial={{ sport: s.sport === "rest" || s.sport === "other" ? "other" : s.sport, name: s.title, start: `${s.date}T07:00`, movingTime: minutes * 60 }}
            onDone={(a) => {
              if (a && a.start.slice(0, 10) !== s.date) markSession(s.uid, { status: "done" });
              setSheet(null);
            }}
          />
        </Sheet>
      )}
    </>
  );
}

function MoveSession({ s, onDone }: { s: PlannedSession; onDone: () => void }) {
  const markSession = useApp((st) => st.markSession);
  const original = s.originalDate ?? s.date;
  const ws = weekStart(original);
  const [custom, setCustom] = useState(s.date);
  const moveTo = (d: string) => {
    markSession(s.uid, { movedTo: d === original ? undefined : d });
    toast(d === original ? "Back on its original day" : `Moved to ${fmtDate(d, { weekday: "long", day: "numeric", month: "short" })}`);
    onDone();
  };
  return (
    <div className="stack">
      <h2>Move "{s.title}"</h2>
      <div className="small muted">Pick another day this week. Avoid stacking two key sessions on back-to-back days.</div>
      <div className="tabs" style={{ flexWrap: "wrap" }}>
        {Array.from({ length: 7 }, (_, i) => addDays(ws, i)).map((d) => (
          <button key={d} className={d === s.date ? "on" : ""} onClick={() => moveTo(d)}>
            {DAY_NAMES[(new Date(d + "T00:00").getDay() + 6) % 7]} {fmtDate(d, { day: "numeric" })}
          </button>
        ))}
      </div>
      <div className="row" style={{ flexWrap: "nowrap" }}>
        <input type="date" value={custom} onChange={(e) => setCustom(e.target.value)} />
        <button className="btn" onClick={() => moveTo(custom)}>Move</button>
      </div>
      {s.originalDate && <button className="btn" onClick={() => moveTo(original)}>Put back on {fmtDate(original, { weekday: "long" })}</button>}
    </div>
  );
}
