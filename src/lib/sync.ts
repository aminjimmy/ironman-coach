import { useApp } from "./store";
import { exchangeCode, fetchActivities, freshToken, fetchStreams } from "./strava";
import { saveStreams, getStreams } from "./store";
import { demoStreams } from "./demo";
import type { Activity, Streams } from "./types";

// The redirect to Strava can unload the page before IndexedDB finishes writing,
// so the client credentials are also kept synchronously in localStorage until the login completes.
const PENDING = "strava-pending-creds";

export function rememberCredentials(clientId: string, clientSecret: string) {
  try {
    localStorage.setItem(PENDING, JSON.stringify({ clientId, clientSecret }));
  } catch {
    /* storage unavailable: fall back to the persisted store */
  }
}

function pendingCredentials(): { clientId: string; clientSecret: string } | null {
  try {
    return JSON.parse(localStorage.getItem(PENDING) ?? "null");
  } catch {
    return null;
  }
}

export async function stravaToken(): Promise<string> {
  const { strava, settings, setStrava } = useApp.getState();
  if (!strava) throw new Error("Strava is not connected");
  return freshToken(strava, settings.stravaClientId, settings.stravaClientSecret, setStrava);
}

/** Handle ?code=... after the Strava OAuth redirect. Returns a status message or null. */
export async function handleOAuthRedirect(): Promise<string | null> {
  const q = new URLSearchParams(location.search);
  if (q.get("state") !== "strava") return null;
  history.replaceState(null, "", location.pathname + location.hash);
  const { settings, setSettings, setStrava, profile, setProfile } = useApp.getState();
  const fail = (msg: string) => {
    setSettings({ lastSyncError: msg, lastSyncAttempt: Date.now() });
    throw new Error(msg);
  };
  if (q.get("error")) fail(`Strava authorisation was cancelled (${q.get("error")}).`);
  const code = q.get("code");
  if (!code) return null;

  const scope = q.get("scope") ?? "";
  if (!/activity:read/.test(scope)) {
    fail('Strava connected without permission to read activities. Tap Connect again and keep "View data about your activities" ticked.');
  }
  const creds = settings.stravaClientId && settings.stravaClientSecret
    ? { clientId: settings.stravaClientId, clientSecret: settings.stravaClientSecret }
    : pendingCredentials();
  if (!creds) fail("Your Strava Client ID and Secret were lost during the login redirect. Enter them again and tap Connect.");

  let result;
  try {
    result = await exchangeCode(code, creds!.clientId, creds!.clientSecret);
  } catch (e) {
    fail((e as Error).message);
  }
  const { auth, athlete } = result!;
  setSettings({ stravaClientId: creds!.clientId, stravaClientSecret: creds!.clientSecret, stravaScope: scope, lastSyncError: undefined });
  setStrava(auth);
  try {
    localStorage.removeItem(PENDING);
  } catch {
    /* ignore */
  }
  if (profile && athlete) {
    setProfile({
      ...profile,
      weightKg: athlete.weight || profile.weightKg,
      ftp: profile.ftp ?? (athlete.ftp || undefined),
    });
  }
  return `Connected to Strava as ${auth.athleteName ?? "athlete"}`;
}

let syncing: Promise<number> | null = null;
export const isSyncing = () => !!syncing;

/**
 * Pull activities from Strava. A normal sync continues from the newest Strava activity already stored
 * (overlapping 3 days to catch edits); `full` re-fetches the last 26 weeks.
 */
export function syncStrava(opts: { full?: boolean; onProgress?: (n: number) => void } = {}): Promise<number> {
  if (syncing) return syncing;
  syncing = (async () => {
    const { setSettings } = useApp.getState();
    setSettings({ lastSyncAttempt: Date.now() });
    try {
      const token = await stravaToken();
      const { activities, mergeActivities } = useApp.getState();
      const stravaActs = activities.filter((a) => a.source === "strava");
      const latest = !opts.full && stravaActs.length ? Math.max(...stravaActs.map((a) => new Date(a.start).getTime())) : 0;
      const after = latest ? latest / 1000 - 3 * 86400 : Date.now() / 1000 - 182 * 86400;
      const acts = await fetchActivities(token, after, opts.onProgress);
      mergeActivities(acts);
      setSettings({ lastSync: Date.now(), lastSyncCount: acts.length, lastSyncError: undefined });
      return acts.length;
    } catch (e) {
      const msg = e instanceof TypeError ? `Couldn't reach Strava (${e.message}). Check your internet connection.` : (e as Error).message;
      setSettings({ lastSyncError: msg });
      throw new Error(msg);
    } finally {
      syncing = null;
    }
  })();
  return syncing;
}

export async function loadStreams(a: Activity): Promise<Streams | undefined> {
  const cached = await getStreams(a.id);
  if (cached) return cached;
  if (a.source === "demo") return demoStreams(a);
  if (a.source !== "strava") return undefined;
  const s = await fetchStreams(await stravaToken(), a.id);
  if (s.time.length) {
    await saveStreams(a.id, s);
    useApp.getState().patchActivity(a.id, { hasStreams: true });
  }
  return s;
}
