import { useEffect, useRef, useState } from "react";
import { lookupBarcode, searchProducts, productToItem, type OffProduct } from "../lib/openfoodfacts";
import type { FoodItem } from "../lib/types";
import { Spinner } from "./ui";

interface Detector { detect: (src: CanvasImageSource | ImageBitmap) => Promise<{ rawValue: string }[]> }
type DetectorCtor = new (opts: { formats: string[] }) => Detector;
const FORMATS = ["ean_13", "ean_8", "upc_a", "upc_e", "code_128"];
const detectorCtor = (): DetectorCtor | undefined => (window as unknown as { BarcodeDetector?: DetectorCtor }).BarcodeDetector;

/**
 * Scan a packaged food's barcode with the camera (Chrome's built-in barcode reader),
 * or type the number / search by name. Looks the product up in Open Food Facts.
 */
export function BarcodeScanner({ onFound, onClose }: { onFound: (item: FoodItem, title: string, missingNutrition: boolean) => void; onClose: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [mode, setMode] = useState<"camera" | "manual">(detectorCtor() ? "camera" : "manual");
  const [status, setStatus] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [code, setCode] = useState("");
  const [q, setQ] = useState("");
  const [results, setResults] = useState<OffProduct[] | null>(null);
  const handled = useRef(false);

  const finish = (p: OffProduct) => {
    const item = productToItem(p);
    onFound(item, item.name, !p.hasNutrition);
  };

  const lookup = async (raw: string) => {
    setBusy(true);
    setStatus(`Looking up ${raw}…`);
    try {
      const p = await lookupBarcode(raw);
      if (p) finish(p);
      else {
        setStatus(`Barcode ${raw} isn't in Open Food Facts yet. Search by name or enter it manually.`);
        setMode("manual");
        handled.current = false;
      }
    } catch (e) {
      setStatus((e as Error).message);
      handled.current = false;
    } finally {
      setBusy(false);
    }
  };

  // Live camera scanning
  useEffect(() => {
    if (mode !== "camera") return;
    const Ctor = detectorCtor();
    if (!Ctor) return;
    let stream: MediaStream | undefined;
    let timer: number | undefined;
    let stopped = false;
    const detector = new Ctor({ formats: FORMATS });
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false });
        if (stopped) return stream.getTracks().forEach((t) => t.stop());
        const v = videoRef.current!;
        v.srcObject = stream;
        await v.play();
        setStatus("Point the camera at the barcode");
        const tick = async () => {
          if (stopped || handled.current) return;
          try {
            const codes = await detector.detect(v);
            const hit = codes.find((c) => /^\d{8,14}$/.test(c.rawValue));
            if (hit) {
              handled.current = true;
              navigator.vibrate?.(60);
              await lookup(hit.rawValue);
            }
          } catch {
            /* frame not ready */
          }
          timer = window.setTimeout(tick, 250);
        };
        tick();
      } catch (e) {
        setStatus((e as Error).name === "NotAllowedError" ? "Camera permission denied. Type the barcode number instead." : "Couldn't open the camera. Type the barcode number instead.");
        setMode("manual");
      }
    })();
    return () => {
      stopped = true;
      clearTimeout(timer);
      stream?.getTracks().forEach((t) => t.stop());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  const search = async () => {
    setBusy(true);
    setStatus("");
    try {
      const r = await searchProducts(q);
      setResults(r);
      if (!r.length) setStatus("No products found. Try a shorter name or the brand.");
    } catch (e) {
      setStatus((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="stack">
      <div className="spread">
        <h2>Scan a barcode</h2>
        <button className="icon-btn" onClick={onClose} aria-label="Close">✕</button>
      </div>
      {mode === "camera" && (
        <div style={{ position: "relative", borderRadius: 12, overflow: "hidden", background: "#000" }}>
          <video ref={videoRef} playsInline muted style={{ width: "100%", maxHeight: 320, objectFit: "cover", display: "block" }} />
          <div aria-hidden style={{ position: "absolute", left: "12%", right: "12%", top: "40%", height: "20%", border: "2px solid rgba(255,255,255,0.8)", borderRadius: 8 }} />
        </div>
      )}
      {status && <div className="small" role="status" style={{ color: "var(--text-2)" }}>{busy && <Spinner />} {status}</div>}

      <div className="row" style={{ flexWrap: "nowrap" }}>
        <input inputMode="numeric" placeholder="Barcode number, e.g. 9556001…" value={code} onChange={(e) => setCode(e.target.value)} />
        <button className="btn" disabled={busy || code.replace(/\D/g, "").length < 6} onClick={() => lookup(code)}>Look up</button>
      </div>
      <div className="row" style={{ flexWrap: "nowrap" }}>
        <input placeholder="…or search by name: Milo, Gardenia, 100PLUS" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Enter" && q.trim() && search()} />
        <button className="btn" disabled={busy || !q.trim()} onClick={search}>Search</button>
      </div>
      {mode === "manual" && detectorCtor() && <button className="btn sm" onClick={() => { handled.current = false; setMode("camera"); }}>📷 Use camera</button>}

      {results && results.length > 0 && (
        <div className="list">
          {results.map((p) => (
            <button key={p.code + p.name} className="list-item" onClick={() => finish(p)}>
              {p.image ? <img className="photo" src={p.image} alt="" style={{ width: 44, height: 44 }} /> : <span className="ic" style={{ background: "var(--surface-2)" }}>📦</span>}
              <div className="grow small">
                <div style={{ fontWeight: 600 }}>{p.brand ? `${p.brand} · ` : ""}{p.name}</div>
                <div className="muted num">
                  {p.hasNutrition ? `per 100 g: ${p.per100.calories} kcal · C ${p.per100.carbs} · P ${p.per100.protein} · F ${p.per100.fat}` : "no nutrition data yet: you'll enter it from the label"}
                </div>
              </div>
            </button>
          ))}
        </div>
      )}
      <p className="tiny muted">
        Product data from <a href="https://world.openfoodfacts.org" target="_blank" rel="noreferrer">Open Food Facts</a>, a free open database built by volunteers. Check the label if numbers look off; you can adjust grams on the next screen.
      </p>
    </div>
  );
}
