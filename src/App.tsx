import { useEffect, useState } from "react";
import { useApp } from "./lib/store";
import { useDerived } from "./lib/useDerived";
import { handleOAuthRedirect, syncStrava } from "./lib/sync";
import { demoActivities } from "./lib/demo";
import { Today } from "./pages/Today";
import { PlanPage } from "./pages/PlanPage";
import { Workouts, WorkoutDetail } from "./pages/Workouts";
import { Fuel } from "./pages/Fuel";
import { Me, ProfileForm, EventForm, DEFAULT_PROFILE } from "./pages/Me";
import { Settings } from "./pages/Settings";
import { ToastHost, Spinner, toast } from "./components/ui";

const TABS = [
  { id: "today", label: "Today", ico: "🏠" },
  { id: "plan", label: "Plan", ico: "📅" },
  { id: "workouts", label: "Workouts", ico: "⏱️" },
  { id: "fuel", label: "Fuel", ico: "🍽️" },
  { id: "me", label: "Me", ico: "👤" },
];

function useHashRoute(): [string, (r: string) => void] {
  const read = () => location.hash.replace(/^#\/?/, "") || "today";
  const [route, setRoute] = useState(read);
  useEffect(() => {
    const on = () => {
      setRoute(read());
      window.scrollTo(0, 0);
    };
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  return [route, (r) => (location.hash = `/${r}`)];
}

export default function App() {
  const hydrated = useApp((s) => s.hydrated);
  const profile = useApp((s) => s.profile);
  const events = useApp((s) => s.events);
  const [route, go] = useHashRoute();
  const d = useDerived();

  // Strava OAuth return + auto-sync on open / when the app comes back to the foreground
  useEffect(() => {
    if (!hydrated) return;
    handleOAuthRedirect()
      .then((msg) => {
        if (msg) {
          toast(msg);
          if (useApp.getState().strava) return syncStrava().then((n) => toast(`Synced ${n} activities from Strava`));
        }
      })
      .catch((e) => toast((e as Error).message));

    const maybeSync = () => {
      const { strava, settings } = useApp.getState();
      if (document.visibilityState !== "visible" || !strava || !settings.autoSync) return;
      if (settings.lastSync && Date.now() - settings.lastSync < 30 * 60_000) return;
      syncStrava().then((n) => n && toast(`Synced ${n} new activit${n === 1 ? "y" : "ies"}`)).catch(() => {});
    };
    maybeSync();
    document.addEventListener("visibilitychange", maybeSync);
    return () => document.removeEventListener("visibilitychange", maybeSync);
  }, [hydrated]);

  if (!hydrated) return <div style={{ display: "grid", placeItems: "center", height: "100dvh" }}><Spinner /></div>;
  if (!profile || !events.length) return <><Onboarding /><ToastHost /></>;
  if (!d) return null;

  const [tab, sub] = route.split("/");
  let page;
  if (tab === "plan") page = <PlanPage d={d} go={go} />;
  else if (tab === "workouts" && sub) page = <WorkoutDetail key={sub} id={sub} d={d} go={go} />;
  else if (tab === "workouts") page = <Workouts d={d} go={go} />;
  else if (tab === "fuel") page = <Fuel d={d} go={go} />;
  else if (tab === "me") page = <Me d={d} go={go} />;
  else if (tab === "settings") page = <Settings go={go} />;
  else page = <Today d={d} go={go} />;

  const activeTab = tab === "settings" ? "me" : tab || "today";
  return (
    <div className="app">
      <nav className="nav" aria-label="Main">
        {TABS.map((t) => (
          <button key={t.id} className={activeTab === t.id ? "on" : ""} onClick={() => go(t.id)} aria-current={activeTab === t.id ? "page" : undefined}>
            <span className="ico" aria-hidden>{t.ico}</span>
            {t.label}
          </button>
        ))}
      </nav>
      <main className="main">{page}</main>
      <ToastHost />
    </div>
  );
}

function Onboarding() {
  const profile = useApp((s) => s.profile);
  const { setProfile, upsertEvent, mergeActivities } = useApp.getState();
  const [step, setStep] = useState(profile ? 2 : 0);
  return (
    <div className="main">
      <div className="welcome stack">
        <img className="logo" src={`${import.meta.env.BASE_URL}icon.svg`} alt="" />
        <div className="steps">{[0, 1, 2].map((i) => <i key={i} className={i <= step ? "on" : ""} />)}</div>
        {step === 0 && (
          <div className="stack">
            <h1>Your Ironman coach, in your pocket</h1>
            <p style={{ color: "var(--text-2)" }}>
              A periodised plan for any race date, adaptive suggestions from your Strava training load, deep workout insights,
              and photo-based macro tracking.
            </p>
            <button className="btn primary" onClick={() => setStep(1)}>Get started</button>
          </div>
        )}
        {step === 1 && (
          <div className="stack">
            <h2>About you</h2>
            <p className="small muted">Used for zones, energy needs and plan volume. You can add tested thresholds later.</p>
            <ProfileForm initial={profile ?? DEFAULT_PROFILE} compact submitLabel="Next" onSave={(p) => { setProfile(p); setStep(2); }} />
          </div>
        )}
        {step === 2 && (
          <div className="stack">
            <h2>Pick your race</h2>
            <p className="small muted">Any gap between today and race day works. The plan adapts its phases to fit.</p>
            <EventForm submitLabel="Build my plan" onSave={(e) => upsertEvent(e)} />
            <button className="btn ghost" onClick={() => mergeActivities(demoActivities())}>Load demo workouts to explore first</button>
          </div>
        )}
      </div>
    </div>
  );
}
