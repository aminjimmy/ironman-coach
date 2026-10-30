import { useRef, useState } from "react";
import { useApp } from "../lib/store";
import type { Derived } from "../lib/useDerived";
import type { FoodEntry, FoodItem } from "../lib/types";
import { macroTargets, sessionFueling, sumMacros } from "../lib/coach";
import { sessionsOn } from "../lib/plan";
import { addDays, daysBetween, fmtDate, round, uid, ymd, SPORT_META } from "../lib/format";
import { searchFoods } from "../lib/foods";
import { typicalSweatRate, fluidPlan } from "../lib/heat";
import type { FoodTemplate } from "../lib/types";
import { Card, MacroRing, Sheet, Spinner, Stat, toast } from "../components/ui";
import { BarcodeScanner } from "../components/BarcodeScanner";

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
  const [scanning, setScanning] = useState(false);

  const dayFoods = foods.filter((f) => f.date === date).sort((a, b) => (a.time < b.time ? -1 : 1));
  const dayActs = acts.filter((a) => a.start.slice(0, 10) === date);
  const planned = sessionsOn(d.plan, date);
  // carb-load: 2 days before long-course races, 1 day before short ones
  const daysToRace = d.plan ? daysBetween(date, d.plan.event.date) : -1;
  const loadDays = d.plan && d.plan.spec.bikeKm >= 90 ? 2 : 1;
  const carbLoad = daysToRace >= 1 && daysToRace <= loadDays ? (loadDays === 2 ? 9 : 7) : undefined;
  const tg = macroTargets(profile, dayActs, planned, carbLoad);
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

      {carbLoad && (
        <div className="card small" style={{ borderColor: "var(--warn)" }}>
          🍚 <b>Carb-loading day</b> ({daysToRace} day{daysToRace > 1 ? "s" : ""} to race): aim for {Math.round(profile.weightKg * carbLoad)} g carbs ({carbLoad} g/kg) from rice, noodles, bread, juice; keep fibre and fat low.
        </div>
      )}

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
            <button className="btn block" onClick={() => setScanning(true)}>▦ Scan barcode (packaged food)</button>
            <div className="row">
              <button className="btn grow" onClick={() => galRef.current?.click()}>🖼️ From gallery</button>
              <button className="btn grow" onClick={manual}>✏️ Manual entry</button>
            </div>
            {!apiKey && (
              <div className="small" style={{ color: "var(--warn)" }}>
                Photo analysis needs an Anthropic API key (<a href="#/settings" onClick={(e) => { e.preventDefault(); go("settings"); }}>Settings</a>). Without one, use barcode scan, Quick add → Local dishes, or manual entry.
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

      <div className="grid two">
        <QuickAdd date={date} onPick={(items, title, meal) => setDraft({ id: uid(), date, time: new Date().toTimeString().slice(0, 5), meal: meal ?? guessMeal(), title, items })} />
        <WaterCard date={date} trainingHours={tg.trainingHours} />
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

      {scanning && (
        <Sheet onClose={() => setScanning(false)}>
          <BarcodeScanner
            onClose={() => setScanning(false)}
            onFound={(item, title, missing) => {
              setScanning(false);
              setDraft({
                id: uid(), date, time: new Date().toTimeString().slice(0, 5), meal: guessMeal(), title, items: [item],
                notes: missing
                  ? "Found the product, but Open Food Facts has no nutrition data for it yet. Copy kcal, carbs, protein and fat from the label (per portion)."
                  : "From Open Food Facts (product label). Adjust grams to what you ate.",
              });
            }}
          />
        </Sheet>
      )}

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
        <div className="row">
          {e.confidence && <span className={`pill ${e.confidence === "high" ? "ok" : "est"}`}>{e.confidence} confidence</span>}
          <FavStar entry={e} />
        </div>
      </div>
      {e.photo && <img className="photo-lg" src={e.photo} alt="" style={{ maxHeight: 160 }} />}
      {e.notes && <div className="small muted">{e.confidence ? "🤖 " : "ℹ️ "}{e.notes}</div>}
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
      {e.confidence && <p className="tiny muted">AI estimates from photos are typically within ±20–30%. Adjust portions if you know them.</p>}
    </div>
  );
}

function FavStar({ entry }: { entry: FoodEntry }) {
  const favs = useApp((s) => s.foodFavorites);
  const toggleFavorite = useApp((s) => s.toggleFavorite);
  const title = entry.title || entry.items.map((x) => x.name).filter(Boolean).join(", ");
  const on = favs.some((f) => f.title.toLowerCase() === title.toLowerCase());
  return (
    <button
      className="btn sm ghost"
      disabled={!title}
      aria-pressed={on}
      onClick={() => {
        toggleFavorite({ id: uid(), title, items: entry.items, meal: entry.meal });
        toast(on ? "Removed from favourites" : "Saved to favourites");
      }}
    >
      {on ? "★ Favourite" : "☆ Favourite"}
    </button>
  );
}

/** One-tap re-logging of favourites and recent meals, plus typical Malaysian dishes. */
function QuickAdd({ date, onPick }: { date: string; onPick: (items: FoodEntry["items"], title: string, meal?: FoodEntry["meal"]) => void }) {
  const favs = useApp((s) => s.foodFavorites);
  const foods = useApp((s) => s.foods);
  const addFood = useApp((s) => s.addFood);
  const [tab, setTab] = useState<"fav" | "recent" | "local">(favs.length ? "fav" : "recent");
  const [q, setQ] = useState("");

  const recent: FoodTemplate[] = [];
  const seen = new Set<string>();
  for (const f of [...foods].sort((a, b) => (a.date + a.time < b.date + b.time ? 1 : -1))) {
    const k = f.title.toLowerCase();
    if (!f.title || seen.has(k)) continue;
    seen.add(k);
    recent.push({ id: f.id, title: f.title, items: f.items, meal: f.meal });
    if (recent.length >= 8) break;
  }

  const logNow = (t: FoodTemplate) => {
    addFood({ id: uid(), date, time: new Date().toTimeString().slice(0, 5), meal: t.meal ?? guessMeal(), title: t.title, items: t.items.map((i) => ({ ...i })) });
    toast(`Logged ${t.title} (tap the meal below to edit or delete)`);
  };
  const list = tab === "fav" ? favs : recent;

  return (
    <Card title="Quick add">
      <div className="tabs" style={{ marginBottom: 8 }}>
        <button className={tab === "fav" ? "on" : ""} onClick={() => setTab("fav")}>★ Favourites</button>
        <button className={tab === "recent" ? "on" : ""} onClick={() => setTab("recent")}>Recent</button>
        <button className={tab === "local" ? "on" : ""} onClick={() => setTab("local")}>🇲🇾 Local dishes</button>
      </div>
      {tab === "local" ? (
        <>
          <input placeholder="Search: nasi lemak, roti, teh tarik…" value={q} onChange={(e) => setQ(e.target.value)} />
          <div className="list">
            {searchFoods(q).map((f) => (
              <button key={f.name} className="list-item" onClick={() => onPick([{ ...f }], f.name)}>
                <div className="grow small">
                  <div style={{ fontWeight: 600 }}>{f.name}</div>
                  <div className="muted num">{f.calories} kcal · C {f.carbs} · P {f.protein} · F {f.fat} · ~{f.grams} g</div>
                </div>
                <span className="muted">＋</span>
              </button>
            ))}
          </div>
          <p className="tiny muted">Typical hawker portions; adjust grams to what you ate.</p>
        </>
      ) : list.length ? (
        <div className="list">
          {list.map((t) => {
            const m = sumMacros([{ id: "", date, time: "", meal: "snack", title: t.title, items: t.items }]);
            return (
              <button
                key={t.id}
                className="list-item"
                onClick={() => logNow(t)}
              >
                <div className="grow small">
                  <div style={{ fontWeight: 600 }}>{t.title}</div>
                  <div className="muted num">{Math.round(m.calories)} kcal · C {Math.round(m.carbs)} · P {Math.round(m.protein)} · F {Math.round(m.fat)}</div>
                </div>
                <span className="pill">Log</span>
              </button>
            );
          })}
        </div>
      ) : (
        <p className="small muted">{tab === "fav" ? "Star a meal in its editor to keep it here." : "Meals you log appear here for one-tap re-logging."}</p>
      )}
    </Card>
  );
}

function WaterCard({ date, trainingHours }: { date: string; trainingHours: number }) {
  const profile = useApp((s) => s.profile)!;
  const ml = useApp((s) => s.water[date] ?? 0);
  const tests = useApp((s) => s.sweatTests);
  const sodium = useApp((s) => s.racePrefs.sodiumMgPerL);
  const addWater = useApp((s) => s.addWater);
  const sweat = typicalSweatRate(tests, profile.weightKg).lph;
  // daily baseline + replacing most of what training sweats out
  const target = Math.round((profile.weightKg * 35 + trainingHours * fluidPlan(sweat, sodium).drinkLph * 1000 * 1.2) / 50) * 50;
  const pct = Math.min(100, (ml / target) * 100);
  return (
    <Card title="💧 Water" right={<span className="small num muted">{(ml / 1000).toFixed(2)} / {(target / 1000).toFixed(1)} L</span>}>
      <div className="bar" style={{ height: 12 }}><i style={{ width: `${pct}%`, background: "#3987e5" }} /></div>
      <div className="row" style={{ marginTop: 10 }}>
        <button className="btn grow" onClick={() => addWater(date, 250)}>+ 250 ml</button>
        <button className="btn grow" onClick={() => addWater(date, 500)}>+ 500 ml</button>
        <button className="btn" onClick={() => addWater(date, -250)} aria-label="Remove 250 ml">−</button>
      </div>
      <p className="tiny muted">Target: 35 ml/kg plus ~{Math.round(fluidPlan(sweat, sodium).drinkLph * 1000)} ml per training hour. Add electrolytes after long or hot sessions.</p>
    </Card>
  );
}
