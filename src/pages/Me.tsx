import { useState } from "react";
import { useApp } from "../lib/store";
import type { Derived } from "../lib/useDerived";
import type { EventType, Profile, RaceEvent } from "../lib/types";
import { EVENTS } from "../lib/plan";
import { age, hrZones, powerZones, runZones, swimZones, zoneRangeLabel, estimateFtp, estimateRunPace, estimateCss, usable } from "../lib/metrics";
import { bmr } from "../lib/coach";
import { DAY_NAMES_LONG, daysBetween, fmtDate, fmtPace, parseMinSec, round, uid, ymd, addDays } from "../lib/format";
import { Card, Sheet, Stat, toast } from "../components/ui";
import { WeightChart } from "../components/charts";

export const DEFAULT_PROFILE: Profile = {
  name: "",
  sex: "male",
  birthYear: new Date().getFullYear() - 30,
  heightCm: 175,
  weightKg: 72,
  weeklyHours: 12,
  experience: "intermediate",
  restDay: 0,
  nutritionGoal: "maintain",
};

function NumField({ label, value, onChange, hint, step = 1, placeholder }: {
  label: string; value: number | undefined; onChange: (v: number | undefined) => void; hint?: string; step?: number; placeholder?: string;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <input type="number" inputMode="decimal" step={step} value={value ?? ""} placeholder={placeholder}
        onChange={(e) => onChange(e.target.value === "" ? undefined : Number(e.target.value))} />
      {hint && <span className="hint">{hint}</span>}
    </label>
  );
}

function PaceField({ label, value, onChange, hint, placeholder }: {
  label: string; value: number | undefined; onChange: (v: number | undefined) => void; hint?: string; placeholder?: string;
}) {
  const [txt, setTxt] = useState(value ? fmtPace(value) : "");
  return (
    <label className="field">
      <span>{label}</span>
      <input inputMode="numeric" value={txt} placeholder={placeholder}
        onChange={(e) => { setTxt(e.target.value); onChange(parseMinSec(e.target.value)); }} />
      {hint && <span className="hint">{hint}</span>}
    </label>
  );
}

export function ProfileForm({ initial, onSave, submitLabel = "Save profile", compact }: {
  initial: Profile; onSave: (p: Profile) => void; submitLabel?: string; compact?: boolean;
}) {
  const [p, setP] = useState<Profile>(initial);
  const set = <K extends keyof Profile>(k: K, v: Profile[K]) => setP({ ...p, [k]: v });
  const valid = p.weightKg > 25 && p.heightCm > 100 && p.birthYear > 1920 && p.weeklyHours > 0;
  return (
    <div className="stack">
      <div className="form-grid">
        <label className="field" style={{ gridColumn: "1 / -1" }}>
          <span>Name</span>
          <input value={p.name} onChange={(e) => set("name", e.target.value)} placeholder="Your name" />
        </label>
        <label className="field">
          <span>Sex</span>
          <select value={p.sex} onChange={(e) => set("sex", e.target.value as Profile["sex"])}>
            <option value="male">Male</option>
            <option value="female">Female</option>
          </select>
        </label>
        <NumField label="Birth year" value={p.birthYear} onChange={(v) => set("birthYear", v ?? 0)} />
        <NumField label="Height (cm)" value={p.heightCm} onChange={(v) => set("heightCm", v ?? 0)} />
        <NumField label="Weight (kg)" value={p.weightKg} step={0.1} onChange={(v) => set("weightKg", v ?? 0)} />
        <NumField label="Hours / week available" value={p.weeklyHours} step={0.5} onChange={(v) => set("weeklyHours", v ?? 0)} hint="Max you can train in a peak week" />
        <label className="field">
          <span>Experience</span>
          <select value={p.experience} onChange={(e) => set("experience", e.target.value as Profile["experience"])}>
            <option value="beginner">Beginner (first tri / first long-course)</option>
            <option value="intermediate">Intermediate</option>
            <option value="advanced">Advanced / competitive</option>
          </select>
        </label>
        <label className="field">
          <span>Rest day</span>
          <select value={p.restDay} onChange={(e) => set("restDay", Number(e.target.value))}>
            {DAY_NAMES_LONG.map((d, i) => <option key={d} value={i}>{d}</option>)}
          </select>
          <span className="hint">Long ride & run fall on the 2 days before it</span>
        </label>
        <label className="field">
          <span>Nutrition goal</span>
          <select value={p.nutritionGoal} onChange={(e) => set("nutritionGoal", e.target.value as Profile["nutritionGoal"])}>
            <option value="maintain">Maintain weight</option>
            <option value="lose">Lose weight (gently)</option>
            <option value="gain">Gain weight</option>
          </select>
        </label>
      </div>
      {!compact && (
        <>
          <h3 style={{ marginTop: 6 }}>Physiology <span className="muted small">(optional, estimated if blank)</span></h3>
          <div className="form-grid">
            <NumField label="Resting HR" value={p.restingHr} onChange={(v) => set("restingHr", v)} placeholder="60" />
            <NumField label="Max HR" value={p.maxHr} onChange={(v) => set("maxHr", v)} placeholder="auto" />
            <NumField label="Threshold HR (LTHR)" value={p.lthr} onChange={(v) => set("lthr", v)} placeholder="auto" hint="Avg HR of last 20 min of a 30-min all-out run" />
            <NumField label="Bike FTP (W)" value={p.ftp} onChange={(v) => set("ftp", v)} placeholder="auto" hint="95% of a 20-min all-out" />
            <PaceField label="Run threshold pace (/km)" value={p.runThresholdPace} onChange={(v) => set("runThresholdPace", v)} placeholder="m:ss" hint="~ your 10k–15k race pace" />
            <PaceField label="Swim CSS (/100m)" value={p.swimCss} onChange={(v) => set("swimCss", v)} placeholder="m:ss" hint="From a 400 m + 200 m test" />
          </div>
        </>
      )}
      <button className="btn primary" disabled={!valid} onClick={() => onSave(p)}>{submitLabel}</button>
    </div>
  );
}

export function EventForm({ initial, onSave, onCancel, submitLabel = "Save event" }: {
  initial?: RaceEvent; onSave: (e: RaceEvent) => void; onCancel?: () => void; submitLabel?: string;
}) {
  const [e, setE] = useState<RaceEvent>(
    initial ?? { id: uid(), name: "", type: "full", date: addDays(ymd(), 7 * 24), trainingStart: ymd() },
  );
  const weeks = Math.floor(daysBetween(e.trainingStart, e.date) / 7);
  const spec = EVENTS[e.type];
  return (
    <div className="stack">
      <div className="tabs">
        {(Object.keys(EVENTS) as EventType[]).map((t) => (
          <button key={t} className={e.type === t ? "on" : ""} onClick={() => setE({ ...e, type: t })}>{EVENTS[t].label}</button>
        ))}
      </div>
      <div className="small muted">{spec.swimKm} km swim · {spec.bikeKm} km bike · {spec.runKm} km run</div>
      <div className="form-grid">
        <label className="field" style={{ gridColumn: "1 / -1" }}>
          <span>Race name</span>
          <input value={e.name} onChange={(ev) => setE({ ...e, name: ev.target.value })} placeholder={`e.g. ${e.type === "half" ? "IRONMAN 70.3 Putrajaya" : e.type === "full" ? "IRONMAN Malaysia" : "Local triathlon"}`} />
        </label>
        <label className="field">
          <span>Race date</span>
          <input type="date" value={e.date} onChange={(ev) => setE({ ...e, date: ev.target.value })} />
        </label>
        <label className="field">
          <span>Start training</span>
          <input type="date" value={e.trainingStart} onChange={(ev) => setE({ ...e, trainingStart: ev.target.value })} />
        </label>
      </div>
      <div className="small" style={{ color: weeks < spec.recommendedWeeks ? "var(--warn)" : "var(--text-2)" }}>
        {weeks < 0 ? "Race date must be after the training start." : `${weeks} weeks of training. ${weeks < spec.recommendedWeeks ? `Shorter than the typical ${spec.recommendedWeeks}+ weeks; the plan will compress phases.` : weeks > 40 ? "Long runway: the plan adds a prep phase before base training." : "Good runway."}`}
      </div>
      <div className="row">
        <button className="btn primary grow" disabled={weeks < 0} onClick={() => onSave(e)}>{submitLabel}</button>
        {onCancel && <button className="btn" onClick={onCancel}>Cancel</button>}
      </div>
    </div>
  );
}

export function Me({ d, go }: { d: Derived; go: (r: string) => void }) {
  const profile = useApp((s) => s.profile)!;
  const setProfile = useApp((s) => s.setProfile);
  const weights = useApp((s) => s.weights);
  const logWeight = useApp((s) => s.logWeight);
  const events = useApp((s) => s.events);
  const activeId = useApp((s) => s.activeEventId);
  const acts = useApp((s) => s.activities);
  const { upsertEvent, deleteEvent, setActiveEvent } = useApp.getState();
  const [editing, setEditing] = useState<RaceEvent | "new" | null>(null);
  const [editProfile, setEditProfile] = useState(false);
  const [w, setW] = useState("");
  const t = d.t;
  const bmi = profile.weightKg / (profile.heightCm / 100) ** 2;

  const trusted = usable(acts, t);
  const est = { ftp: estimateFtp(trusted), run: estimateRunPace(trusted), css: estimateCss(trusted) };

  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <h1>{profile.name || "My profile"}</h1>
          <div className="sub">{age(profile)} y · {profile.heightCm} cm · {profile.weightKg} kg · {profile.experience}</div>
        </div>
        <button className="icon-btn" onClick={() => go("settings")} aria-label="Settings">⚙️</button>
      </div>

      <div className="grid two">
        <Card title="Body" right={<button className="btn sm" onClick={() => setEditProfile(true)}>Edit profile</button>}>
          <div className="stats">
            <Stat label="Weight" value={`${profile.weightKg} kg`} />
            <Stat label="Height" value={`${profile.heightCm} cm`} />
            <Stat label="BMI" value={round(bmi, 1)} />
            <Stat label="BMR" value={bmr(profile)} sub="kcal/day" />
            <Stat label="W/kg (FTP)" value={round(t.ftp / profile.weightKg, 2)} />
          </div>
          <hr className="hr" />
          <div className="row" style={{ flexWrap: "nowrap" }}>
            <input type="number" inputMode="decimal" step="0.1" placeholder="Log today's weight (kg)" value={w} onChange={(e) => setW(e.target.value)} />
            <button className="btn" disabled={!(Number(w) > 25)} onClick={() => { logWeight(Number(w)); setW(""); toast("Weight logged"); }}>Log</button>
          </div>
          {weights.length > 1 && <div style={{ marginTop: 10 }}><WeightChart points={weights.slice(-60)} /></div>}
        </Card>

        <Card title="Target events" right={<button className="btn sm" onClick={() => setEditing("new")}>+ Add</button>}>
          {events.length === 0 && <p className="muted small">No events yet.</p>}
          <div className="list">
            {events.map((e) => (
              <div key={e.id} className="list-item" style={{ cursor: "default" }}>
                <input type="radio" name="active" checked={e.id === activeId} onChange={() => setActiveEvent(e.id)} style={{ width: 20, minHeight: 20 }} aria-label="Set as active plan" />
                <div className="grow">
                  <div style={{ fontWeight: 600 }}>{e.name || EVENTS[e.type].label}</div>
                  <div className="small muted">{EVENTS[e.type].label} · {fmtDate(e.date, { day: "numeric", month: "short", year: "numeric" })} · {Math.max(0, daysBetween(ymd(), e.date))} days</div>
                </div>
                <button className="btn sm ghost" onClick={() => setEditing(e)}>Edit</button>
              </div>
            ))}
          </div>
          {events.length > 1 && <p className="tiny muted">The selected event drives your plan.</p>}
        </Card>
      </div>

      <Card title="Thresholds & zones">
        <div className="stats" style={{ marginBottom: 12 }}>
          <Stat label="Max HR" value={t.maxHr} sub={t.estimated.maxHr ? <span className="pill est">estimated</span> : "set"} />
          <Stat label="LTHR" value={t.lthr} sub={t.estimated.lthr ? <span className="pill est">estimated</span> : "set"} />
          <Stat label="FTP" value={`${t.ftp} W`} sub={t.estimated.ftp ? <span className="pill est">{est.ftp ? "from rides" : "guess"}</span> : "set"} />
          <Stat label="Run threshold" value={fmtPace(t.runPace)} sub={t.estimated.runPace ? <span className="pill est">{est.run ? "from runs" : "guess"}</span> : "/km · set"} />
          <Stat label="Swim CSS" value={fmtPace(t.swimCss)} sub={t.estimated.swimCss ? <span className="pill est">{est.css ? "from swims" : "guess"}</span> : "/100m · set"} />
        </div>
        <div className="grid two">
          <ZoneTable title="Heart rate" rows={hrZones(t).map((z) => [z.name, z.label, zoneRangeLabel(z, "hr")])} />
          <ZoneTable title="Bike power" rows={powerZones(t.ftp).map((z) => [z.name, z.label, zoneRangeLabel(z, "power")])} />
          <ZoneTable title="Run pace" rows={runZones(t.runPace).map((z) => [z.name, z.label, zoneRangeLabel(z, "run")])} />
          <ZoneTable title="Swim pace" rows={swimZones(t.swimCss).map((z) => [z.name, z.label, zoneRangeLabel(z, "swim")])} />
        </div>
        <p className="tiny muted" style={{ marginTop: 8 }}>Estimated values are lower bounds from your recent hardest sessions. A field test gives the most accurate zones.</p>
      </Card>

      {editProfile && (
        <Sheet onClose={() => setEditProfile(false)}>
          <h2 style={{ marginBottom: 12 }}>Edit profile</h2>
          <ProfileForm initial={profile} onSave={(p) => { setProfile(p); setEditProfile(false); toast("Profile saved. Plan updated."); }} />
        </Sheet>
      )}
      {editing && (
        <Sheet onClose={() => setEditing(null)}>
          <h2 style={{ marginBottom: 12 }}>{editing === "new" ? "New event" : "Edit event"}</h2>
          <EventForm
            initial={editing === "new" ? undefined : editing}
            onCancel={() => setEditing(null)}
            onSave={(e) => { upsertEvent(e); if (editing === "new") setActiveEvent(e.id); setEditing(null); toast("Plan regenerated"); }}
          />
          {editing !== "new" && (
            <button className="btn danger block" style={{ marginTop: 10 }} onClick={() => { deleteEvent(editing.id); setEditing(null); }}>Delete event</button>
          )}
        </Sheet>
      )}
    </div>
  );
}

function ZoneTable({ title, rows }: { title: string; rows: string[][] }) {
  return (
    <div>
      <h3 style={{ marginBottom: 4 }}>{title}</h3>
      <table className="data">
        <tbody>
          {rows.map((r) => (
            <tr key={r[0]}><td style={{ width: 34, fontWeight: 600 }}>{r[0]}</td><td className="muted">{r[1]}</td><td style={{ textAlign: "right" }}>{r[2]}</td></tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
