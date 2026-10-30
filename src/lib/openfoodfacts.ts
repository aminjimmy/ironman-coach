import type { FoodItem } from "./types";
import { round } from "./format";

/**
 * Open Food Facts: free, open-source food product database (https://world.openfoodfacts.org).
 * No API key; the read API allows browser (CORS) requests. Values come from product labels.
 */
const BASE = "https://world.openfoodfacts.org";
const FIELDS = "code,product_name,product_name_en,brands,serving_size,serving_quantity,nutriments,image_front_small_url";

export interface OffProduct {
  code: string;
  name: string;
  brand?: string;
  servingG?: number;
  servingLabel?: string;
  image?: string;
  hasNutrition: boolean;
  per100: { calories: number; carbs: number; protein: number; fat: number; fiber: number };
}

interface OffRaw {
  code?: string;
  product_name?: string;
  product_name_en?: string;
  brands?: string | string[];
  serving_size?: string;
  serving_quantity?: number | string;
  image_front_small_url?: string;
  nutriments?: Record<string, number | string | undefined>;
}

const num = (v: unknown) => {
  const n = typeof v === "string" ? parseFloat(v) : typeof v === "number" ? v : NaN;
  return Number.isFinite(n) ? n : 0;
};

function toProduct(p: OffRaw, code: string): OffProduct | undefined {
  const n = p.nutriments ?? {};
  const kcal = num(n["energy-kcal_100g"]) || num(n["energy_100g"]) / 4.184; // energy_100g is kJ
  const name = (p.product_name_en || p.product_name || "").trim();
  if (!name && !kcal) return undefined;
  const serving = num(p.serving_quantity);
  return {
    code: p.code ?? code,
    name: name || `Product ${code}`,
    brand: (Array.isArray(p.brands) ? p.brands[0] : p.brands?.split(",")[0])?.trim() || undefined,
    servingG: serving > 0 && serving < 2000 ? serving : undefined,
    servingLabel: p.serving_size,
    image: p.image_front_small_url,
    hasNutrition: kcal > 0,
    per100: {
      calories: round(kcal),
      carbs: round(num(n["carbohydrates_100g"]), 1),
      protein: round(num(n["proteins_100g"]), 1),
      fat: round(num(n["fat_100g"]), 1),
      fiber: round(num(n["fiber_100g"]), 1),
    },
  };
}

export async function lookupBarcode(code: string): Promise<OffProduct | undefined> {
  const clean = code.replace(/\D/g, "");
  if (clean.length < 6) throw new Error("That doesn't look like a barcode number.");
  const res = await fetch(`${BASE}/api/v2/product/${clean}.json?fields=${FIELDS}`);
  if (res.status === 404) return undefined;
  if (!res.ok) throw new Error(`Open Food Facts is unavailable right now (${res.status}).`);
  const j = await res.json();
  if (j.status !== 1 || !j.product) return undefined;
  return toProduct(j.product, clean);
}

/** Name search, biased to products sold in Malaysia (the search API is rate-limited: keep it to explicit taps). */
export async function searchProducts(q: string): Promise<OffProduct[]> {
  const params = new URLSearchParams({
    search_terms: q,
    search_simple: "1",
    action: "process",
    json: "1",
    page_size: "15",
    fields: FIELDS,
    tagtype_0: "countries",
    tag_contains_0: "contains",
    tag_0: "malaysia",
  });
  const res = await fetch(`${BASE}/cgi/search.pl?${params}`);
  if (!res.ok) throw new Error(`Product search is unavailable right now (${res.status}).`);
  const j = await res.json();
  return ((j.products ?? []) as OffRaw[]).map((p) => toProduct(p, p.code ?? "")).filter((p): p is OffProduct => !!p);
}

/** One serving (or 100 g) as a food-log item; the editor rescales macros when grams change. */
export function productToItem(p: OffProduct, grams = p.servingG ?? 100): FoodItem {
  const f = grams / 100;
  return {
    name: p.brand && !p.name.toLowerCase().includes(p.brand.toLowerCase()) ? `${p.brand} ${p.name}` : p.name,
    grams: Math.round(grams),
    calories: round(p.per100.calories * f),
    carbs: round(p.per100.carbs * f, 1),
    protein: round(p.per100.protein * f, 1),
    fat: round(p.per100.fat * f, 1),
    fiber: round(p.per100.fiber * f, 1),
  };
}
