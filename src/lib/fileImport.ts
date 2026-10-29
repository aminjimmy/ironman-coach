import type { Activity, Sport, Streams } from "./types";
import { normalizedPower } from "./metrics";
import { mapSport } from "./strava";
import { uid } from "./format";

interface Point {
  t: number; // epoch ms
  lat?: number;
  lon?: number;
  ele?: number;
  dist?: number;
  hr?: number;
  cad?: number;
  watts?: number;
  speed?: number;
}

function haversine(a: Point, b: Point): number {
  if (a.lat == null || b.lat == null || a.lon == null || b.lon == null) return 0;
  const R = 6371000;
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLon = (b.lon - a.lon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

const num = (el: Element | null | undefined) => {
  const v = el?.textContent ? Number(el.textContent) : NaN;
  return isFinite(v) ? v : undefined;
};

/** Find first descendant whose local name matches (ignores XML namespaces/prefixes). */
function child(el: Element, name: string): Element | undefined {
  for (const c of Array.from(el.getElementsByTagName("*"))) if (c.localName === name) return c;
  return undefined;
}

function parseGpx(doc: Document): { points: Point[]; type?: string; name?: string } {
  const pts = Array.from(doc.getElementsByTagName("trkpt"));
  const points = pts.map((p) => ({
    t: Date.parse(child(p, "time")?.textContent ?? ""),
    lat: Number(p.getAttribute("lat")),
    lon: Number(p.getAttribute("lon")),
    ele: num(child(p, "ele")),
    hr: num(child(p, "hr")),
    cad: num(child(p, "cad")),
    watts: num(child(p, "power")) ?? num(child(p, "PowerInWatts")),
  }));
  const trk = doc.getElementsByTagName("trk")[0];
  return { points, type: trk ? child(trk, "type")?.textContent ?? undefined : undefined, name: doc.getElementsByTagName("name")[0]?.textContent ?? undefined };
}

function parseTcx(doc: Document): { points: Point[]; type?: string } {
  const act = doc.getElementsByTagName("Activity")[0];
  const pts = Array.from(doc.getElementsByTagName("Trackpoint"));
  const points = pts.map((p) => {
    const pos = child(p, "Position");
    return {
      t: Date.parse(child(p, "Time")?.textContent ?? ""),
      lat: pos ? num(child(pos, "LatitudeDegrees")) : undefined,
      lon: pos ? num(child(pos, "LongitudeDegrees")) : undefined,
      ele: num(child(p, "AltitudeMeters")),
      dist: num(child(p, "DistanceMeters")),
      hr: (() => {
        const h = child(p, "HeartRateBpm");
        return h ? num(child(h, "Value")) : undefined;
      })(),
      cad: num(child(p, "Cadence")) ?? num(child(p, "RunCadence")),
      watts: num(child(p, "Watts")),
      speed: num(child(p, "Speed")),
    };
  });
  return { points, type: act?.getAttribute("Sport") ?? undefined };
}

async function parseFit(buf: ArrayBuffer): Promise<{ points: Point[]; type?: string }> {
  const { Decoder, Stream } = await import("@garmin/fitsdk");
  const decoder = new Decoder(Stream.fromArrayBuffer(buf));
  if (!decoder.isFIT()) throw new Error("Not a valid FIT file");
  const { messages } = decoder.read();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const recs: any[] = messages.recordMesgs ?? [];
  const semi = 180 / 2 ** 31;
  const points: Point[] = recs.map((r) => ({
    t: new Date(r.timestamp).getTime(),
    lat: r.positionLat != null ? r.positionLat * semi : undefined,
    lon: r.positionLong != null ? r.positionLong * semi : undefined,
    ele: r.enhancedAltitude ?? r.altitude,
    dist: r.distance,
    hr: r.heartRate,
    cad: r.cadence,
    watts: r.power,
    speed: r.enhancedSpeed ?? r.speed,
  }));
  const session = messages.sessionMesgs?.[0];
  return { points, type: session?.sport ? String(session.sport) : undefined };
}

function guessSport(type: string | undefined, avgSpeed: number, hasPower: boolean): Sport {
  if (type) {
    const t = type.toLowerCase();
    if (t === "biking" || t === "1" || t === "2") return "bike";
    const s = mapSport(t);
    if (s !== "other") return s;
  }
  if (hasPower || avgSpeed > 5) return "bike";
  if (avgSpeed > 1.6) return "run";
  return "swim";
}

function build(points: Point[], type: string | undefined, fileName: string, forced?: Sport): { activity: Activity; streams: Streams } {
  const pts = points.filter((p) => isFinite(p.t)).sort((a, b) => a.t - b.t);
  if (pts.length < 2) throw new Error("No timed track points found in file");
  const t0 = pts[0].t;
  const time: number[] = [];
  const distance: number[] = [];
  const velocity: number[] = [];
  let d = 0;
  for (let i = 0; i < pts.length; i++) {
    time.push(Math.round((pts[i].t - t0) / 1000));
    if (pts[i].dist != null) d = pts[i].dist!;
    else if (i > 0) d += haversine(pts[i - 1], pts[i]);
    distance.push(d);
  }
  for (let i = 0; i < pts.length; i++) {
    if (pts[i].speed != null) {
      velocity.push(pts[i].speed!);
      continue;
    }
    const j = Math.max(0, i - 5);
    const dt = time[i] - time[j];
    velocity.push(dt > 0 ? (distance[i] - distance[j]) / dt : 0);
  }
  const has = (k: keyof Point) => pts.some((p) => p[k] != null && (p[k] as number) > 0);
  const hr = has("hr") ? pts.map((p) => p.hr ?? 0) : undefined;
  const cad = has("cad") ? pts.map((p) => p.cad ?? 0) : undefined;
  const watts = has("watts") ? pts.map((p) => p.watts ?? 0) : undefined;
  const alt = has("ele") ? pts.map((p) => p.ele ?? 0) : undefined;

  let moving = 0;
  for (let i = 1; i < time.length; i++) {
    const dt = time[i] - time[i - 1];
    if (dt <= 10 && (velocity[i] > 0.3 || !distance[distance.length - 1])) moving += dt;
  }
  moving = Math.max(moving, 1);
  const total = distance[distance.length - 1];
  const avgSpeed = total / moving;
  const sport = forced ?? guessSport(type, avgSpeed, !!watts);

  const avgNz = (xs?: number[]) => {
    const v = xs?.filter((x) => x > 0) ?? [];
    return v.length ? v.reduce((a, b) => a + b, 0) / v.length : undefined;
  };
  let gain = 0;
  if (alt) {
    let ref = alt[0];
    for (const a of alt) {
      if (a - ref > 2) {
        gain += a - ref;
        ref = a;
      } else if (a < ref) ref = a;
    }
  }
  const streams: Streams = { time, distance, velocity, heartrate: hr, cadence: cad, watts, altitude: alt };
  const activity: Activity = {
    id: `file-${uid()}`,
    source: "file",
    sport,
    rawType: type ?? sport,
    name: fileName.replace(/\.(gpx|tcx|fit)$/i, ""),
    start: new Date(t0).toISOString().slice(0, 19),
    movingTime: Math.round(moving),
    elapsedTime: time[time.length - 1],
    distance: total,
    elevationGain: alt ? Math.round(gain) : undefined,
    avgHr: avgNz(hr),
    maxHr: hr ? Math.max(...hr) : undefined,
    avgSpeed,
    maxSpeed: Math.max(...velocity),
    // Strava reports run cadence per leg; FIT/TCX do the same, so keep that convention
    avgCadence: avgNz(cad),
    avgWatts: avgNz(watts),
    weightedWatts: watts ? Math.round(normalizedPower(time, watts)) : undefined,
    deviceWatts: !!watts,
    hasStreams: true,
  };
  // toISOString is UTC; store local wall time like Strava does
  const local = new Date(t0 - new Date(t0).getTimezoneOffset() * 60000);
  activity.start = local.toISOString().slice(0, 19);
  return { activity, streams };
}

export async function importFile(file: File, forced?: Sport): Promise<{ activity: Activity; streams: Streams }> {
  const name = file.name.toLowerCase();
  if (name.endsWith(".fit")) {
    const { points, type } = await parseFit(await file.arrayBuffer());
    return build(points, type, file.name, forced);
  }
  const text = await file.text();
  const doc = new DOMParser().parseFromString(text, "application/xml");
  if (doc.getElementsByTagName("parsererror").length) throw new Error("Could not parse XML file");
  if (name.endsWith(".tcx") || doc.getElementsByTagName("TrainingCenterDatabase").length) {
    const { points, type } = parseTcx(doc);
    return build(points, type, file.name, forced);
  }
  const { points, type, name: n } = parseGpx(doc);
  return build(points, type, n || file.name, forced);
}
