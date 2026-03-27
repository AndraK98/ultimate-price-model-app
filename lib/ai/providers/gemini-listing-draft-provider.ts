import { runWithGeminiModelFallback } from "@/lib/ai/google-genai";
import { type ListingDraftCatalogContext, type ListingDraftProvider } from "@/lib/ai/types";
import { type Setting, type ListingDraftRequestInput, type ListingDraftResult } from "@/lib/types";
import { type ShopifyListingSnapshot } from "@/lib/services/shopify-listing-snapshot";
import { listingDraftResultSchema } from "@/lib/validators";

function extractJsonText(raw: string) {
  const trimmed = raw.trim();

  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    return trimmed;
  }

  const fencedMatch = trimmed.match(/```(?:json)?\s*([\s\S]+?)\s*```/i);
  if (fencedMatch?.[1]) {
    return fencedMatch[1].trim();
  }

  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");

  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    return trimmed.slice(firstBrace, lastBrace + 1);
  }

  return trimmed;
}

function normalizeText(value: unknown) {
  return String(value ?? "").trim();
}

function normalizeNumber(value: unknown) {
  if (typeof value === "number") {
    return Number.isFinite(value) && value >= 0 ? value : 0;
  }

  const normalized = String(value ?? "").trim();
  if (!normalized) {
    return 0;
  }

  const direct = Number(normalized.replace(/,/g, ""));
  if (Number.isFinite(direct) && direct >= 0) {
    return direct;
  }

  const match = normalized.replace(/,/g, "").match(/\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : 0;
}

function tokenize(value: string) {
  return Array.from(
    new Set(
      value
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((token) => token.length >= 3),
    ),
  );
}

function scoreSettingMatch(setting: Setting, description: string) {
  const haystack = `${setting.setting_id} ${setting.style} ${setting.metal} ${setting.dimensions_mm} ${setting.stone_capacity}`.toLowerCase();
  return tokenize(description).reduce((score, token) => score + (haystack.includes(token) ? 1 : 0), 0);
}

function buildSettingExcerpt(settings: Setting[], description: string) {
  return [...settings]
    .map((setting) => ({ setting, score: scoreSettingMatch(setting, description) }))
    .sort((left, right) => right.score - left.score)
    .slice(0, 12)
    .map(({ setting }) => ({
      setting_id: setting.setting_id,
      style: setting.style,
      metal: setting.metal,
      complexity_level: setting.complexity_level,
      gold_weight_g: setting.gold_weight_g,
      base_price: setting.base_price,
    }));
}

function findMatchedSetting(settings: Setting[], settingId: string, description: string) {
  const explicit = settings.find((setting) => setting.setting_id.trim().toUpperCase() === settingId.trim().toUpperCase());
  if (explicit) {
    return explicit;
  }

  return [...settings]
    .map((setting) => ({ setting, score: scoreSettingMatch(setting, description) }))
    .sort((left, right) => right.score - left.score)[0]?.setting;
}

function buildGeneratedSettingSku(settings: Setting[]) {
  const nextNumber =
    settings.reduce((maxValue, setting) => {
      const match = setting.setting_id.match(/^SRY4AI(\d{4})$/i);
      if (!match) {
        return maxValue;
      }

      return Math.max(maxValue, Number(match[1]));
    }, 0) + 1;

  return `SRY4AI${String(nextNumber).padStart(4, "0")}`;
}

function normalizeDraftResult(
  raw: unknown,
  snapshot: ShopifyListingSnapshot,
  settings: Setting[],
): ListingDraftResult {
  const source = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const pageDescription = normalizeText(source.page_description) || snapshot.description;
  const descriptionForMatching = `${snapshot.title} ${pageDescription}`.trim();
  const matchedSetting =
    findMatchedSetting(settings, normalizeText(source.matched_catalog_setting_id), descriptionForMatching);
  const matchedSettingId = matchedSetting?.setting_id ?? "";
  const generatedSettingSku = buildGeneratedSettingSku(settings);
  const normalized = listingDraftResultSchema.parse({
    source_url: snapshot.sourceUrl,
    provider: "gemini",
    product_id: normalizeText(source.product_id) || snapshot.productId,
    product_handle: normalizeText(source.product_handle) || snapshot.productHandle,
    title: normalizeText(source.title) || snapshot.title,
    weight_reference_size: normalizeText(source.weight_reference_size) || "US size 7 women",
    estimated_gold_weight_g: normalizeNumber(source.estimated_gold_weight_g),
    main_stone: normalizeText(source.main_stone),
    main_stone_quantity: normalizeNumber(source.main_stone_quantity),
    side_stone: normalizeText(source.side_stone),
    side_stone_quantity: normalizeNumber(source.side_stone_quantity),
    setting_sku: matchedSettingId || generatedSettingSku,
    setting_sku_source: matchedSettingId ? "catalog" : "generated",
    matched_catalog_setting_id: matchedSettingId,
    setting_style: normalizeText(source.setting_style) || matchedSetting?.style || snapshot.title,
    metal: normalizeText(source.metal) || matchedSetting?.metal || "",
    page_description: pageDescription,
    image_urls: snapshot.imageUrls,
    reasoning:
      normalizeText(source.reasoning) ||
      "The listing draft was inferred from the Shopify page description, gallery, and the closest setting-sheet match.",
    recommended_next_step:
      normalizeText(source.recommended_next_step) ||
      "Check the generated SKU, confirm the stone counts, and let the 3D team review the estimated weight.",
    grounding_search_queries: [],
    grounding_sources: [],
  });

  return normalized;
}

export class GeminiListingDraftProvider implements ListingDraftProvider {
  providerName = "gemini" as const;

  constructor(
    private readonly apiKey: string,
    private readonly model: string,
  ) {}

  async draft(
    input: ListingDraftRequestInput,
    snapshot: ShopifyListingSnapshot,
    context: ListingDraftCatalogContext,
  ): Promise<ListingDraftResult> {
    const prompt = [
      "You are Capucinne's internal Shopify listing reconstruction assistant.",
      "Your task is to reconstruct a missing Master Popisi / Final Pricing Rings draft from a Shopify product page.",
      "Read the product title, product description, and all provided product images together.",
      "Count stones conservatively. Return one main stone bucket and one side stone bucket. If there are no stones, both quantities must be 0.",
      "Estimate the ring's pure-gold weight in grams for either US size 10 if the ring reads as men's, or US size 7 if it reads as women's. You must explicitly state which size basis you used.",
      "Try to match the piece to a setting SKU from the provided Settings - Rings excerpt. If no setting is a clear fit, leave matched_catalog_setting_id empty.",
      "Return only strict JSON with these keys: product_id, product_handle, title, weight_reference_size, estimated_gold_weight_g, main_stone, main_stone_quantity, side_stone, side_stone_quantity, matched_catalog_setting_id, setting_style, metal, page_description, reasoning, recommended_next_step.",
      "All quantity and weight fields must be raw JSON numbers.",
      "If the page does not explicitly say a value, infer the most commercially useful internal draft and say that briefly in reasoning.",
      `Source URL: ${input.source_url}`,
      `Product ID from page snapshot: ${snapshot.productId || "Not found in HTML"}`,
      `Handle from page URL: ${snapshot.productHandle || "Not found in URL"}`,
      `Title: ${snapshot.title}`,
      `Description: ${snapshot.description || "Not found"}`,
      `Available image URLs: ${JSON.stringify(snapshot.imageUrls)}`,
      `Candidate settings from Settings - Rings: ${JSON.stringify(buildSettingExcerpt(context.settings, `${snapshot.title} ${snapshot.description}`))}`,
    ].join("\n");

    const parts: Array<Record<string, unknown>> = [{ text: prompt }];

    for (const imageDataUrl of snapshot.imageDataUrls) {
      const match = imageDataUrl.match(/^data:(.+?);base64,(.+)$/);
      if (!match) {
        continue;
      }

      parts.push({
        inlineData: {
          mimeType: match[1],
          data: match[2],
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
          responseMimeType: "application/json",
          temperature: 0.1,
          systemInstruction:
            "You are a structured jewelry listing reconstruction assistant. Return only JSON and prioritize commercially useful internal draft data.",
        },
      }),
    );

    const rawText = String((response as { text?: string }).text ?? "").trim();
    if (!rawText) {
      throw new Error("Gemini returned an empty listing draft response.");
    }

    return normalizeDraftResult(JSON.parse(extractJsonText(rawText)), snapshot, context.settings);
  }
}
