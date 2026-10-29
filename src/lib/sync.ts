import { useApp } from "./store";
import { exchangeCode, fetchActivities, freshToken, fetchStreams } from "./strava";
import { saveStreams, getStreams } from "./store";
import { demoStreams } from "./demo";
import type { Activity, Streams } from "./types";

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
  if (q.get("error")) return `Strava authorisation cancelled (${q.get("error")})`;
  const code = q.get("code");
  if (!code) return null;
  const { settings, setStrava, profile, setProfile } = useApp.getState();
  const { auth, athlete } = await exchangeCode(code, settings.stravaClientId, settings.stravaClientSecret);
  setStrava(auth);
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

/** Pull new activities. First sync goes back 26 weeks; later syncs overlap 3 days to catch edits. */
export function syncStrava(onProgress?: (n: number) => void): Promise<number> {
  if (syncing) return syncing;
  syncing = (async () => {
    try {
      const token = await stravaToken();
      const { activities, mergeActivities, setSettings } = useApp.getState();
      const stravaActs = activities.filter((a) => a.source === "strava");
      const latest = stravaActs.length ? Math.max(...stravaActs.map((a) => new Date(a.start).getTime())) : 0;
      const after = latest ? latest / 1000 - 3 * 86400 : Date.now() / 1000 - 182 * 86400;
      const acts = await fetchActivities(token, after, onProgress);
      mergeActivities(acts);
      setSettings({ lastSync: Date.now() });
      return acts.length;
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
