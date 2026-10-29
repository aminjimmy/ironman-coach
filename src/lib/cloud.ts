import { useApp, syncedSnapshot, DEFAULT_RACE_PREFS, type SyncedData } from "./store";

/**
 * Cloud backup & sync through a secret GitHub Gist owned by the athlete.
 * data.enc.json is encrypted on the device (AES-GCM, key derived from a passphrase with PBKDF2),
 * so the gist only ever holds ciphertext. training-plan.ics is plain text so calendars can subscribe to it.
 */

const API = "https://api.github.com";
const DESCRIPTION = "Ironman Coach sync (encrypted)";
const DATA_FILE = "data.enc.json";
const ICS_FILE = "training-plan.ics";

// ---------- crypto ----------

const b64 = (buf: ArrayBuffer | Uint8Array) => {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
};
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function deriveKey(passphrase: string, salt: Uint8Array): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(passphrase), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: salt as BufferSource, iterations: 200_000, hash: "SHA-256" },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

async function gzip(text: string): Promise<{ bytes: Uint8Array; gz: boolean }> {
  const raw = new TextEncoder().encode(text);
  if (typeof CompressionStream === "undefined") return { bytes: raw, gz: false };
  const stream = new Blob([raw]).stream().pipeThrough(new CompressionStream("gzip"));
  return { bytes: new Uint8Array(await new Response(stream).arrayBuffer()), gz: true };
}

async function gunzip(bytes: Uint8Array, gz: boolean): Promise<string> {
  if (!gz) return new TextDecoder().decode(bytes);
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream("gzip"));
  return new Response(stream).text();
}

export async function encrypt(data: unknown, passphrase: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(passphrase, salt);
  const { bytes, gz } = await gzip(JSON.stringify(data));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, bytes as BufferSource);
  return JSON.stringify({ v: 1, gz, salt: b64(salt), iv: b64(iv), data: b64(ct) });
}

export async function decrypt<T>(payload: string, passphrase: string): Promise<T> {
  const p = JSON.parse(payload);
  const key = await deriveKey(passphrase, unb64(p.salt));
  let plain: ArrayBuffer;
  try {
    plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(p.iv) }, key, unb64(p.data));
  } catch {
    throw new Error("Couldn't unlock the cloud backup: the passphrase doesn't match the one used on your other device.");
  }
  return JSON.parse(await gunzip(new Uint8Array(plain), !!p.gz)) as T;
}

// ---------- merge ----------

type WithId = { id: string; updatedAt?: number };

function mergeById<T extends WithId>(a: T[], b: T[], tomb: Record<string, number>): T[] {
  const map = new Map<string, T>();
  for (const x of [...a, ...b]) {
    const prev = map.get(x.id);
    if (!prev || (x.updatedAt ?? 0) > (prev.updatedAt ?? 0)) map.set(x.id, x);
  }
  return [...map.values()].filter((x) => !(tomb[x.id] && tomb[x.id] >= (x.updatedAt ?? 0)));
}

function mergeStamped<T extends { updatedAt: number }>(a: Record<string, T>, b: Record<string, T>): Record<string, T> {
  const out = { ...a };
  for (const [k, v] of Object.entries(b)) if (!out[k] || v.updatedAt > out[k].updatedAt) out[k] = v;
  return out;
}

/** Combine two devices' data: newest record wins, deletions (tombstones) propagate. */
export function mergeData(local: SyncedData, remote: SyncedData): SyncedData {
  const newer = (remote.modifiedAt ?? 0) > (local.modifiedAt ?? 0) ? remote : local;
  const tombstones = { ...local.tombstones };
  for (const [k, v] of Object.entries(remote.tombstones ?? {})) tombstones[k] = Math.max(tombstones[k] ?? 0, v);
  const weights = new Map(local.weights.map((w) => [w.date, w]));
  for (const w of remote.weights ?? []) if (!weights.has(w.date) || newer === remote) weights.set(w.date, w);
  const water = { ...local.water };
  for (const [d, ml] of Object.entries(remote.water ?? {})) water[d] = newer === remote ? ml : Math.max(water[d] ?? 0, ml);
  const favs = new Map(local.foodFavorites.map((f) => [f.title.toLowerCase(), f]));
  for (const f of remote.foodFavorites ?? []) if (newer === remote || !favs.has(f.title.toLowerCase())) favs.set(f.title.toLowerCase(), f);
  if (newer === remote) for (const k of [...favs.keys()]) if (!(remote.foodFavorites ?? []).some((f) => f.title.toLowerCase() === k)) favs.delete(k);
  const profile =
    (remote.profile?.updatedAt ?? 0) > (local.profile?.updatedAt ?? 0) ? remote.profile : local.profile ?? remote.profile;
  return {
    profile,
    weights: [...weights.values()].sort((x, y) => (x.date < y.date ? -1 : 1)),
    events: mergeById(local.events, remote.events ?? [], tombstones),
    activeEventId: newer.activeEventId ?? local.activeEventId ?? remote.activeEventId,
    activities: mergeById(local.activities, remote.activities ?? [], tombstones).sort((x, y) => (x.start < y.start ? 1 : -1)),
    foods: mergeById(local.foods, remote.foods ?? [], tombstones),
    foodFavorites: [...favs.values()],
    water,
    sessionMarks: mergeStamped(local.sessionMarks, remote.sessionMarks ?? {}),
    disruptions: mergeById(local.disruptions, remote.disruptions ?? [], tombstones),
    checkins: mergeStamped(local.checkins, remote.checkins ?? {}),
    sweatTests: mergeById(local.sweatTests, remote.sweatTests ?? [], tombstones),
    racePrefs: { ...DEFAULT_RACE_PREFS, ...newer.racePrefs },
    tombstones,
    modifiedAt: Math.max(local.modifiedAt ?? 0, remote.modifiedAt ?? 0),
  };
}

// ---------- GitHub Gist ----------

async function gh<T>(token: string, path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      ...(init.body ? { "Content-Type": "application/json" } : {}),
    },
  });
  if (res.status === 401) throw new Error("GitHub rejected the token. Create a new one with Gists read & write access.");
  if (res.status === 403 || res.status === 404) {
    throw new Error(`GitHub refused access (${res.status}). Make sure the token has the Gists permission (read and write).`);
  }
  if (!res.ok) throw new Error(`GitHub error ${res.status}: ${(await res.text()).slice(0, 160)}`);
  return res.json() as Promise<T>;
}

interface GistFile { content?: string; truncated?: boolean; raw_url?: string }
interface Gist { id: string; description: string; owner?: { login: string }; files: Record<string, GistFile> }

async function fileContent(f: GistFile | undefined): Promise<string | undefined> {
  if (!f) return undefined;
  if (!f.truncated && f.content != null) return f.content;
  return f.raw_url ? (await fetch(f.raw_url)).text() : undefined;
}

let icsProvider: () => string | undefined = () => undefined;
/** The app registers how to build the current plan's calendar, which is published alongside the data. */
export const setIcsProvider = (fn: () => string | undefined) => (icsProvider = fn);

let running: Promise<string> | null = null;
let lastPushed = 0;

/** Pull, merge and push. Returns a short status message. */
export function syncCloud(): Promise<string> {
  if (running) return running;
  running = (async () => {
    const { settings, setSettings } = useApp.getState();
    const token = settings.githubToken;
    const pass = settings.cloudPassphrase;
    if (!token || !pass) throw new Error("Add a GitHub token and a passphrase in Settings to turn on cloud sync.");
    try {
      let gist: Gist | undefined;
      if (settings.gistId) {
        gist = await gh<Gist>(token, `/gists/${settings.gistId}`).catch(() => undefined);
      }
      if (!gist) {
        const list = await gh<Gist[]>(token, "/gists?per_page=100");
        const found = list.find((g) => g.description === DESCRIPTION);
        if (found) gist = await gh<Gist>(token, `/gists/${found.id}`);
      }

      let merged = syncedSnapshot(useApp.getState());
      let changedLocally = false;
      const remoteText = await fileContent(gist?.files[DATA_FILE]);
      if (remoteText) {
        const remote = await decrypt<SyncedData>(remoteText, pass);
        merged = mergeData(merged, remote);
        changedLocally = JSON.stringify(merged) !== JSON.stringify(syncedSnapshot(useApp.getState()));
        // apply without bumping modifiedAt (this isn't a new local edit) and without re-triggering auto-sync
        lastPushed = merged.modifiedAt;
        if (changedLocally) useApp.setState(merged);
      }

      const files: Record<string, { content: string }> = { [DATA_FILE]: { content: await encrypt(merged, pass) } };
      const ics = icsProvider();
      if (ics) files[ICS_FILE] = { content: ics };
      if (gist) {
        gist = await gh<Gist>(token, `/gists/${gist.id}`, { method: "PATCH", body: JSON.stringify({ files }) });
      } else {
        gist = await gh<Gist>(token, "/gists", { method: "POST", body: JSON.stringify({ description: DESCRIPTION, public: false, files }) });
      }
      lastPushed = merged.modifiedAt;
      setSettings({ gistId: gist.id, gistOwner: gist.owner?.login, lastCloudSync: Date.now(), cloudError: undefined });
      return changedLocally ? "Synced: merged changes from your other devices" : "Backed up to the cloud";
    } catch (e) {
      const msg = e instanceof TypeError ? "Couldn't reach GitHub. Check your connection." : (e as Error).message;
      setSettings({ cloudError: msg });
      throw new Error(msg);
    } finally {
      running = null;
    }
  })();
  return running;
}

export const cloudEnabled = () => {
  const s = useApp.getState().settings;
  return !!(s.githubToken && s.cloudPassphrase);
};

/** Push local edits ~20 s after they stop, while sync is enabled. */
export function startAutoCloudSync(): () => void {
  let timer: number | undefined;
  const unsub = useApp.subscribe((s, prev) => {
    if (!cloudEnabled() || s.modifiedAt === prev.modifiedAt || s.modifiedAt === lastPushed) return;
    clearTimeout(timer);
    timer = window.setTimeout(() => syncCloud().catch(() => {}), 20_000);
  });
  return () => {
    clearTimeout(timer);
    unsub();
  };
}

export function calendarUrl(): string | undefined {
  const s = useApp.getState().settings;
  return s.gistId && s.gistOwner ? `https://gist.githubusercontent.com/${s.gistOwner}/${s.gistId}/raw/${ICS_FILE}` : undefined;
}
