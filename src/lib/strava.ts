import type { Activity, Sport, StravaAuth, Streams } from "./types";

const API = "https://www.strava.com/api/v3";
const SCOPE = "read,activity:read_all,profile:read_all";

export function redirectUri(): string {
  return `${location.origin}${import.meta.env.BASE_URL}`;
}

export function authorizeUrl(clientId: string): string {
  const q = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri(),
    response_type: "code",
    approval_prompt: "auto",
    scope: SCOPE,
    state: "strava",
  });
  return `https://www.strava.com/oauth/authorize?${q}`;
}

export interface StravaAthlete {
  firstname?: string;
  lastname?: string;
  weight?: number;
  ftp?: number;
  sex?: "M" | "F";
}

/**
 * Strava errors look like {"message":"Bad Request","errors":[{"resource":"Application","field":"client_secret","code":"invalid"}]}.
 * Every error carries a "code" key, so match on resource/field, never on raw text.
 */
export function explainTokenError(status: number, body: string): string {
  let errs: { resource?: string; field?: string; code?: string }[] = [];
  try {
    errs = JSON.parse(body).errors ?? [];
  } catch {
    /* not JSON */
  }
  const detail = errs.length ? errs.map((e) => [e.resource, e.field, e.code].filter(Boolean).join(" ")).join("; ") : body.slice(0, 160);
  const has = (re: RegExp) => errs.some((e) => re.test(`${e.resource} ${e.field}`));
  let msg: string;
  if (has(/client_secret/i)) msg = "Strava rejected the Client Secret. Copy it again from strava.com/settings/api (tap 'show').";
  else if (has(/client_id|Application/i)) msg = "Strava rejected the Client ID. Copy it again from strava.com/settings/api.";
  else if (has(/redirect_uri/i)) msg = "Strava rejected the callback address. Set 'Authorization Callback Domain' to exactly " + location.hostname + ".";
  else if (has(/AuthorizationCode|^ code/i)) msg = "Strava's one-time login code was already used or expired. Tap Connect with Strava again.";
  else if (has(/RefreshToken/i)) msg = "Your Strava login has expired. Tap Disconnect, then Connect again.";
  else msg = `Strava login failed (HTTP ${status}).`;
  return `${msg} [Strava: ${detail || status}]`;
}

async function tokenRequest(body: Record<string, string>): Promise<{ auth: StravaAuth; athlete?: StravaAthlete }> {
  const res = await fetch("https://www.strava.com/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(explainTokenError(res.status, await res.text()));
  const j = await res.json();
  return {
    auth: {
      accessToken: j.access_token,
      refreshToken: j.refresh_token,
      expiresAt: j.expires_at,
      athleteName: j.athlete ? `${j.athlete.firstname ?? ""} ${j.athlete.lastname ?? ""}`.trim() : undefined,
    },
    athlete: j.athlete,
  };
}

export function exchangeCode(code: string, clientId: string, clientSecret: string) {
  return tokenRequest({ client_id: clientId, client_secret: clientSecret, code, grant_type: "authorization_code" });
}

export async function freshToken(
  auth: StravaAuth,
  clientId: string,
  clientSecret: string,
  save: (a: StravaAuth) => void,
): Promise<string> {
  if (auth.expiresAt - 120 > Date.now() / 1000) return auth.accessToken;
  const { auth: next } = await tokenRequest({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: auth.refreshToken,
    grant_type: "refresh_token",
  });
  save({ ...next, athleteName: auth.athleteName });
  return next.accessToken;
}

async function get<T>(token: string, path: string): Promise<T> {
  const res = await fetch(`${API}${path}`, { headers: { Authorization: `Bearer ${token}` } });
  if (res.status === 429) throw new Error("Strava rate limit reached (100 requests / 15 min). Try again in a few minutes.");
  if (res.status === 401 || res.status === 403) {
    const body = await res.text();
    if (/activity:read/i.test(body))
      throw new Error("Strava didn't give permission to read your activities. Tap Disconnect, then Connect again and keep \"View data about your activities\" ticked.");
    throw new Error("Strava access was revoked or expired. Tap Disconnect, then Connect again.");
  }
  if (!res.ok) throw new Error(`Strava request failed (${res.status}): ${(await res.text()).slice(0, 200)}`);
  return res.json() as Promise<T>;
}

export function mapSport(t: string): Sport {
  if (/swim/i.test(t)) return "swim";
  if (/ride|cycl|bike|velomobile|handcycle/i.test(t)) return "bike";
  if (/run|walk|hike/i.test(t)) return /walk|hike/i.test(t) ? "other" : "run";
  if (/weight|crossfit|workout|yoga|pilates|strength/i.test(t)) return "strength";
  return "other";
}

interface SummaryActivity {
  id: number;
  name: string;
  sport_type?: string;
  type: string;
  start_date_local: string;
  moving_time: number;
  elapsed_time: number;
  distance: number;
  total_elevation_gain?: number;
  average_heartrate?: number;
  max_heartrate?: number;
  average_speed?: number;
  max_speed?: number;
  average_cadence?: number;
  average_watts?: number;
  weighted_average_watts?: number;
  device_watts?: boolean;
  kilojoules?: number;
  calories?: number;
}

export function mapActivity(a: SummaryActivity): Activity {
  const raw = a.sport_type ?? a.type;
  return {
    id: `strava-${a.id}`,
    source: "strava",
    sport: mapSport(raw),
    rawType: raw,
    name: a.name,
    // start_date_local carries a misleading "Z"; strip it so it parses as local wall time
    start: a.start_date_local.replace(/Z$/, ""),
    movingTime: a.moving_time,
    elapsedTime: a.elapsed_time,
    distance: a.distance,
    elevationGain: a.total_elevation_gain,
    avgHr: a.average_heartrate,
    maxHr: a.max_heartrate,
    avgSpeed: a.average_speed,
    maxSpeed: a.max_speed,
    avgCadence: a.average_cadence,
    avgWatts: a.average_watts,
    weightedWatts: a.weighted_average_watts,
    deviceWatts: a.device_watts,
    kilojoules: a.kilojoules,
    calories: a.calories,
  };
}

/** Fetch all activities after the given epoch-seconds timestamp (paginated). */
export async function fetchActivities(token: string, afterEpoch: number, onPage?: (n: number) => void): Promise<Activity[]> {
  const out: Activity[] = [];
  for (let page = 1; page <= 15; page++) {
    const batch = await get<SummaryActivity[]>(token, `/athlete/activities?after=${Math.floor(afterEpoch)}&per_page=100&page=${page}`);
    out.push(...batch.map(mapActivity));
    onPage?.(out.length);
    if (batch.length < 100) break;
  }
  return out;
}

export async function fetchStreams(token: string, stravaId: string): Promise<Streams> {
  const id = stravaId.replace("strava-", "");
  const keys = "time,distance,heartrate,cadence,watts,velocity_smooth,altitude";
  const j = await get<Record<string, { data: number[] }>>(token, `/activities/${id}/streams?keys=${keys}&key_by_type=true`);
  return {
    time: j.time?.data ?? [],
    distance: j.distance?.data,
    heartrate: j.heartrate?.data,
    cadence: j.cadence?.data,
    watts: j.watts?.data,
    velocity: j.velocity_smooth?.data,
    altitude: j.altitude?.data,
  };
}

export async function fetchActivityDetail(token: string, stravaId: string): Promise<{ calories?: number }> {
  const id = stravaId.replace("strava-", "");
  return get<{ calories?: number }>(token, `/activities/${id}`);
}
