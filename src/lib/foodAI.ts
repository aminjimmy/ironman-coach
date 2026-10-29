import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import type { FoodItem } from "./types";

const MODEL = "claude-opus-5-5";

const FoodSchema = z.object({
  title: z.string(),
  items: z.array(
    z.object({
      name: z.string(),
      grams: z.number(),
      calories: z.number(),
      protein: z.number(),
      carbs: z.number(),
      fat: z.number(),
      fiber: z.number(),
    }),
  ),
  confidence: z.enum(["low", "medium", "high"]),
  notes: z.string(),
});

export type FoodAnalysis = z.infer<typeof FoodSchema>;

const JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["title", "items", "confidence", "notes"],
  properties: {
    title: { type: "string", description: "Short name for the meal, e.g. 'Chicken rice bowl'" },
    items: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name", "grams", "calories", "protein", "carbs", "fat", "fiber"],
        properties: {
          name: { type: "string" },
          grams: { type: "number", description: "Estimated edible weight in grams" },
          calories: { type: "number", description: "kcal" },
          protein: { type: "number", description: "grams" },
          carbs: { type: "number", description: "grams" },
          fat: { type: "number", description: "grams" },
          fiber: { type: "number", description: "grams" },
        },
      },
    },
    confidence: { type: "string", enum: ["low", "medium", "high"] },
    notes: { type: "string", description: "Assumptions made (cooking oil, hidden sauces, portion cues) in one or two sentences" },
  },
};

const SYSTEM = `You are a sports dietitian estimating the nutrition of a meal from a photo for an endurance athlete's food log.
Identify each distinct food component, estimate its edible weight in grams from visual cues (plate size ~26 cm, cutlery, hands, packaging), and give macros per component using standard food-composition values.
Account for likely cooking oils, butter, dressings and sauces. If the user gives a hint, trust it over the image.
If the image contains a nutrition label, read the label values and scale to the portion shown.
If the image does not show food or drink, return an empty items array with confidence "low" and explain in notes.`;

/** Downscale an image file to a JPEG data URL (keeps requests small and fast). */
export async function resizeImage(file: File | Blob, maxSide: number, quality = 0.85): Promise<string> {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bmp.width * scale);
  canvas.height = Math.round(bmp.height * scale);
  canvas.getContext("2d")!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", quality);
}

export async function analyzeFood(apiKey: string, imageDataUrl: string, hint: string): Promise<FoodAnalysis & { items: FoodItem[] }> {
  if (!apiKey) throw new Error("Add your Anthropic API key in Settings to analyse food photos.");
  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
  const data = imageDataUrl.split(",")[1];

  let response;
  try {
    response = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 16000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system: SYSTEM,
      output_config: {
        effort: "medium",
        format: { type: "json_schema", schema: JSON_SCHEMA },
      },
      messages: [
        {
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: "image/jpeg", data } },
            { type: "text", text: hint.trim() ? `Hint from the athlete: ${hint.trim()}` : "Estimate the nutrition of this meal." },
          ],
        },
      ],
    });
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) throw new Error("Anthropic API key was rejected. Check it in Settings.");
    if (err instanceof Anthropic.RateLimitError) throw new Error("Anthropic rate limit hit. Wait a moment and retry.");
    if (err instanceof Anthropic.APIConnectionError) throw new Error("Couldn't reach the Anthropic API. Check your connection.");
    if (err instanceof Anthropic.APIError) throw new Error(`Anthropic API error ${err.status}: ${err.message}`);
    throw err;
  }

  if (response.stop_reason === "refusal") throw new Error("The model declined to analyse this image.");
  if (response.stop_reason === "max_tokens") throw new Error("The analysis was cut off. Try again.");
  const text = response.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
  const parsed = FoodSchema.safeParse(JSON.parse(text));
  if (!parsed.success) throw new Error("Unexpected response format from the model.");
  return parsed.data;
}
