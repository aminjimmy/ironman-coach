import { useEffect, useMemo, useRef, useState } from "react";
import { useApp, saveStreams } from "../lib/store";
import type { Derived } from "../lib/useDerived";
import type { Activity, Sport, Streams } from "../lib/types";
import { activityStress } from "../lib/metrics";
import { analyze } from "../lib/insights";
import { loadStreams, syncStrava } from "../lib/sync";
import { importFile } from "../lib/fileImport";
import { fmtDistance, fmtDuration, fmtHours, fmtPace, fmtSpeedForSport, round, SPORT_META, weekStart, fmtDate } from "../lib/format";
import { Card, Spinner, Stat, ZoneBars, toast } from "../components/ui";
import { SeriesChart } from "../components/charts";

export function Workouts({ d, go }: { d: Derived; go: (r: string) => void }) {
  const acts = useApp((s) => s.activities);
  const strava = useApp((s) => s.strava);
  const mergeActivities = useApp((s) => s.mergeActivities);
  const lastSync = useApp((s) => s.settings.lastSync);
  const [filter, setFilter] = useState<Sport | "all">("all");
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const shown = acts.filter((a) => filter === "all" || a.sport === filter);
  const groups = useMemo(() => {
    const g = new Map<string, Activity[]>();
    for (const a of shown.slice(0, 300)) {
      const w = weekStart(a.start.slice(0, 10));
      g.set(w, [...(g.get(w) ?? []), a]);
    }
    return [...g.entries()];
  }, [shown]);

  const sync = async () => {
    setBusy(true);
    try {
      const n = await syncStrava();
      toast(n ? `Synced ${n} activities` : "Already up to date");
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const onFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    setBusy(true);
    const ok: Activity[] = [];
    for (const f of Array.from(files)) {
      try {
        const { activity, streams } = await importFile(f);
        await saveStreams(activity.id, streams);
        ok.push(activity);
      } catch (e) {
        toast(`${f.name}: ${(e as Error).message}`);
      }
    }
    mergeActivities(ok);
    setBusy(false);
    if (ok.length) toast(`Imported ${ok.length} workout${ok.length > 1 ? "s" : ""}`);
    if (fileRef.current) fileRef.current.value = "";
  };

  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <h1>Workouts</h1>
          <div className="sub">
            {acts.length} activities{lastSync ? ` · synced ${new Date(lastSync).toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" })}` : ""}
          </div>
        </div>
        <div className="row">
          {busy && <Spinner />}
          <button className="btn sm" onClick={() => fileRef.current?.click()} disabled={busy}>Import</button>
          {strava ? (
            <button className="btn strava sm" onClick={sync} disabled={busy}>Sync</button>
          ) : (
            <button className="btn strava sm" onClick={() => go("settings")}>Connect Strava</button>
          )}
          <input ref={fileRef} type="file" accept=".fit,.gpx,.tcx" multiple hidden onChange={(e) => onFiles(e.target.files)} />
        </div>
      </div>

      <div className="tabs">
        {(["all", "swim", "bike", "run", "strength", "other"] as const).map((s) => (
          <button key={s} className={filter === s ? "on" : ""} onClick={() => setFilter(s)}>
            {s === "all" ? "All" : `${SPORT_META[s].icon} ${SPORT_META[s].label}`}
          </button>
        ))}
      </div>

      {groups.length === 0 && (
        <Card>
          <p className="muted">No workouts yet. Connect Strava to sync automatically, or import .FIT / .GPX / .TCX files from your watch.</p>
        </Card>
      )}

      {groups.map(([week, list]) => {
        const secs = list.reduce((s, a) => s + a.movingTime, 0);
        const tss = list.reduce((s, a) => s + activityStress(a, d.t).tss, 0);
        return (
          <Card key={week} title={`Week of ${fmtDate(week)}`} right={<span className="small muted num">{fmtHours(secs)} · {Math.round(tss)} TSS</span>}>
            <div className="list">
              {list.map((a) => {
                const st = activityStress(a, d.t);
                return (
                  <button key={a.id} className="list-item" onClick={() => go(`workouts/${a.id}`)}>
                    <span className="ic" style={{ background: `${SPORT_META[a.sport].color}26` }}>{SPORT_META[a.sport].icon}</span>
                    <div className="grow">
                      <div style={{ fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{a.name}</div>
                      <div className="small muted">
                        {new Date(a.start).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" })} · {fmtDuration(a.movingTime)}
                        {a.distance > 0 && ` · ${fmtDistance(a.distance, a.sport)}`}
                      </div>
                    </div>
                    <div style={{ textAlign: "right" }} className="small">
                      <div className="num" style={{ fontWeight: 600 }}>{Math.round(st.tss)}</div>
                      <div className="tiny muted">TSS</div>
                    </div>
                  </button>
                );
              })}
            </div>
          </Card>
        );
      })}
    </div>
  );
}

export function WorkoutDetail({ id, d, go }: { id: string; d: Derived; go: (r: string) => void }) {
  const a = useApp((s) => s.activities.find((x) => x.id === id));
  const deleteActivity = useApp((s) => s.deleteActivity);
  const profile = useApp((s) => s.profile)!;
  const [streams, setStreams] = useState<Streams | undefined>();
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!a) return;
    let alive = true;
    setLoading(true);
    loadStreams(a)
      .then((s) => alive && setStreams(s))
      .catch((e) => alive && setErr((e as Error).message))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [a?.id]);

  const an = useMemo(() => (a ? analyze(a, d.t, streams) : null), [a, d.t, streams]);
  if (!a || !an) return <Card><p>Workout not found.</p><button className="btn" onClick={() => go("workouts")}>Back</button></Card>;

  const meta = SPORT_META[a.sport];
  const x = streams?.distance ?? [];
  const hasX = x.length > 10;
  const paceFmt = a.sport === "run" ? (v: number) => fmtPace(1000 / v) : a.sport === "swim" ? (v: number) => fmtPace(100 / v) : (v: number) => `${(v * 3.6).toFixed(1)}`;

  return (
    <div className="stack">
      <div className="page-head">
        <div className="row" style={{ flexWrap: "nowrap", minWidth: 0 }}>
          <button className="icon-btn" onClick={() => history.back()} aria-label="Back">←</button>
          <div style={{ minWidth: 0 }}>
            <h1 style={{ fontSize: "1.25rem" }}>{meta.icon} {a.name}</h1>
            <div className="sub">{new Date(a.start).toLocaleString(undefined, { weekday: "long", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })} · {a.rawType}</div>
          </div>
        </div>
      </div>

      <div className="grid two">
        <Card title="Summary">
          <div className="stats">
            <Stat label="Moving time" value={fmtDuration(a.movingTime)} sub={a.elapsedTime > a.movingTime + 60 ? `${fmtDuration(a.elapsedTime)} elapsed` : undefined} />
            {a.distance > 0 && <Stat label="Distance" value={fmtDistance(a.distance, a.sport)} />}
            {a.avgSpeed && a.distance > 0 && <Stat label={a.sport === "bike" ? "Avg speed" : "Avg pace"} value={fmtSpeedForSport(a.sport, a.avgSpeed)} />}
            {a.avgHr && <Stat label="Avg HR" value={`${Math.round(a.avgHr)}`} sub={a.maxHr ? `max ${Math.round(a.maxHr)} bpm` : "bpm"} />}
            {a.avgWatts && <Stat label="Avg power" value={`${Math.round(a.avgWatts)} W`} sub={an.np ? `NP ${Math.round(an.np)} W` : undefined} />}
            {an.np && <Stat label="Intensity (IF)" value={(an.np / d.t.ftp).toFixed(2)} sub={an.vi ? `VI ${an.vi.toFixed(2)}` : undefined} />}
            {an.spm && <Stat label="Cadence" value={`${Math.round(an.spm)}`} sub="steps/min" />}
            {an.strideM && <Stat label="Stride length" value={`${an.strideM.toFixed(2)} m`} />}
            {a.sport === "bike" && a.avgCadence && <Stat label="Cadence" value={`${Math.round(a.avgCadence)}`} sub="rpm" />}
            {a.elevationGain != null && a.elevationGain > 0 && <Stat label="Elevation" value={`${Math.round(a.elevationGain)} m`} />}
            <Stat label="Training stress" value={Math.round(an.stress.tss)} sub={`TSS · ${an.stress.method}`} />
            {(a.calories || a.kilojoules) && <Stat label="Energy" value={`${Math.round(a.calories ?? a.kilojoules!)}`} sub="kcal" />}
            {an.ef && <Stat label="Efficiency factor" value={an.ef.toFixed(2)} sub={a.sport === "bike" ? "NP / HR" : "m/min / HR"} />}
            {an.decoupling != null && <Stat label="Decoupling" value={`${an.decoupling.toFixed(1)}%`} sub={an.decoupling < 5 ? "good" : "drift"} />}
            {an.vo2 && <Stat label="Est. VO₂max" value={round(an.vo2, 1)} sub="from this run" />}
          </div>
        </Card>

        <Card title="Insights">
          {an.notes.map((n, i) => (
            <div key={i} className={`advice ${n.tone}`}>
              <div className="badge" aria-hidden>{n.tone === "good" ? "✅" : n.tone === "caution" ? "⚠️" : "💡"}</div>
              <div className="small" style={{ color: "var(--text-2)" }}>{n.text}</div>
            </div>
          ))}
          {an.best.length > 0 && (
            <>
              <hr className="hr" />
              <div className="stats">{an.best.map((b) => <Stat key={b.label} label={b.label} value={b.value} />)}</div>
            </>
          )}
        </Card>
      </div>

      {loading && <div className="row muted"><Spinner /> Loading detailed streams…</div>}
      {err && <div className="small" style={{ color: "var(--warn)" }}>Couldn't load detailed data: {err}. Summary metrics are still shown.</div>}

      <div className="grid two">
        {an.hrZ && <Card title="Heart-rate zones"><ZoneBars zones={an.hrZ.zones} secs={an.hrZ.secs} kind="hr" /></Card>}
        {an.powerZ && <Card title="Power zones"><ZoneBars zones={an.powerZ.zones} secs={an.powerZ.secs} kind="power" /></Card>}
        {an.paceZ && <Card title={a.sport === "run" ? "Pace zones" : "Swim pace zones"}><ZoneBars zones={an.paceZ.zones} secs={an.paceZ.secs} kind={an.paceZ.kind} /></Card>}
      </div>

      {streams && hasX && (
        <div className="grid two">
          {streams.heartrate && <Card title="Heart rate"><SeriesChart x={x} y={streams.heartrate.map((v) => v || null)} color="#d55181" label="HR" format={(v) => `${Math.round(v)}`} /></Card>}
          {streams.velocity && (
            <Card title={a.sport === "bike" ? "Speed (km/h)" : a.sport === "run" ? "Pace (/km)" : "Pace (/100m)"}>
              <SeriesChart x={x} y={streams.velocity.map((v) => (v > 0.3 ? v : null))} color="#3987e5" label={a.sport === "bike" ? "Speed" : "Pace"} format={paceFmt} />
            </Card>
          )}
          {streams.watts && <Card title="Power (W)"><SeriesChart x={x} y={streams.watts} color="#c98500" label="Power" /></Card>}
          {streams.cadence && <Card title={a.sport === "run" ? "Cadence (spm)" : "Cadence (rpm)"}><SeriesChart x={x} y={streams.cadence.map((c) => (c ? (a.sport === "run" && c < 120 ? c * 2 : c) : null))} color="#9085e9" label="Cadence" /></Card>}
          {streams.altitude && a.sport !== "swim" && <Card title="Elevation (m)"><SeriesChart x={x} y={streams.altitude} color="#7d8a9b" label="Elevation" /></Card>}
        </div>
      )}

      {an.splits.length > 1 && (
        <Card title={`Splits (per ${a.sport === "run" ? "km" : a.sport === "bike" ? "5 km" : "100 m"})`}>
          <div className="table-scroll">
            <table className="data">
              <thead>
                <tr><th>#</th><th>Time</th><th>{a.sport === "bike" ? "km/h" : "Pace"}</th><th>HR</th>{a.sport === "bike" && <th>Power</th>}<th>Cad</th></tr>
              </thead>
              <tbody>
                {an.splits.map((s) => (
                  <tr key={s.n}>
                    <td>{s.n}</td>
                    <td>{fmtDuration(s.time)}</td>
                    <td>{fmtSpeedForSport(a.sport, s.dist / s.time).replace(/ \/.*| km\/h/, "")}</td>
                    <td>{s.hr ? Math.round(s.hr) : "–"}</td>
                    {a.sport === "bike" && <td>{s.watts ? Math.round(s.watts) : "–"}</td>}
                    <td>{s.cadence ? Math.round(a.sport === "run" && s.cadence < 120 ? s.cadence * 2 : s.cadence) : "–"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <div className="row">
        {a.source === "strava" && (
          <a className="btn sm" href={`https://www.strava.com/activities/${a.id.replace("strava-", "")}`} target="_blank" rel="noreferrer">View on Strava</a>
        )}
        <button
          className="btn sm danger"
          onClick={() => {
            if (confirm("Remove this workout from the app? (It stays on Strava.)")) {
              deleteActivity(a.id);
              go("workouts");
            }
          }}
        >
          Remove
        </button>
      </div>
      <p className="tiny muted">Metrics computed in-app from {a.source === "strava" ? "Strava" : a.source === "file" ? "the imported file" : "demo data"} using your thresholds (FTP {d.t.ftp} W, LTHR {d.t.lthr} bpm, run threshold {fmtPace(d.t.runPace)}/km, CSS {fmtPace(d.t.swimCss)}/100m). Profile weight {profile.weightKg} kg.</p>
    </div>
  );
}
