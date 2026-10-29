import { useMemo, useState } from "react";
import { useApp } from "../lib/store";
import type { Derived } from "../lib/useDerived";
import type { SweatTest } from "../lib/types";
import { buildRacePlan } from "../lib/raceplan";
import { currentPosition, dewPoint, fetchWeather, fluidPlan, heatAdjustPct, heatRisk, sweatRate, typicalSweatRate, type Weather } from "../lib/heat";
import { daysBetween, fmtDate, fmtDuration, fmtPace, parseMinSec, round, SPORT_META, uid, ymd } from "../lib/format";
import { Card, Spinner, Stat, toast } from "../components/ui";

type Tab = "plan" | "heat" | "tests";

export function Race({ d, go }: { d: Derived; go: (r: string) => void }) {
  const [tab, setTab] = useState<Tab>(() => (location.hash.includes("tests") ? "tests" : location.hash.includes("heat") ? "heat" : "plan"));
  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <h1>Race tools</h1>
          <div className="sub">{d.plan ? `${d.plan.event.name || d.plan.spec.label} · ${fmtDate(d.plan.event.date, { day: "numeric", month: "short", year: "numeric" })}` : "Pick an event in Me"}</div>
        </div>
        <button className="btn sm no-print" onClick={() => window.print()}>🖨 Print</button>
      </div>
      <div className="tabs no-print">
        <button className={tab === "plan" ? "on" : ""} onClick={() => setTab("plan")}>🏁 Race-day plan</button>
        <button className={tab === "heat" ? "on" : ""} onClick={() => setTab("heat")}>🌡️ Heat & hydration</button>
        <button className={tab === "tests" ? "on" : ""} onClick={() => setTab("tests")}>🧪 Fitness tests</button>
      </div>
      {tab === "plan" && <RacePlanView d={d} go={go} />}
      {tab === "heat" && <HeatView d={d} />}
      {tab === "tests" && <TestsView d={d} />}
    </div>
  );
}

function NumIn({ label, value, onChange, step = 1, hint }: { label: string; value: number; onChange: (v: number) => void; step?: number; hint?: string }) {
  return (
    <label className="field">
      <span>{label}</span>
      <input type="number" inputMode="decimal" step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
      {hint && <span className="hint">{hint}</span>}
    </label>
  );
}

function RacePlanView({ d, go }: { d: Derived; go: (r: string) => void }) {
  const profile = useApp((s) => s.profile)!;
  const prefs = useApp((s) => s.racePrefs);
  const sweatTests = useApp((s) => s.sweatTests);
  const setRacePrefs = useApp((s) => s.setRacePrefs);
  const plan = d.plan;
  const sweat = typicalSweatRate(sweatTests, profile.weightKg);
  const rp = useMemo(() => (plan ? buildRacePlan(plan.spec, d.t, profile.weightKg, prefs, sweat.lph) : undefined), [plan, d.t, profile.weightKg, prefs, sweat.lph]);
  if (!plan || !rp) return <Card><p className="muted">Add a target event first.</p><button className="btn" onClick={() => go("me")}>Add event</button></Card>;
  const daysOut = daysBetween(ymd(), plan.event.date);

  return (
    <>
      <Card title="Race conditions & fueling" className="no-print">
        <div className="form-grid">
          <NumIn label="Expected temp (°C)" value={prefs.tempC} onChange={(v) => setRacePrefs({ tempC: v })} />
          <NumIn label="Humidity (%)" value={prefs.humidity} onChange={(v) => setRacePrefs({ humidity: v })} />
          <NumIn label="Carbs per hour on bike (g)" value={prefs.carbsPerHour} step={5} onChange={(v) => setRacePrefs({ carbsPerHour: v })} hint="Trained gut: 70–90 g" />
          <NumIn label="Carbs per gel (g)" value={prefs.gelCarbs} onChange={(v) => setRacePrefs({ gelCarbs: v })} />
          <NumIn label="Carbs per 500 ml drink (g)" value={prefs.drinkCarbsPer500} onChange={(v) => setRacePrefs({ drinkCarbsPer500: v })} />
          <NumIn label="Sodium per litre (mg)" value={prefs.sodiumMgPerL} step={50} onChange={(v) => setRacePrefs({ sodiumMgPerL: v })} hint="Salty sweater: 1000+" />
        </div>
        <label className="row small" style={{ marginTop: 8 }}>
          <input type="checkbox" checked={prefs.caffeine} onChange={(e) => setRacePrefs({ caffeine: e.target.checked })} style={{ width: 20, minHeight: 20 }} />
          Use caffeine in the second half
        </label>
        <div className="tiny muted" style={{ marginTop: 6 }}>
          Sweat rate {round(sweat.lph, 2)} L/h {sweat.measured ? "(from your sweat tests)" : "(estimate; do a sweat test in Heat & hydration)"}.
        </div>
      </Card>

      <Card title={`Race-day plan: ${plan.event.name || plan.spec.label}`} right={<span className="pill est">estimate</span>}>
        <div className="hero"><span className="big">{fmtDuration(rp.total)}</span><span className="muted small">{daysOut > 0 ? `in ${daysOut} days` : ""}</span></div>
        <div className="stats" style={{ marginTop: 8 }}>
          <Stat label="Swim" value={fmtDuration(rp.swim.time)} sub={`${fmtPace(rp.swim.pace)}/100m`} />
          <Stat label="Bike" value={fmtDuration(rp.bike.time)} sub={`${Math.round(rp.bike.power)} W · ${rp.bike.speedKmh.toFixed(1)} km/h`} />
          <Stat label="Run" value={fmtDuration(rp.run.time)} sub={`${fmtPace(rp.run.pace)}/km`} />
          <Stat label="Heat penalty" value={`${rp.heatPct}%`} sub={heatRisk(rp.heatPct).label} />
          <Stat label="Carbs total" value={`${rp.carbsTotal} g`} sub="bike + run" />
          <Stat label="Fluid" value={`${Math.round(rp.fluidLph * 1000)} ml/h`} sub={`${rp.sodiumMgPerHour} mg Na/h`} />
        </div>
        <p className="tiny muted">From your current thresholds (FTP {d.t.ftp} W, run {fmtPace(d.t.runPace)}/km, CSS {fmtPace(d.t.swimCss)}/100m) on a flat course. Re-test regularly; the plan updates automatically.</p>
      </Card>

      <div className="grid three-wide">
        <Card title={`${SPORT_META.swim.icon} Swim`}>
          <ul className="small" style={{ paddingLeft: 18, margin: 0, color: "var(--text-2)" }}>{rp.swim.notes.map((n) => <li key={n}>{n}</li>)}</ul>
        </Card>
        <Card title={`${SPORT_META.bike.icon} Bike`}>
          <ul className="small" style={{ paddingLeft: 18, margin: 0, color: "var(--text-2)" }}>{rp.bike.notes.map((n) => <li key={n}>{n}</li>)}</ul>
          <FuelTable steps={rp.bike.fuel} />
        </Card>
        <Card title={`${SPORT_META.run.icon} Run`}>
          <ul className="small" style={{ paddingLeft: 18, margin: 0, color: "var(--text-2)" }}>
            {rp.run.walkStrategy && <li>{rp.run.walkStrategy}</li>}
            {rp.run.notes.map((n) => <li key={n}>{n}</li>)}
          </ul>
          <FuelTable steps={rp.run.fuel} />
        </Card>
      </div>

      <Card title="Carb-load & race morning">
        <div className="stats">
          <Stat label="Carb-load" value={`${rp.carbLoad.gramsPerDay} g/day`} sub={`${rp.carbLoad.gPerKg} g/kg for ${rp.carbLoad.days} day${rp.carbLoad.days > 1 ? "s" : ""} before`} />
        </div>
        <ul className="small" style={{ paddingLeft: 18, color: "var(--text-2)" }}>
          <li>Get carbs from rice, bread, noodles, potatoes, juice and sports drinks; cut fibre, fat and spicy food the day before.</li>
          <li>Spread it over 5–6 meals/snacks. Weight goes up ~1–2 kg (stored glycogen + water): that's expected.</li>
          <li>{rp.breakfast}</li>
        </ul>
      </Card>
    </>
  );
}

function FuelTable({ steps }: { steps: { at: number; text: string }[] }) {
  return (
    <div className="table-scroll" style={{ marginTop: 8 }}>
      <table className="data">
        <thead><tr><th style={{ width: 56 }}>Time</th><th>Fuel</th></tr></thead>
        <tbody>
          {steps.map((s) => (
            <tr key={s.at}><td className="num">{fmtDuration(s.at)}</td><td>{s.text}</td></tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function HeatView({ d }: { d: Derived }) {
  const profile = useApp((s) => s.profile)!;
  const tests = useApp((s) => s.sweatTests);
  const prefs = useApp((s) => s.racePrefs);
  const { addSweatTest, deleteSweatTest } = useApp.getState();
  const [w, setW] = useState<Weather | null>(null);
  const [busy, setBusy] = useState(false);
  const [calc, setCalc] = useState({ tempC: 30, rh: 75 });
  const [t, setT] = useState<SweatTest>({ id: uid(), date: ymd(), sport: "run", minutes: 60, preKg: profile.weightKg, postKg: profile.weightKg - 1, drankMl: 500, urineMl: 0 });

  const check = async () => {
    setBusy(true);
    try {
      const pos = await currentPosition();
      setW(await fetchWeather(pos.lat, pos.lon));
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const nowPct = w ? heatAdjustPct(w.tempC, w.rh) : undefined;
  const calcPct = heatAdjustPct(calc.tempC, calc.rh);
  const typical = typicalSweatRate(tests, profile.weightKg);
  const fp = fluidPlan(typical.lph, prefs.sodiumMgPerL);

  return (
    <>
      <div className="grid two">
        <Card title="Right now">
          {w ? (
            <>
              <div className="stats">
                <Stat label="Temperature" value={`${round(w.tempC, 1)}°C`} sub={`feels ${round(w.feelsC)}°C`} />
                <Stat label="Humidity" value={`${Math.round(w.rh)}%`} sub={`dew point ${round(w.dewC, 1)}°C`} />
                <Stat label="Run pace adjust" value={`+${round(nowPct!, 1)}%`} sub={heatRisk(nowPct!).label} />
              </div>
              <p className="small" style={{ color: "var(--text-2)" }}>
                Easy pace today: {fmtPace((d.t.runPace / 0.83) * (1 + nowPct! / 100))}/km or slower outdoors. Heart rate matters more than pace in this heat.
              </p>
            </>
          ) : (
            <p className="small muted">Check local heat and humidity to adjust today's outdoor paces (uses your location, via Open-Meteo).</p>
          )}
          <button className="btn" onClick={check} disabled={busy}>{busy ? <Spinner /> : w ? "Refresh" : "📍 Check local conditions"}</button>
        </Card>

        <Card title="Heat calculator">
          <div className="form-grid">
            <NumIn label="Temperature (°C)" value={calc.tempC} onChange={(v) => setCalc({ ...calc, tempC: v })} />
            <NumIn label="Humidity (%)" value={calc.rh} onChange={(v) => setCalc({ ...calc, rh: v })} />
          </div>
          <div className="stats" style={{ marginTop: 8 }}>
            <Stat label="Dew point" value={`${round(dewPoint(calc.tempC, calc.rh), 1)}°C`} />
            <Stat label="Slow run pace by" value={`${round(calcPct, 1)}%`} sub={heatRisk(calcPct).label} />
            <Stat label="Bike power" value={`−${round(calcPct / 2, 1)}%`} sub="for long efforts" />
          </div>
        </Card>
      </div>

      <Card title="Your sweat rate" right={<span className={`pill ${typical.measured ? "ok" : "est"}`}>{typical.measured ? "measured" : "estimated"}</span>}>
        <div className="stats">
          <Stat label="Sweat rate" value={`${round(typical.lph, 2)} L/h`} />
          <Stat label="Drink" value={`${Math.round(fp.drinkLph * 1000)} ml/h`} sub="~70% of losses" />
          <Stat label="Sodium" value={`${fp.sodiumMgPerHour} mg/h`} sub={`at ${prefs.sodiumMgPerL} mg/L`} />
        </div>
        <hr className="hr" />
        <h3 style={{ marginBottom: 6 }}>Do a sweat test</h3>
        <p className="small muted" style={{ marginTop: 0 }}>Weigh yourself naked and dry before and after a 45–90 min session in race-like heat. Record everything you drink.</p>
        <div className="form-grid">
          <label className="field">
            <span>Sport</span>
            <select value={t.sport} onChange={(e) => setT({ ...t, sport: e.target.value as SweatTest["sport"] })}>
              <option value="run">Run</option><option value="bike">Bike</option><option value="swim">Swim</option>
            </select>
          </label>
          <NumIn label="Duration (min)" value={t.minutes} onChange={(v) => setT({ ...t, minutes: v })} />
          <NumIn label="Weight before (kg)" value={t.preKg} step={0.1} onChange={(v) => setT({ ...t, preKg: v })} />
          <NumIn label="Weight after (kg)" value={t.postKg} step={0.1} onChange={(v) => setT({ ...t, postKg: v })} />
          <NumIn label="Drank (ml)" value={t.drankMl} step={50} onChange={(v) => setT({ ...t, drankMl: v })} />
          <NumIn label="Urine (ml, if any)" value={t.urineMl} step={50} onChange={(v) => setT({ ...t, urineMl: v })} />
          <NumIn label="Temp (°C, optional)" value={t.tempC ?? 0} onChange={(v) => setT({ ...t, tempC: v || undefined })} />
        </div>
        <div className="row" style={{ marginTop: 8 }}>
          <span className="small">Result: <b>{round(sweatRate(t), 2)} L/h</b></span>
          <button className="btn primary sm" disabled={t.minutes <= 0 || t.preKg <= t.postKg - 0.5} onClick={() => { addSweatTest(t); setT({ ...t, id: uid() }); toast("Sweat test saved"); }}>Save test</button>
        </div>
        {tests.length > 0 && (
          <div className="table-scroll" style={{ marginTop: 8 }}>
            <table className="data">
              <thead><tr><th>Date</th><th>Sport</th><th>Min</th><th>L/h</th><th></th></tr></thead>
              <tbody>
                {[...tests].sort((a, b) => (a.date < b.date ? 1 : -1)).map((x) => (
                  <tr key={x.id}>
                    <td>{fmtDate(x.date)}</td><td>{SPORT_META[x.sport].label}</td><td>{x.minutes}</td><td>{round(sweatRate(x), 2)}</td>
                    <td><button className="btn sm ghost" onClick={() => deleteSweatTest(x.id)} aria-label="Delete test">✕</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}

function TestsView({ d }: { d: Derived }) {
  const profile = useApp((s) => s.profile)!;
  const setProfile = useApp((s) => s.setProfile);
  const [p20, setP20] = useState<number | "">("");
  const [runKm, setRunKm] = useState<number | "">("");
  const [runHr, setRunHr] = useState<number | "">("");
  const [t400, setT400] = useState("");
  const [t200, setT200] = useState("");
  const upcoming = (d.plan?.weeks ?? []).flatMap((w) => w.sessions).filter((s) => s.test && s.date >= ymd() && s.status !== "skipped").slice(0, 6);

  const ftp = p20 ? Math.round(Number(p20) * 0.95) : undefined;
  const runPace = runKm ? Math.round(1800 / Number(runKm)) : undefined;
  const s400 = parseMinSec(t400);
  const s200 = parseMinSec(t200);
  const css = s400 && s200 && s400 > s200 ? Math.round((s400 - s200) / 2) : undefined;
  const apply = (patch: Partial<typeof profile>, msg: string) => {
    setProfile({ ...profile, ...patch });
    toast(`${msg} saved. Zones and plan updated.`);
  };

  return (
    <>
      <Card title="Scheduled tests">
        {upcoming.length ? (
          <div className="list">
            {upcoming.map((s) => (
              <div key={s.uid} className="list-item" style={{ cursor: "default" }}>
                <span aria-hidden>{s.sport === "rest" ? "" : SPORT_META[s.sport].icon}</span>
                <div className="grow small"><b>{s.title}</b><div className="muted">{fmtDate(s.date, { weekday: "short", day: "numeric", month: "short" })}</div></div>
              </div>
            ))}
          </div>
        ) : (
          <p className="small muted">No more tests scheduled before race day.</p>
        )}
        <p className="tiny muted">Tests sit in recovery weeks, when you're fresh, so the numbers are real.</p>
      </Card>
      <div className="grid three-wide">
        <Card title="🚴 FTP (20-min test)">
          <label className="field"><span>Average power for the 20 min (W)</span><input type="number" inputMode="numeric" value={p20} onChange={(e) => setP20(e.target.value === "" ? "" : Number(e.target.value))} /></label>
          {ftp && <div className="small" style={{ margin: "8px 0" }}>FTP = 95% → <b>{ftp} W</b> ({round(ftp / profile.weightKg, 2)} W/kg). Current: {d.t.ftp} W.</div>}
          <button className="btn primary sm" disabled={!ftp} onClick={() => apply({ ftp }, `FTP ${ftp} W`)}>Use as my FTP</button>
        </Card>
        <Card title="🏃 Run threshold (30-min test)">
          <div className="form-grid">
            <label className="field"><span>Distance in 30 min (km)</span><input type="number" inputMode="decimal" step={0.01} value={runKm} onChange={(e) => setRunKm(e.target.value === "" ? "" : Number(e.target.value))} /></label>
            <label className="field"><span>Avg HR, last 20 min</span><input type="number" inputMode="numeric" value={runHr} onChange={(e) => setRunHr(e.target.value === "" ? "" : Number(e.target.value))} /></label>
          </div>
          {runPace && <div className="small" style={{ margin: "8px 0" }}>Threshold pace <b>{fmtPace(runPace)}/km</b>{runHr ? `, LTHR ${runHr} bpm` : ""}. Current: {fmtPace(d.t.runPace)}/km.</div>}
          <button className="btn primary sm" disabled={!runPace} onClick={() => apply({ runThresholdPace: runPace, ...(runHr ? { lthr: Number(runHr) } : {}) }, "Run threshold")}>Use these values</button>
        </Card>
        <Card title="🏊 Swim CSS (400 + 200)">
          <div className="form-grid">
            <label className="field"><span>400 m time (m:ss)</span><input inputMode="numeric" placeholder="8:20" value={t400} onChange={(e) => setT400(e.target.value)} /></label>
            <label className="field"><span>200 m time (m:ss)</span><input inputMode="numeric" placeholder="3:55" value={t200} onChange={(e) => setT200(e.target.value)} /></label>
          </div>
          {css && <div className="small" style={{ margin: "8px 0" }}>CSS <b>{fmtPace(css)}/100m</b>. Current: {fmtPace(d.t.swimCss)}/100m.</div>}
          <button className="btn primary sm" disabled={!css} onClick={() => apply({ swimCss: css }, `CSS ${fmtPace(css!)}/100m`)}>Use as my CSS</button>
        </Card>
      </div>
    </>
  );
}
