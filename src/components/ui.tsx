import { useEffect, useState, type ReactNode } from "react";
import type { Zone } from "../lib/metrics";
import { zoneRangeLabel } from "../lib/metrics";
import type { PlannedSession } from "../lib/plan";
import type { Activity } from "../lib/types";
import { fmtDuration, fmtHours, SPORT_META } from "../lib/format";
import { sessionFueling } from "../lib/coach";

export function Card({ title, right, children, className = "" }: { title?: ReactNode; right?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`card ${className}`}>
      {(title || right) && (
        <div className="card-head">
          {title && <h2>{title}</h2>}
          {right}
        </div>
      )}
      {children}
    </section>
  );
}

export function Stat({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <div className="stat">
      <div className="v">{value}</div>
      <div className="l">{label}</div>
      {sub && <div className="s">{sub}</div>}
    </div>
  );
}

let pushToast: (msg: string) => void = () => {};
export const toast = (msg: string) => pushToast(msg);

export function ToastHost() {
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => {
    let t: number;
    pushToast = (m) => {
      setMsg(m);
      clearTimeout(t);
      t = window.setTimeout(() => setMsg(null), 4000);
    };
  }, []);
  return msg ? <div className="toast" role="status">{msg}</div> : null;
}

export function Sheet({ onClose, children }: { onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="overlay" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()} role="dialog">
        {children}
      </div>
    </div>
  );
}

export function ZoneBars({ zones, secs, kind }: { zones: Zone[]; secs: number[]; kind: "hr" | "power" | "run" | "swim" }) {
  const total = secs.reduce((a, b) => a + b, 0) || 1;
  const max = Math.max(...secs, 1);
  return (
    <div className="zones">
      {zones.map((z, i) => (
        <div className="zone-row" key={z.name} title={`${z.name} ${z.label}: ${fmtDuration(secs[i])}`}>
          <span className="zn">{z.name}</span>
          <div className="track">
            <div className="fill" style={{ width: `${(secs[i] / max) * 100}%`, background: z.color }} />
            <span className="range">{z.label} · {zoneRangeLabel(z, kind)}</span>
          </div>
          <span className="lab">{Math.round((secs[i] / total) * 100)}% <span className="muted">{fmtHours(secs[i])}</span></span>
        </div>
      ))}
    </div>
  );
}

export function SessionCard({ s, done, scale = 1, expanded, onToggle }: {
  s: PlannedSession; done?: Activity; scale?: number; expanded?: boolean; onToggle?: () => void;
}) {
  const meta = s.sport === "rest" ? { color: "#3a4352", icon: "😴", label: "Rest" } : SPORT_META[s.sport];
  const minutes = s.kind === "race" ? s.minutes : Math.round((s.minutes * scale) / 5) * 5;
  return (
    <button className={`session ${done ? "done" : ""}`} style={{ ["--c" as string]: meta.color }} onClick={onToggle}>
      <span className="ic" aria-hidden>{meta.icon}</span>
      <div className="grow">
        <div className="spread">
          <span className="title">{s.title}</span>
          {done ? <span className="check">✓ {fmtHours(done.movingTime)}</span> : s.minutes > 0 && <span className="muted small num">{fmtHours(minutes * 60)}</span>}
        </div>
        <div className="row" style={{ marginTop: 3 }}>
          {s.key && <span className="pill key">Key</span>}
          {s.zone > 0 && <span className="pill">Z{s.zone}</span>}
          {scale !== 1 && s.kind !== "race" && s.sport !== "rest" && <span className="pill est">adjusted {scale > 1 ? "+" : ""}{Math.round((scale - 1) * 100)}%</span>}
        </div>
        {expanded && (
          <>
            <div className="desc">{s.description}</div>
            {s.sport !== "rest" && s.sport !== "strength" && <div className="desc">⛽ {sessionFueling(minutes, s.kind)}</div>}
          </>
        )}
      </div>
    </button>
  );
}

export function MacroRing({ label, value, target, color, unit = "g" }: { label: string; value: number; target: number; color: string; unit?: string }) {
  const pct = Math.min(1, target ? value / target : 0);
  const r = 30;
  const c = 2 * Math.PI * r;
  const over = value > target * 1.1;
  return (
    <div className="macro">
      <svg viewBox="0 0 80 80" role="img" aria-label={`${label} ${Math.round(value)} of ${target}${unit}`}>
        <circle cx="40" cy="40" r={r} fill="none" stroke="var(--surface-2)" strokeWidth="8" />
        <circle
          cx="40" cy="40" r={r} fill="none" stroke={color} strokeWidth="8" strokeLinecap="round"
          strokeDasharray={`${pct * c} ${c}`} transform="rotate(-90 40 40)"
        />
        <text x="40" y="44" textAnchor="middle" fontSize="15" fontWeight="650" fill="var(--text)">{Math.round(pct * 100)}%</text>
      </svg>
      <div className="n">{Math.round(value)}<span className="muted">/{target}{unit}</span></div>
      <div className="tiny muted" style={over ? { color: "var(--warn)" } : undefined}>{label}</div>
    </div>
  );
}

export function Spinner() {
  return <span className="spinner" aria-label="loading" />;
}
