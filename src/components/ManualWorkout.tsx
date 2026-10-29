import { useState } from "react";
import { useApp } from "../lib/store";
import type { Activity, Sport } from "../lib/types";
import { SPORT_META, uid, ymd } from "../lib/format";
import { toast } from "./ui";

const RPE_LABEL = ["", "Very easy", "Easy", "Easy", "Moderate", "Moderate", "Somewhat hard", "Hard", "Very hard", "Very hard", "Max"];

/** Form for a workout without a device file (e.g. pool swim without a watch, gym session). */
export function ManualWorkoutForm({ initial, onDone }: {
  initial?: Partial<Activity> & { sport?: Sport };
  onDone: (a?: Activity) => void;
}) {
  const upsertActivity = useApp((s) => s.upsertActivity);
  const editing = initial?.id?.startsWith("manual-");
  const [sport, setSport] = useState<Sport>(initial?.sport ?? "run");
  const [name, setName] = useState(initial?.name ?? "");
  const [date, setDate] = useState(initial?.start?.slice(0, 10) ?? ymd());
  const [time, setTime] = useState(initial?.start?.slice(11, 16) ?? new Date().toTimeString().slice(0, 5));
  const [minutes, setMinutes] = useState<number | "">(initial?.movingTime ? Math.round(initial.movingTime / 60) : "");
  const [dist, setDist] = useState<number | "">(
    initial?.distance ? (initial.sport === "swim" ? Math.round(initial.distance) : +(initial.distance / 1000).toFixed(2)) : "",
  );
  const [hr, setHr] = useState<number | "">(initial?.avgHr ? Math.round(initial.avgHr) : "");
  const [rpe, setRpe] = useState(initial?.rpe ?? 5);
  const [notes, setNotes] = useState(initial?.notes ?? "");

  const distUnit = sport === "swim" ? "m" : "km";
  const valid = Number(minutes) > 0;

  const save = () => {
    const sec = Number(minutes) * 60;
    const meters = dist === "" ? 0 : sport === "swim" ? Number(dist) : Number(dist) * 1000;
    const a: Activity = {
      id: editing ? initial!.id! : `manual-${uid()}`,
      source: "manual",
      sport,
      rawType: SPORT_META[sport].label,
      name: name.trim() || `${SPORT_META[sport].label} (manual)`,
      start: `${date}T${time || "07:00"}:00`,
      movingTime: sec,
      elapsedTime: sec,
      distance: meters,
      avgSpeed: meters > 0 ? meters / sec : undefined,
      avgHr: hr === "" ? undefined : Number(hr),
      rpe,
      notes: notes.trim() || undefined,
    };
    upsertActivity(a);
    toast(editing ? "Workout updated" : "Workout logged");
    onDone(a);
  };

  return (
    <div className="stack">
      <h2>{editing ? "Edit workout" : "Log a workout"}</h2>
      <div className="tabs">
        {(["swim", "bike", "run", "strength", "other"] as Sport[]).map((s) => (
          <button key={s} className={sport === s ? "on" : ""} onClick={() => setSport(s)}>{SPORT_META[s].icon} {SPORT_META[s].label}</button>
        ))}
      </div>
      <div className="form-grid">
        <label className="field" style={{ gridColumn: "1 / -1" }}>
          <span>Name (optional)</span>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder={sport === "swim" ? "e.g. Pool swim 1.5 km" : "e.g. Morning run"} />
        </label>
        <label className="field"><span>Date</span><input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
        <label className="field"><span>Start time</span><input type="time" value={time} onChange={(e) => setTime(e.target.value)} /></label>
        <label className="field">
          <span>Duration (min)</span>
          <input type="number" inputMode="numeric" value={minutes} onChange={(e) => setMinutes(e.target.value === "" ? "" : Number(e.target.value))} />
        </label>
        {sport !== "strength" && (
          <label className="field">
            <span>Distance ({distUnit}, optional)</span>
            <input type="number" inputMode="decimal" step={sport === "swim" ? 25 : 0.1} value={dist} onChange={(e) => setDist(e.target.value === "" ? "" : Number(e.target.value))} />
          </label>
        )}
        <label className="field">
          <span>Avg heart rate (optional)</span>
          <input type="number" inputMode="numeric" value={hr} onChange={(e) => setHr(e.target.value === "" ? "" : Number(e.target.value))} />
        </label>
      </div>
      <label className="field">
        <span>Effort: {rpe}/10, {RPE_LABEL[rpe]}</span>
        <input type="range" min={1} max={10} value={rpe} onChange={(e) => setRpe(Number(e.target.value))} style={{ padding: 0, minHeight: 28 }} />
        <span className="hint">Used for training stress when there's no power, pace or heart rate.</span>
      </label>
      <label className="field">
        <span>Notes (optional)</span>
        <textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </label>
      <div className="row">
        <button className="btn primary grow" disabled={!valid} onClick={save}>{editing ? "Save" : "Log workout"}</button>
        <button className="btn" onClick={() => onDone()}>Cancel</button>
      </div>
    </div>
  );
}
