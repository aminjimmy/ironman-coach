import { useEffect, useRef, useState } from "react";
import { clear } from "idb-keyval";
import { useApp } from "../lib/store";
import { authorizeUrl, redirectUri } from "../lib/strava";
import { rememberCredentials, syncStrava } from "../lib/sync";
import { demoActivities } from "../lib/demo";
import { Card, Spinner, toast } from "../components/ui";

// Captured globally so the button works even if the event fired before this page mounted
interface InstallPrompt extends Event { prompt: () => Promise<void> }
let deferredPrompt: InstallPrompt | null = null;
window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  deferredPrompt = e as InstallPrompt;
});

export function Settings({ go }: { go: (r: string) => void }) {
  const settings = useApp((s) => s.settings);
  const strava = useApp((s) => s.strava);
  const acts = useApp((s) => s.activities);
  const { setSettings, setStrava, mergeActivities, clearActivities, importBackup } = useApp.getState();
  const [id, setId] = useState(settings.stravaClientId);
  const [secret, setSecret] = useState(settings.stravaClientSecret);
  const [key, setKey] = useState(settings.anthropicKey);
  const [busy, setBusy] = useState(false);
  const [canInstall, setCanInstall] = useState(!!deferredPrompt);
  const fileRef = useRef<HTMLInputElement>(null);
  const standalone = matchMedia("(display-mode: standalone)").matches;

  useEffect(() => {
    const on = () => setCanInstall(true);
    window.addEventListener("beforeinstallprompt", on);
    return () => window.removeEventListener("beforeinstallprompt", on);
  }, []);

  const connect = () => {
    rememberCredentials(id.trim(), secret.trim());
    setSettings({ stravaClientId: id.trim(), stravaClientSecret: secret.trim(), lastSyncError: undefined });
    location.href = authorizeUrl(id.trim());
  };

  const runSync = async (full: boolean) => {
    setBusy(true);
    try {
      const n = await syncStrava({ full });
      toast(n ? `Synced ${n} activities` : "Already up to date");
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const stravaCount = acts.filter((a) => a.source === "strava").length;
  const fmtTime = (t?: number) => (t ? new Date(t).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "never");

  const exportData = () => {
    const { profile, weights, events, activeEventId, activities, foods } = useApp.getState();
    const blob = new Blob([JSON.stringify({ version: 1, profile, weights, events, activeEventId, activities, foods }, null, 1)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `ironman-coach-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
  };

  const importData = async (f?: File) => {
    if (!f) return;
    try {
      const data = JSON.parse(await f.text());
      if (!data.version) throw new Error("Not a backup file");
      if (!confirm("Replace profile, events, workouts and food log with this backup?")) return;
      importBackup(data);
      toast("Backup restored");
    } catch (e) {
      toast(`Import failed: ${(e as Error).message}`);
    }
  };

  const demoCount = acts.filter((a) => a.source === "demo").length;

  return (
    <div className="stack">
      <div className="page-head">
        <div className="row">
          <button className="icon-btn" onClick={() => go("me")} aria-label="Back">←</button>
          <h1>Settings</h1>
        </div>
      </div>

      <div className="grid two">
        <Card title="Strava">
          {strava ? (
            <div className="stack">
              <div>✅ Connected{strava.athleteName ? ` as ${strava.athleteName}` : ""}</div>
              <div className="stats">
                <div className="stat"><div className="v">{stravaCount}</div><div className="l">Strava workouts in app</div></div>
                <div className="stat"><div className="v" style={{ fontSize: "0.95rem" }}>{fmtTime(settings.lastSync)}</div><div className="l">Last successful sync{settings.lastSyncCount != null ? ` · ${settings.lastSyncCount} fetched` : ""}</div></div>
              </div>
              {settings.lastSyncError && (
                <div className="small" role="alert" style={{ color: "var(--bad)", background: "rgba(255,92,92,0.1)", padding: "8px 10px", borderRadius: 10 }}>
                  ⚠️ Last sync failed ({fmtTime(settings.lastSyncAttempt)}): {settings.lastSyncError}
                </div>
              )}
              {settings.stravaScope && !/activity:read/.test(settings.stravaScope) && (
                <div className="small" style={{ color: "var(--warn)" }}>Activity permission missing. Disconnect and connect again.</div>
              )}
              <label className="row small">
                <input type="checkbox" checked={settings.autoSync} onChange={(e) => setSettings({ autoSync: e.target.checked })} style={{ width: 20, minHeight: 20 }} />
                Auto-sync when the app opens
              </label>
              <div className="row">
                <button className="btn strava" disabled={busy} onClick={() => runSync(false)}>{busy ? <Spinner /> : "Sync now"}</button>
                <button className="btn" disabled={busy} onClick={() => runSync(true)}>Re-sync last 26 weeks</button>
                <button className="btn danger" onClick={() => { if (confirm("Disconnect Strava? Synced workouts stay in the app.")) setStrava(null); }}>Disconnect</button>
              </div>
            </div>
          ) : (
            <div className="stack">
              <div className="small" style={{ color: "var(--text-2)" }}>One-time setup (≈2 min). Strava requires every app to use its own API key:</div>
              <ol className="guide">
                <li>Open <a href="https://www.strava.com/settings/api" target="_blank" rel="noreferrer">strava.com/settings/api</a> and create an app (any name, category "Training").</li>
                <li>Set <b>Authorization Callback Domain</b> to <code>{location.hostname}</code></li>
                <li>Copy the <b>Client ID</b> and <b>Client Secret</b> below, then tap Connect.</li>
              </ol>
              <div className="form-grid">
                <label className="field"><span>Client ID</span><input inputMode="numeric" value={id} onChange={(e) => setId(e.target.value)} /></label>
                <label className="field"><span>Client Secret</span><input type="password" value={secret} onChange={(e) => setSecret(e.target.value)} /></label>
              </div>
              {settings.lastSyncError && (
                <div className="small" role="alert" style={{ color: "var(--bad)", background: "rgba(255,92,92,0.1)", padding: "8px 10px", borderRadius: 10 }}>
                  ⚠️ {settings.lastSyncError}
                </div>
              )}
              <button className="btn strava" disabled={!id.trim() || !secret.trim()} onClick={connect}>Connect with Strava</button>
              <div className="tiny muted">Redirects back to <code>{redirectUri()}</code>. Keys stay on this device.</div>
            </div>
          )}
        </Card>

        <Card title="Food photo AI">
          <div className="stack">
            <div className="small" style={{ color: "var(--text-2)" }}>
              Meal photos are analysed by Claude. Create an API key at{" "}
              <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noreferrer">console.anthropic.com</a> (pay-as-you-go, about 1–3 US cents per photo).
            </div>
            <label className="field">
              <span>Anthropic API key</span>
              <input type="password" value={key} placeholder="sk-ant-…" onChange={(e) => setKey(e.target.value)} />
            </label>
            <button className="btn" disabled={key === settings.anthropicKey} onClick={() => { setSettings({ anthropicKey: key.trim() }); toast("API key saved on this device"); }}>Save key</button>
            <div className="tiny muted">Stored only in this browser. Photos are sent directly to Anthropic's API.</div>
          </div>
        </Card>

        <Card title="Install on your phone">
          {standalone ? (
            <div>✅ Running as an installed app.</div>
          ) : (
            <div className="stack">
              {canInstall && (
                <button className="btn primary" onClick={async () => { await deferredPrompt?.prompt(); deferredPrompt = null; setCanInstall(false); }}>Install app</button>
              )}
              <div className="small" style={{ color: "var(--text-2)" }}>
                In Chrome on your Galaxy Z Fold: tap ⋮ → <b>Add to home screen</b> → <b>Install</b>. It then opens full-screen like a native app and works on both the cover and inner screen.
              </div>
            </div>
          )}
        </Card>

        <Card title="Data">
          <div className="stack">
            <div className="row">
              <button className="btn" onClick={exportData}>Export backup</button>
              <button className="btn" onClick={() => fileRef.current?.click()}>Restore backup</button>
              <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={(e) => importData(e.target.files?.[0])} />
            </div>
            <div className="row">
              {demoCount ? (
                <button className="btn" onClick={() => { clearActivities("demo"); toast("Demo workouts removed"); }}>Remove demo workouts ({demoCount})</button>
              ) : (
                <button className="btn" onClick={() => { mergeActivities(demoActivities()); toast("Demo workouts loaded"); }}>Load demo workouts</button>
              )}
            </div>
            <button className="btn danger" onClick={async () => {
              if (!confirm("Delete ALL data on this device (profile, plan, workouts, food log, keys)?")) return;
              await clear();
              location.reload();
            }}>Reset everything</button>
            <div className="tiny muted">All data lives on this device (IndexedDB). Export a backup before switching phones.</div>
          </div>
        </Card>
      </div>
    </div>
  );
}
