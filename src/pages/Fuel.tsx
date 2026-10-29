import { useRef, useState } from "react";
import { useApp } from "../lib/store";
import type { Derived } from "../lib/useDerived";
import type { FoodEntry, FoodItem } from "../lib/types";
import { macroTargets, sessionFueling, sumMacros } from "../lib/coach";
import { sessionsOn } from "../lib/plan";
import { addDays, fmtDate, round, uid, ymd, SPORT_META } from "../lib/format";
import { Card, MacroRing, Sheet, Spinner, Stat, toast } from "../components/ui";

const MEALS: FoodEntry["meal"][] = ["breakfast", "lunch", "dinner", "snack", "fuel"];

function guessMeal(): FoodEntry["meal"] {
  const h = new Date().getHours();
  return h < 10 ? "breakfast" : h < 15 ? "lunch" : h < 17 ? "snack" : "dinner";
}

export function Fuel({ d, go }: { d: Derived; go: (r: string) => void }) {
  const profile = useApp((s) => s.profile)!;
  const foods = useApp((s) => s.foods);
  const acts = useApp((s) => s.activities);
  const apiKey = useApp((s) => s.settings.anthropicKey);
  const deleteFood = useApp((s) => s.deleteFood);
  const [date, setDate] = useState(ymd());
  const [draft, setDraft] = useState<FoodEntry | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [hint, setHint] = useState("");
  const [busy, setBusy] = useState(false);
  const camRef = useRef<HTMLInputElement>(null);
  const galRef = useRef<HTMLInputElement>(null);
  const [pendingFile, setPendingFile] = useState<File | null>(null);

  const dayFoods = foods.filter((f) => f.date === date).sort((a, b) => (a.time < b.time ? -1 : 1));
  const dayActs = acts.filter((a) => a.start.slice(0, 10) === date);
  const planned = sessionsOn(d.plan, date);
  const tg = macroTargets(profile, dayActs, planned);
  const eaten = sumMacros(dayFoods);

  const pick = async (file?: File | null) => {
    if (!file) return;
    const { resizeImage } = await import("../lib/foodAI");
    setPendingFile(file);
    setPreview(await resizeImage(file, 900, 0.8));
    setHint("");
    setDraft(null);
  };

  const runAnalysis = async () => {
    if (!pendingFile) return;
    setBusy(true);
    try {
      const { analyzeFood, resizeImage } = await import("../lib/foodAI");
      const big = await resizeImage(pendingFile, 1280, 0.85);
      const thumb = await resizeImage(pendingFile, 240, 0.7);
      const r = await analyzeFood(apiKey, big, hint);
      if (!r.items.length) toast(r.notes || "No food detected in the photo");
      setDraft({
        id: uid(),
        date,
        time: new Date().toTimeString().slice(0, 5),
        meal: guessMeal(),
        title: r.title,
        items: r.items.map((i) => ({ ...i, grams: Math.round(i.grams) })),
        photo: thumb,
        confidence: r.confidence,
        notes: r.notes,
      });
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const manual = () =>
    setDraft({
      id: uid(), date, time: new Date().toTimeString().slice(0, 5), meal: guessMeal(), title: "",
      items: [{ name: "", grams: 100, calories: 0, protein: 0, carbs: 0, fat: 0, fiber: 0 }],
    });

  const closeAll = () => {
    setDraft(null);
    setPreview(null);
    setPendingFile(null);
  };

  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <h1>Fuel</h1>
          <div className="sub">Targets adapt to the day's training</div>
        </div>
        <div className="row" style={{ flexWrap: "nowrap", flex: "none" }}>
          <button className="icon-btn" onClick={() => setDate(addDays(date, -1))} aria-label="Previous day">‹</button>
          <span className="small num" style={{ minWidth: 76, textAlign: "center" }}>{date === ymd() ? "Today" : fmtDate(date, { weekday: "short", day: "numeric", month: "short" })}</span>
          <button className="icon-btn" onClick={() => setDate(addDays(date, 1))} aria-label="Next day">›</button>
        </div>
      </div>

      <div className="grid two">
        <Card title="Daily targets" right={<span className="pill">{round(tg.trainingHours, 1)} h training</span>}>
          <div className="ring-wrap">
            <MacroRing label="kcal" value={eaten.calories} target={tg.calories} color="#eef2f6" unit="" />
            <MacroRing label="Carbs" value={eaten.carbs} target={tg.carbs} color="#c98500" />
            <MacroRing label="Protein" value={eaten.protein} target={tg.protein} color="#3987e5" />
            <MacroRing label="Fat" value={eaten.fat} target={tg.fat} color="#d55181" />
          </div>
          <p className="tiny muted" style={{ marginTop: 10 }}>
            BMR {tg.bmr} kcal × 1.35 + training {tg.trainingKcal} kcal{profile.nutritionGoal !== "maintain" ? ` ${profile.nutritionGoal === "lose" ? "− 350" : "+ 300"} (goal)` : ""}.
            Carbs {tg.carbsPerKg} g/kg for this training load, protein {round(tg.protein / profile.weightKg, 1)} g/kg.
          </p>
        </Card>

        <Card title="Log food">
          <div className="stack" style={{ gap: 8 }}>
            <button className="btn primary block" onClick={() => camRef.current?.click()}>📷 Snap a meal</button>
            <div className="row">
              <button className="btn grow" onClick={() => galRef.current?.click()}>🖼️ From gallery</button>
              <button className="btn grow" onClick={manual}>✏️ Manual entry</button>
            </div>
            {!apiKey && (
              <div className="small" style={{ color: "var(--warn)" }}>
                Photo analysis needs an Anthropic API key. <a href="#/settings" onClick={(e) => { e.preventDefault(); go("settings"); }}>Add it in Settings</a>.
              </div>
            )}
          </div>
          <input ref={camRef} type="file" accept="image/*" capture="environment" hidden onChange={(e) => { pick(e.target.files?.[0]); e.target.value = ""; }} />
          <input ref={galRef} type="file" accept="image/*" hidden onChange={(e) => { pick(e.target.files?.[0]); e.target.value = ""; }} />
          {planned.filter((s) => s.sport !== "rest" && s.sport !== "strength").length > 0 && (
            <>
              <hr className="hr" />
              <h3 style={{ marginBottom: 6 }}>Session fueling</h3>
              {planned.filter((s) => s.sport !== "rest" && s.sport !== "strength").map((s) => (
                <div key={s.id} className="small" style={{ marginBottom: 6 }}>
                  <b>{s.sport !== "rest" && SPORT_META[s.sport].icon} {s.title}</b> <span className="muted">({s.minutes} min)</span>
                  <div style={{ color: "var(--text-2)" }}>{sessionFueling(s.minutes, s.kind)}</div>
                </div>
              ))}
            </>
          )}
        </Card>
      </div>

      <Card title="Meals" right={<span className="small muted num">{Math.round(eaten.calories)} kcal</span>}>
        {dayFoods.length === 0 && <div className="muted small">Nothing logged for this day.</div>}
        <div className="list">
          {dayFoods.map((f) => {
            const m = sumMacros([f]);
            return (
              <button key={f.id} className="list-item" onClick={() => setDraft(f)}>
                {f.photo ? <img className="photo" src={f.photo} alt="" /> : <span className="ic" style={{ background: "var(--surface-2)" }}>🍽️</span>}
                <div className="grow">
                  <div style={{ fontWeight: 600 }}>{f.title || "Meal"}</div>
                  <div className="small muted">{f.time} · {f.meal}{f.confidence ? ` · ${f.confidence} confidence` : ""}</div>
                  <div className="small num" style={{ color: "var(--text-2)" }}>
                    {Math.round(m.calories)} kcal · C {Math.round(m.carbs)} · P {Math.round(m.protein)} · F {Math.round(m.fat)}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </Card>

      {preview && !draft && (
        <Sheet onClose={closeAll}>
          <div className="stack">
            <h2>Analyse meal</h2>
            <img className="photo-lg" src={preview} alt="Meal preview" />
            <label className="field">
              <span>Hint (optional)</span>
              <input value={hint} onChange={(e) => setHint(e.target.value)} placeholder="e.g. 2 eggs fried in butter, large bowl" />
            </label>
            <div className="row">
              <button className="btn primary grow" onClick={runAnalysis} disabled={busy || !apiKey}>
                {busy ? <><Spinner /> Analysing…</> : "Estimate macros"}
              </button>
              <button className="btn" onClick={closeAll}>Cancel</button>
            </div>
            {!apiKey && <div className="small" style={{ color: "var(--warn)" }}>Add your Anthropic API key in Settings first.</div>}
          </div>
        </Sheet>
      )}

      {draft && (
        <Sheet onClose={closeAll}>
          <FoodEditor
            entry={draft}
            onCancel={closeAll}
            onDelete={foods.some((f) => f.id === draft.id) ? () => { deleteFood(draft.id); closeAll(); } : undefined}
            onSave={(e) => {
              const st = useApp.getState();
              if (st.foods.some((f) => f.id === e.id)) st.updateFood(e);
              else st.addFood(e);
              closeAll();
              toast("Saved");
            }}
          />
        </Sheet>
      )}
    </div>
  );
}

function FoodEditor({ entry, onSave, onCancel, onDelete }: {
  entry: FoodEntry; onSave: (e: FoodEntry) => void; onCancel: () => void; onDelete?: () => void;
}) {
  const [e, setE] = useState<FoodEntry>(entry);
  const total = sumMacros([e]);

  const setItem = (i: number, patch: Partial<FoodItem>) => setE({ ...e, items: e.items.map((it, k) => (k === i ? { ...it, ...patch } : it)) });

  /** Changing grams rescales the item's macros proportionally. */
  const setGrams = (i: number, grams: number) => {
    const it = e.items[i];
    const f = it.grams > 0 ? grams / it.grams : 1;
    setItem(i, {
      grams,
      calories: round(it.calories * f), protein: round(it.protein * f, 1), carbs: round(it.carbs * f, 1),
      fat: round(it.fat * f, 1), fiber: round((it.fiber ?? 0) * f, 1),
    });
  };

  const numIn = (v: number, on: (n: number) => void, label: string) => (
    <label className="field">
      <span>{label}</span>
      <input type="number" inputMode="decimal" value={Number.isFinite(v) ? v : 0} onChange={(ev) => on(Number(ev.target.value))} />
    </label>
  );

  return (
    <div className="stack">
      <div className="spread">
        <h2>{onDelete ? "Edit meal" : "Review meal"}</h2>
        {e.confidence && <span className={`pill ${e.confidence === "high" ? "ok" : "est"}`}>{e.confidence} confidence</span>}
      </div>
      {e.photo && <img className="photo-lg" src={e.photo} alt="" style={{ maxHeight: 160 }} />}
      {e.notes && <div className="small muted">🤖 {e.notes}</div>}
      <div className="form-grid">
        <label className="field" style={{ gridColumn: "1 / -1" }}>
          <span>Name</span>
          <input value={e.title} onChange={(ev) => setE({ ...e, title: ev.target.value })} placeholder="Meal name" />
        </label>
        <label className="field">
          <span>Meal</span>
          <select value={e.meal} onChange={(ev) => setE({ ...e, meal: ev.target.value as FoodEntry["meal"] })}>
            {MEALS.map((m) => <option key={m} value={m}>{m === "fuel" ? "training fuel" : m}</option>)}
          </select>
        </label>
        <label className="field">
          <span>Time</span>
          <input type="time" value={e.time} onChange={(ev) => setE({ ...e, time: ev.target.value })} />
        </label>
      </div>

      <div className="stats">
        <Stat label="kcal" value={Math.round(total.calories)} />
        <Stat label="Carbs" value={`${Math.round(total.carbs)} g`} />
        <Stat label="Protein" value={`${Math.round(total.protein)} g`} />
        <Stat label="Fat" value={`${Math.round(total.fat)} g`} />
      </div>

      {e.items.map((it, i) => (
        <div key={i} className="card" style={{ background: "var(--surface-2)", padding: 10 }}>
          <div className="row" style={{ marginBottom: 8, flexWrap: "nowrap" }}>
            <input value={it.name} onChange={(ev) => setItem(i, { name: ev.target.value })} placeholder="Food item" />
            <button className="icon-btn" aria-label="Remove item" onClick={() => setE({ ...e, items: e.items.filter((_, k) => k !== i) })}>✕</button>
          </div>
          <label className="field" style={{ marginBottom: 8 }}>
            <span>Portion: {it.grams} g (adjusting rescales macros)</span>
            <input type="range" min={Math.max(5, Math.round((entry.items[i]?.grams || 100) * 0.25))} max={Math.max(50, Math.round((entry.items[i]?.grams || 100) * 3))} value={it.grams} onChange={(ev) => setGrams(i, Number(ev.target.value))} style={{ padding: 0, minHeight: 28 }} />
          </label>
          <div className="form-grid" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(84px, 1fr))" }}>
            {numIn(it.grams, (n) => setItem(i, { grams: n }), "grams")}
            {numIn(it.calories, (n) => setItem(i, { calories: n }), "kcal")}
            {numIn(it.carbs, (n) => setItem(i, { carbs: n }), "carbs g")}
            {numIn(it.protein, (n) => setItem(i, { protein: n }), "protein g")}
            {numIn(it.fat, (n) => setItem(i, { fat: n }), "fat g")}
          </div>
        </div>
      ))}
      <button className="btn sm" onClick={() => setE({ ...e, items: [...e.items, { name: "", grams: 100, calories: 0, protein: 0, carbs: 0, fat: 0, fiber: 0 }] })}>+ Add item</button>

      <div className="row">
        <button className="btn primary grow" onClick={() => onSave({ ...e, title: e.title || e.items.map((x) => x.name).filter(Boolean).join(", ") || "Meal" })}>Save</button>
        <button className="btn" onClick={onCancel}>Cancel</button>
        {onDelete && <button className="btn danger" onClick={onDelete}>Delete</button>}
      </div>
      <p className="tiny muted">AI estimates from photos are typically within ±20–30%. Adjust portions if you know them.</p>
    </div>
  );
}
