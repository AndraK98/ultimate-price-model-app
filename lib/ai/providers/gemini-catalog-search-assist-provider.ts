import { runWithGeminiModelFallback } from "@/lib/ai/google-genai";
import {
  type CatalogSearchAssistProvider,
  type CatalogSearchAssistRequest,
  type CatalogSearchAssistResult,
  type ValuationCatalogContext,
} from "@/lib/ai/types";
import { catalogSearchAssistResultSchema } from "@/lib/validators";

function distinctValues(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean))).slice(0, 24);
}

export class GeminiCatalogSearchAssistProvider implements CatalogSearchAssistProvider {
  providerName = "gemini" as const;

  constructor(
    private readonly apiKey: string,
    private readonly model: string,
  ) {}

  async assist(
    input: CatalogSearchAssistRequest,
    context: ValuationCatalogContext,
  ): Promise<CatalogSearchAssistResult> {
    const stoneExcerpt = context.stones.slice(0, 8).map((stone) => ({
      sku: stone.stone_id,
      name: stone.name,
      shape: stone.shape,
      color: stone.color,
      quality: stone.quality,
      size: `${stone.min_size_mm}x${stone.max_size_mm}`,
      carat: stone.carat,
      final_price: stone.final_price,
    }));
    const settingExcerpt = context.settings.slice(0, 8).map((setting) => ({
      sku: setting.setting_id,
      style: setting.style,
      metal: setting.metal,
      complexity_level: setting.complexity_level,
      gold_weight_g: setting.gold_weight_g,
      labor_cost: setting.labor_cost,
      base_price: setting.base_price,
    }));

    const prompt =
      input.target === "stone"
        ? [
            "You convert a jewelry employee's natural-language stone search into strict structured filters.",
            "Do not explain. Return JSON only.",
            "Use only these stone filter keys when they are supported by the query: stoneId, name, shape, color, quality, size, minCarat, maxCarat, minPricePerCarat, maxPricePerCarat.",
            "If a single exact carat or price is requested, set both min and max to that same number.",
            "Keep size as the raw best-match size text from the query, such as '0.6x0.8 mm'.",
            "If the query is fully expressed by filters, set normalized_query to an empty string. Otherwise keep only the leftover free-text part.",
            "Summary must be one short sentence describing the applied filters.",
            `Employee query: ${input.query}`,
            `Common stone names: ${JSON.stringify(distinctValues(context.stones.map((stone) => stone.name)))}`,
            `Common stone shapes: ${JSON.stringify(distinctValues(context.stones.map((stone) => stone.shape)))}`,
            `Common stone colors: ${JSON.stringify(distinctValues(context.stones.map((stone) => stone.color)))}`,
            `Common stone quality labels: ${JSON.stringify(distinctValues(context.stones.map((stone) => stone.quality)))}`,
            `Sample stones: ${JSON.stringify(stoneExcerpt)}`,
            "Return JSON with keys normalized_query, summary, stone_filters.",
          ].join("\n")
        : [
            "You convert a jewelry employee's natural-language setting search into strict structured filters.",
            "Do not explain. Return JSON only.",
            "Use only these setting filter keys when they are supported by the query: settingId, style, metal, minWeightG, maxWeightG, minComplexity, maxComplexity, minLaborCost, maxLaborCost, minBasePrice, maxBasePrice.",
            "If a single exact weight, complexity, labor, or price is requested, set both min and max to that same number where applicable.",
            "If the query is fully expressed by filters, set normalized_query to an empty string. Otherwise keep only the leftover free-text part.",
            "Summary must be one short sentence describing the applied filters.",
            `Employee query: ${input.query}`,
            `Common setting styles: ${JSON.stringify(distinctValues(context.settings.map((setting) => setting.style)))}`,
            `Common setting metals: ${JSON.stringify(distinctValues(context.settings.map((setting) => setting.metal)))}`,
            `Sample settings: ${JSON.stringify(settingExcerpt)}`,
            "Return JSON with keys normalized_query, summary, setting_filters.",
          ].join("\n");

    const response = await runWithGeminiModelFallback(this.apiKey, this.model, (ai, model) =>
      ai.models.generateContent({
        model,
        contents: [
          {
            role: "user",
            parts: [{ text: prompt }],
          },
        ],
        config: {
          responseMimeType: "application/json",
          temperature: 0.1,
          systemInstruction:
            "You convert jewelry catalog search descriptions into strict structured filters for the Capucinne internal app. Return only JSON.",
        },
      }),
    );

    const text =
      typeof response.text === "string"
        ? response.text.trim()
        : typeof response.text === "function"
          ? String(await response.text()).trim()
          : "";
    if (!text) {
      throw new Error("Gemini catalog search assist returned no content.");
    }

    const parsed = catalogSearchAssistResultSchema.parse(JSON.parse(text));
    return {
      normalizedQuery: parsed.normalized_query,
      summary: parsed.summary,
      stoneFilters: parsed.stone_filters,
      settingFilters: parsed.setting_filters,
    };
  }
}
