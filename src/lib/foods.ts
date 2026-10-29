import type { FoodItem } from "./types";

/**
 * Typical single-serving estimates for common Malaysian dishes and training foods
 * (rounded, based on published hawker-food nutrition tables). Portions vary a lot by stall,
 * so these are starting points: adjust grams after adding.
 */
const F = (name: string, grams: number, calories: number, carbs: number, protein: number, fat: number, fiber = 0): FoodItem => ({
  name, grams, calories, carbs, protein, fat, fiber,
});

export const LOCAL_FOODS: FoodItem[] = [
  F("Nasi lemak biasa (egg, sambal, ikan bilis, peanuts)", 280, 500, 60, 14, 23, 3),
  F("Nasi lemak ayam goreng", 400, 800, 75, 35, 40, 3),
  F("Roti canai with dhal", 150, 300, 40, 7, 12, 3),
  F("Roti telur", 160, 350, 36, 11, 18, 2),
  F("Chapati with dhal", 150, 230, 35, 8, 6, 5),
  F("Thosai with chutney", 160, 250, 42, 6, 6, 3),
  F("Mee goreng mamak", 350, 660, 85, 20, 26, 4),
  F("Nasi goreng kampung", 350, 640, 85, 20, 24, 3),
  F("Char kuey teow", 380, 740, 76, 23, 38, 3),
  F("Chicken rice (roasted)", 380, 600, 75, 30, 20, 1),
  F("Curry laksa", 500, 590, 55, 22, 32, 4),
  F("Asam laksa", 550, 430, 70, 18, 8, 4),
  F("Mee rebus", 500, 560, 80, 18, 18, 4),
  F("Wantan mee (dry)", 320, 410, 55, 18, 13, 2),
  F("Nasi campur (rice + 1 meat + 2 veg)", 450, 700, 90, 30, 24, 5),
  F("Nasi kandar (rice, fried chicken, curry, veg)", 550, 900, 100, 40, 38, 5),
  F("Satay ayam, 10 sticks + peanut sauce", 250, 450, 20, 35, 25, 3),
  F("Mee hoon soup", 450, 350, 55, 15, 7, 2),
  F("Yong tau foo soup with noodles", 500, 450, 55, 25, 14, 4),
  F("Ikan bakar (grilled fish)", 200, 300, 2, 40, 14, 0),
  F("Roti bakar kaya butter (2 slices)", 90, 300, 40, 6, 13, 1),
  F("Half-boiled eggs (2)", 100, 140, 1, 12, 10, 0),
  F("Curry puff", 70, 250, 25, 4, 15, 1),
  F("Pisang goreng (2 pcs)", 100, 250, 35, 2, 12, 2),
  F("Kuih (1 pc)", 60, 140, 25, 1, 4, 0),
  F("Teh tarik", 250, 150, 25, 3, 4, 0),
  F("Kopi O (sweetened)", 250, 70, 17, 0, 0, 0),
  F("Milo ais", 300, 220, 35, 6, 6, 1),
  F("Teh O ais limau", 300, 80, 20, 0, 0, 0),
  F("White rice, 1 cup", 200, 260, 57, 5, 0.6, 0.6),
  F("Chicken breast, grilled", 150, 250, 0, 46, 5, 0),
  F("Oats with milk", 300, 300, 45, 12, 8, 5),
  F("Banana (medium)", 120, 105, 27, 1, 0.4, 3),
  F("Dates (3)", 24, 70, 18, 0.5, 0, 2),
  F("Energy gel", 40, 100, 25, 0, 0, 0),
  F("100PLUS isotonic (500 ml)", 500, 125, 31, 0, 0, 0),
  F("Whey protein shake (1 scoop, water)", 330, 120, 3, 24, 1.5, 0),
  F("Greek yoghurt (plain)", 170, 150, 6, 17, 6, 0),
  F("Wholemeal bread (2 slices) with peanut butter", 90, 300, 30, 12, 15, 5),
];

export function searchFoods(q: string): FoodItem[] {
  const t = q.trim().toLowerCase();
  if (!t) return LOCAL_FOODS.slice(0, 8);
  return LOCAL_FOODS.filter((f) => f.name.toLowerCase().includes(t)).slice(0, 12);
}
