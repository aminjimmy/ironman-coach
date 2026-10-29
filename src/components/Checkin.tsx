import { useState } from "react";
import { useApp } from "../lib/store";
import type { Checkin } from "../lib/types";
import type { Readiness } from "../lib/readiness";
import { ymd } from "../lib/format";
import { Card } from "./ui";

const SCALES: { key: "sleepQuality" | "energy" | "soreness" | "stress"; label: string; faces: string[] }[] = [
  { key: "sleepQuality", label: "Sleep quality", faces: ["😫", "😕", "😐", "🙂", "😴"] },
  { key: "energy", label: "Energy", faces: ["🪫", "😕", "😐", "🙂", "⚡"] },
  { key: "soreness", label: "Muscle soreness", faces: ["🟢", "🙂", "😐", "😣", "🥵"] },
  { key: "stress", label: "Life stress", faces: ["😌", "🙂", "😐", "😟", "🤯"] },
];

/** Morning check-in: 30 seconds, feeds the readiness score and the coach. */
export function CheckinCard({ r }: { r?: Readiness }) {
  const today = ymd();
  const existing = useApp((s) => s.checkins[today]);
  const saveCheckin = useApp((s) => s.saveCheckin);
  const [editing, setEditing] = useState(!existing);
  const [c, setC] = useState<Checkin>(
    existing ?? { date: today, sleepHours: 7, sleepQuality: 3, soreness: 2, energy: 3, stress: 2, updatedAt: 0 },
  );

  if (!editing && existing && r) {
    const tone = r.ill || r.score < 40 ? "var(--bad)" : r.score < 60 ? "var(--warn)" : "var(--good)";
    return (
      <Card title="Readiness" right={<button className="btn sm ghost" onClick={() => setEditing(true)}>Edit check-in</button>}>
        <div className="hero">
          <span className="big" style={{ color: tone }}>{r.score}</span>
          <span className="muted small">/ 100 · {existing.sleepHours} h sleep{existing.restingHr ? ` · RHR ${existing.restingHr}` : ""}</span>
        </div>
        {r.notes.length > 0 && <div className="small" style={{ color: "var(--text-2)" }}>{r.notes.join(" ")}</div>}
      </Card>
    );
  }

  return (
    <Card title="Morning check-in" right={<span className="tiny muted">30 seconds</span>}>
      <div className="stack" style={{ gap: 10 }}>
        <label className="field">
          <span>Sleep last night: {c.sleepHours} h</span>
          <input type="range" min={3} max={11} step={0.5} value={c.sleepHours} onChange={(e) => setC({ ...c, sleepHours: Number(e.target.value) })} style={{ padding: 0, minHeight: 28 }} />
        </label>
        {SCALES.map((sc) => (
          <div key={sc.key}>
            <div className="small" style={{ color: "var(--text-2)", marginBottom: 4 }}>{sc.label}</div>
            <div className="row" style={{ flexWrap: "nowrap", gap: 6 }} role="radiogroup" aria-label={sc.label}>
              {sc.faces.map((f, i) => (
                <button
                  key={i}
                  role="radio"
                  aria-checked={c[sc.key] === i + 1}
                  aria-label={`${sc.label} ${i + 1} of 5`}
                  className={`btn sm grow ${c[sc.key] === i + 1 ? "primary" : ""}`}
                  onClick={() => setC({ ...c, [sc.key]: i + 1 })}
                  style={{ fontSize: "1.1rem", padding: "4px 0" }}
                >
                  {f}
                </button>
              ))}
            </div>
          </div>
        ))}
        <div className="form-grid">
          <label className="field">
            <span>Resting HR (optional)</span>
            <input type="number" inputMode="numeric" value={c.restingHr ?? ""} onChange={(e) => setC({ ...c, restingHr: e.target.value ? Number(e.target.value) : undefined })} />
          </label>
          <label className="field">
            <span>HRV ms (optional)</span>
            <input type="number" inputMode="numeric" value={c.hrv ?? ""} onChange={(e) => setC({ ...c, hrv: e.target.value ? Number(e.target.value) : undefined })} />
          </label>
        </div>
        <label className="row small">
          <input type="checkbox" checked={!!c.ill} onChange={(e) => setC({ ...c, ill: e.target.checked })} style={{ width: 20, minHeight: 20 }} />
          I feel ill (sore throat, fever, chest symptoms)
        </label>
        <div className="row">
          <button className="btn primary grow" onClick={() => { saveCheckin(c); setEditing(false); }}>Save check-in</button>
          {existing && <button className="btn" onClick={() => setEditing(false)}>Cancel</button>}
        </div>
      </div>
    </Card>
  );
}
