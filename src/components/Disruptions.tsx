import { useState } from "react";
import { useApp } from "../lib/store";
import type { Disruption } from "../lib/types";
import { addDays, fmtDate, uid, ymd } from "../lib/format";
import { toast } from "./ui";

/** Sick / travel periods: sessions inside are skipped or swapped, and illness is followed by 3 easy days. */
export function DisruptionManager({ onDone }: { onDone: () => void }) {
  const disruptions = useApp((s) => s.disruptions);
  const { upsertDisruption, deleteDisruption } = useApp.getState();
  const [d, setD] = useState<Disruption>({ id: uid(), type: "sick", from: ymd(), to: addDays(ymd(), 2) });
  const valid = d.to >= d.from;
  return (
    <div className="stack">
      <h2>Sick or travelling?</h2>
      <p className="small muted" style={{ margin: 0 }}>
        Sick: sessions in this period are skipped, and the next 3 days become short and easy. Travel: rides and swims are skipped,
        runs become optional easy runs, strength becomes a hotel bodyweight circuit.
      </p>
      <div className="tabs">
        <button className={d.type === "sick" ? "on" : ""} onClick={() => setD({ ...d, type: "sick" })}>🤒 Sick</button>
        <button className={d.type === "travel" ? "on" : ""} onClick={() => setD({ ...d, type: "travel" })}>✈️ Travel</button>
      </div>
      <div className="form-grid">
        <label className="field"><span>From</span><input type="date" value={d.from} onChange={(e) => setD({ ...d, from: e.target.value })} /></label>
        <label className="field"><span>To (inclusive)</span><input type="date" value={d.to} onChange={(e) => setD({ ...d, to: e.target.value })} /></label>
        <label className="field" style={{ gridColumn: "1 / -1" }}>
          <span>Note (optional)</span>
          <input value={d.note ?? ""} onChange={(e) => setD({ ...d, note: e.target.value })} placeholder={d.type === "sick" ? "e.g. flu" : "e.g. work trip to KL"} />
        </label>
      </div>
      <button className="btn primary" disabled={!valid} onClick={() => { upsertDisruption(d); toast("Plan adjusted"); onDone(); }}>Adjust plan</button>
      {disruptions.length > 0 && (
        <>
          <h3>Current adjustments</h3>
          <div className="list">
            {[...disruptions].sort((a, b) => (a.from < b.from ? 1 : -1)).map((x) => (
              <div key={x.id} className="list-item" style={{ cursor: "default" }}>
                <span aria-hidden>{x.type === "sick" ? "🤒" : "✈️"}</span>
                <div className="grow small">
                  <b>{x.type === "sick" ? "Sick" : "Travel"}</b> {fmtDate(x.from)} – {fmtDate(x.to)}
                  {x.note && <div className="muted">{x.note}</div>}
                </div>
                <button className="btn sm danger" onClick={() => deleteDisruption(x.id)}>Remove</button>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
