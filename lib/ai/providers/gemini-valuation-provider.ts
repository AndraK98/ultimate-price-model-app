import { extractGrounding, runWithGeminiModelFallback } from "@/lib/ai/google-genai";
import { type ValuationCatalogContext, type ValuationProvider } from "@/lib/ai/types";
import { type ValuationEstimate, type ValuationRequestInput } from "@/lib/types";
import { valuationEstimateSchema } from "@/lib/validators";

function parseDataUrl(dataUrl: string): { mimeType: string; data: string } | null {
  const match = dataUrl.match(/^data:(.+?);base64,(.+)$/);
  if (!match) {
    return null;
  }

  return {
    mimeType: match[1],
    data: match[2],
  };
}

function matchesDescription(haystack: string, description: string) {
  const normalizedHaystack = haystack.toLowerCase();
  const tokens = description
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 3)
    .slice(0, 8);

  if (!tokens.length) {
    return true;
  }

  return tokens.some((token) => normalizedHaystack.includes(token));
}

function takeMatchingOrFallback<T>(items: T[], matcher: (item: T) => boolean, limit: number) {
  const matched = items.filter(matcher).slice(0, limit);
  return matched.length ? matched : items.slice(0, limit);
}

export class GeminiValuationProvider implements ValuationProvider {
  providerName = "gemini" as const;

  constructor(
    private readonly apiKey: string,
    private readonly model: string,
  ) {}

  async estimate(input: ValuationRequestInput, context: ValuationCatalogContext): Promise<ValuationEstimate> {
    const metalRates = context.defaults.metalPrices;

    const stoneCatalogExcerpt = takeMatchingOrFallback(
      context.stones,
      (stone) => matchesDescription(`${stone.name} ${stone.shape} ${stone.color} ${stone.quality}`, input.description),
      8,
    )
      .map((stone) => ({
        stone_id: stone.stone_id,
        name: stone.name,
        shape: stone.shape,
        color: stone.color,
        quality: stone.quality,
        carat: stone.carat,
        final_price: stone.final_price,
      }));

    const settingCatalogExcerpt = takeMatchingOrFallback(
      context.settings,
      (setting) => matchesDescription(`${setting.style} ${setting.metal} ${setting.stone_capacity}`, input.description),
      8,
    )
      .map((setting) => ({
        setting_id: setting.setting_id,
        style: setting.style,
        metal: setting.metal,
        complexity_level: setting.complexity_level,
        gold_weight_g: setting.gold_weight_g,
        labor_cost: setting.labor_cost,
        setting_price_14k: setting.base_price,
      }));

    const pricingMethod = [
      "Reason through the estimate in this exact order before producing the final JSON:",
      "0. Infer the likely target, stone details, metal, setting complexity, and weight from the description and image when those fields are not explicitly provided.",
      "1. Find the closest catalog stone and setting matches first when they exist.",
      "2. Use Google Search grounding to verify live pricing context when it materially affects the estimate, especially gold prices, other precious metal pricing, stone prices, and comparable jewelry market anchors.",
      "3. Prefer catalog stone final_price and catalog setting price as the primary basis whenever strong matches exist.",
      "4. If a close catalog stone does not exist, estimate stone cost from stone type, shape, cut, color, size, and carat, using grounded web search only as a supporting market check.",
      "5. If a close catalog setting does not exist, estimate setting cost from metal family, metal weight, complexity, labor effort, and any grounded comparable references you find.",
      "6. Use the provided metal rates as the first numeric anchor. If grounded search finds materially newer market data, mention that in pricing_summary and reasoning, but keep the final estimate practical for internal quoting.",
      "7. Build a tight low/high range around the final numeric estimate.",
      "8. Do not describe the model as learning from employee behavior. Requests are logged only for later prompt/process improvement.",
    ].join("\n");

    const prompt = [
      "Estimate a practical internal jewelry value range for sourcing and quoting, not a public retail appraisal.",
      "Return strict JSON with the keys: estimated_value_low, estimated_value_high, pricing_summary, reasoning, recommended_next_step, matched_catalog_stone_id, matched_catalog_setting_id, inferred_valuation_target, inferred_stone_type, inferred_stone_shape, inferred_stone_cut, inferred_setting_style, inferred_metal, inferred_carat, inferred_complexity_level, inferred_gold_weight_g, grounding_search_queries, grounding_sources.",
      "If no catalog match exists, set the matched catalog field to an empty string.",
      "Use the inferred_* fields to return the structured characteristics you extracted from the description, image, and reference URL.",
      "If a characteristic cannot be inferred, return an empty string for text fields and 0 for numeric fields.",
      "pricing_summary must be a concise numeric pricing trace, not hidden chain-of-thought. Keep it to 3-5 short sentences with the main amounts and basis used.",
      "reasoning must stay short.",
      "recommended_next_step must stay short.",
      "grounding_search_queries should list the main web-search queries you actually used, if any.",
      "grounding_sources should be an array of objects with title and uri for the key web sources you relied on. If grounding was not needed, return an empty array.",
      pricingMethod,
      "",
      `Request description: ${input.description}`,
      `Reference image URL: ${input.reference_image_url || "None"}`,
      "Infer the actual jewelry characteristics from the description, image, reference URL, and catalog context.",
      `Provided metal rates per gram: ${JSON.stringify(metalRates)}`,
      "Use the inferred characteristics, provided metal rates, and catalog values as the primary basis of the estimate. Do not ignore weight, labor, or catalog final_price/setting price values.",
      `Known catalog stones: ${JSON.stringify(stoneCatalogExcerpt)}`,
      `Known catalog settings: ${JSON.stringify(settingCatalogExcerpt)}`,
    ].join("\n");

    const parts: Array<Record<string, unknown>> = [{ text: prompt }];
    const parsedImage = input.image_data_url ? parseDataUrl(input.image_data_url) : null;

    if (parsedImage) {
      parts.push({
        inlineData: {
          mimeType: parsedImage.mimeType,
          data: parsedImage.data,
        },
      });
    }

    const response = await runWithGeminiModelFallback(this.apiKey, this.model, (ai, model) =>
      ai.models.generateContent({
        model,
        contents: [
          {
            role: "user",
            parts,
          },
        ],
        config: {
          tools: [{ googleSearch: {} }],
          responseMimeType: "application/json",
          temperature: 0.1,
          systemInstruction:
            "You are Capucinne's internal jewelry valuation assistant. Use grounded search when current market data helps, especially for gold, precious metals, gemstones, and comparable jewelry pricing. Return only JSON.",
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
      throw new Error("Gemini returned an empty valuation response.");
    }

    const parsed = valuationEstimateSchema.parse(JSON.parse(text));
    const grounding = extractGrounding(
      response as {
        text?: string;
        candidates?: Array<{
          groundingMetadata?: {
            webSearchQueries?: string[];
            groundingChunks?: Array<{
              web?: {
                uri?: string;
                title?: string;
              };
            }>;
          };
        }>;
      },
    );

    return {
      ...parsed,
      grounding_search_queries:
        parsed.grounding_search_queries.length > 0 ? parsed.grounding_search_queries : grounding.searchQueries,
      grounding_sources: parsed.grounding_sources.length > 0 ? parsed.grounding_sources : grounding.sources,
    };
  }
}
