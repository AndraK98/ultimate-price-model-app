import { runWithGeminiModelFallback } from "@/lib/ai/google-genai";
import { type ListingDraftCatalogContext, type ListingDraftProvider } from "@/lib/ai/types";
import { type Setting, type Stone, type ListingDraftRequestInput, type ListingDraftResult, type ListingDraftStoneCandidate, type ValuationMessage } from "@/lib/types";
import { type ShopifyListingSnapshot } from "@/lib/services/shopify-listing-snapshot";
import { listingDraftResultSchema } from "@/lib/validators";
import { formatStoneSize } from "@/lib/utils";

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

function buildSearchText(snapshot: ShopifyListingSnapshot, input: ListingDraftRequestInput) {
  return [
    snapshot.title,
    snapshot.description,
    input.stone_clues,
    input.metal_hint,
    input.internal_notes,
  ]
    .filter(Boolean)
    .join(" ");
}

function buildConversationTranscript(history?: ValuationMessage[]) {
  if (!history?.length) {
    return "No follow-up conversation yet.";
  }

  return history.map((message) => `${message.role.toUpperCase()}: ${message.content}`).join("\n\n");
}

function buildCurrentDraftSummary(currentDraft?: ListingDraftResult) {
  if (!currentDraft) {
    return "No previous draft yet.";
  }

  return JSON.stringify(
    {
      product_id: currentDraft.product_id,
      product_handle: currentDraft.product_handle,
      weight_reference_size: currentDraft.weight_reference_size,
      estimated_gold_weight_g: currentDraft.estimated_gold_weight_g,
      main_stone_sku: currentDraft.main_stone_sku,
      main_stone: currentDraft.main_stone,
      main_stone_quantity: currentDraft.main_stone_quantity,
      side_stone_sku: currentDraft.side_stone_sku,
      side_stone: currentDraft.side_stone,
      side_stone_quantity: currentDraft.side_stone_quantity,
      setting_sku: currentDraft.setting_sku,
      matched_catalog_setting_id: currentDraft.matched_catalog_setting_id,
      metal: currentDraft.metal,
      stone_matching_notes: currentDraft.stone_matching_notes,
    },
    null,
    2,
  );
}

function scoreStoneMatch(stone: Stone, description: string) {
  const haystack = `${stone.stone_id} ${stone.name} ${stone.shape} ${stone.color} ${stone.quality} ${formatStoneSize(stone.min_size_mm, stone.max_size_mm)}`.toLowerCase();
  return tokenize(description).reduce((score, token) => score + (haystack.includes(token) ? 1 : 0), 0);
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

function buildStoneExcerpt(stones: Stone[], description: string) {
  return [...stones]
    .map((stone) => ({ stone, score: scoreStoneMatch(stone, description) }))
    .sort((left, right) => right.score - left.score)
    .slice(0, 20)
    .map(({ stone }) => ({
      stone_id: stone.stone_id,
      name: stone.name,
      shape: stone.shape,
      color: stone.color,
      quality: stone.quality,
      size: formatStoneSize(stone.min_size_mm, stone.max_size_mm),
      carat: stone.carat,
      final_price: stone.final_price,
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

function normalizeStoneCandidate(
  value: unknown,
  stones: Stone[],
): ListingDraftStoneCandidate | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const source = value as Record<string, unknown>;
  const stoneId = normalizeText(source.stone_id);

  if (!stoneId) {
    return null;
  }

  const match = stones.find((stone) => stone.stone_id.trim().toUpperCase() === stoneId.toUpperCase());
  if (!match) {
    return null;
  }

  return {
    stone_id: match.stone_id,
    name: match.name,
    shape: match.shape,
    color: match.color,
    quality: match.quality,
    size: formatStoneSize(match.min_size_mm, match.max_size_mm),
    carat: match.carat,
    final_price: match.final_price,
    reason: normalizeText(source.reason) || "Gemini marked this as a plausible catalog match from the Shopify page.",
  };
}

function normalizeDraftResult(
  raw: unknown,
  snapshot: ShopifyListingSnapshot,
  stones: Stone[],
  settings: Setting[],
): ListingDraftResult {
  const source = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const pageDescription = normalizeText(source.page_description) || snapshot.description;
  const descriptionForMatching = `${snapshot.title} ${pageDescription}`.trim();
  const matchedSetting =
    findMatchedSetting(settings, normalizeText(source.matched_catalog_setting_id), descriptionForMatching);
  const matchedSettingId = matchedSetting?.setting_id ?? "";
  const generatedSettingSku = buildGeneratedSettingSku(settings);
  const mainStoneCandidates = Array.isArray(source.main_stone_candidates)
    ? source.main_stone_candidates.map((value) => normalizeStoneCandidate(value, stones)).filter((value): value is ListingDraftStoneCandidate => value !== null)
    : [];
  const sideStoneCandidates = Array.isArray(source.side_stone_candidates)
    ? source.side_stone_candidates.map((value) => normalizeStoneCandidate(value, stones)).filter((value): value is ListingDraftStoneCandidate => value !== null)
    : [];
  const selectedMainStoneSku = normalizeText(source.main_stone_sku) || mainStoneCandidates[0]?.stone_id || "";
  const selectedSideStoneSku = normalizeText(source.side_stone_sku) || sideStoneCandidates[0]?.stone_id || "";
  const selectedMainStone = mainStoneCandidates.find((candidate) => candidate.stone_id === selectedMainStoneSku) ?? mainStoneCandidates[0];
  const selectedSideStone = sideStoneCandidates.find((candidate) => candidate.stone_id === selectedSideStoneSku) ?? sideStoneCandidates[0];
  const normalized = listingDraftResultSchema.parse({
    source_url: snapshot.sourceUrl,
    provider: "gemini",
    product_id: normalizeText(source.product_id) || snapshot.productId,
    product_handle: normalizeText(source.product_handle) || snapshot.productHandle,
    title: normalizeText(source.title) || snapshot.title,
    weight_reference_size: normalizeText(source.weight_reference_size) || "US size 7 women",
    estimated_gold_weight_g: normalizeNumber(source.estimated_gold_weight_g),
    main_stone: normalizeText(source.main_stone) || selectedMainStone?.name || "",
    main_stone_quantity: normalizeNumber(source.main_stone_quantity),
    main_stone_sku: selectedMainStoneSku,
    side_stone: normalizeText(source.side_stone) || selectedSideStone?.name || "",
    side_stone_quantity: normalizeNumber(source.side_stone_quantity),
    side_stone_sku: selectedSideStoneSku,
    setting_sku: matchedSettingId || generatedSettingSku,
    setting_sku_source: matchedSettingId ? "catalog" : "generated",
    matched_catalog_setting_id: matchedSettingId,
    setting_style: normalizeText(source.setting_style) || matchedSetting?.style || snapshot.title,
    metal: normalizeText(source.metal) || matchedSetting?.metal || "",
    page_description: pageDescription,
    image_urls: snapshot.imageUrls,
    stone_matching_notes:
      normalizeText(source.stone_matching_notes) ||
      "Candidate stone SKUs are ranked from the Stones sheet based on the Shopify page, images, and the operator notes.",
    main_stone_candidates: mainStoneCandidates,
    side_stone_candidates: sideStoneCandidates,
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
    options?: {
      history?: ValuationMessage[];
      currentDraft?: ListingDraftResult;
    },
  ): Promise<ListingDraftResult> {
    const searchText = buildSearchText(snapshot, input);
    const prompt = [
      "You are Capucinne's internal Shopify listing reconstruction assistant.",
      "Your task is to reconstruct a missing Master Popisi / Final Pricing Rings draft from a Shopify product page.",
      "Read the product title, product description, and all provided product images together.",
      "Count stones conservatively. Return one main stone bucket and one side stone bucket. If there are no stones, both quantities must be 0.",
      "Estimate the ring's pure-gold weight in grams for either US size 10 if the ring reads as men's, or US size 7 if it reads as women's. You must explicitly state which size basis you used.",
      "Try to match the piece to a setting SKU from the provided Settings - Rings excerpt. If no setting is a clear fit, leave matched_catalog_setting_id empty.",
      "Try to match the main and side stones to real Stone sheet SKUs from the provided catalog excerpt. Because uncertainty is normal, return a ranked range of likely candidates for both main and side stones when relevant.",
      "If the user later corrects the draft in the conversation, the latest explicit correction wins over the previous draft, the Shopify text, or the image guess.",
      "Return only strict JSON with these keys: product_id, product_handle, title, weight_reference_size, estimated_gold_weight_g, main_stone, main_stone_quantity, main_stone_sku, side_stone, side_stone_quantity, side_stone_sku, matched_catalog_setting_id, setting_style, metal, page_description, stone_matching_notes, main_stone_candidates, side_stone_candidates, reasoning, recommended_next_step.",
      "main_stone_candidates and side_stone_candidates must be arrays of objects with stone_id and reason. Use up to 3 items per array.",
      "All quantity and weight fields must be raw JSON numbers.",
      "If no stones are visible or implied, set both stone quantities to 0 and both candidate arrays to empty.",
      "If the page does not explicitly say a value, infer the most commercially useful internal draft and say that briefly in reasoning.",
      `Source URL: ${input.source_url}`,
      `Product ID from page snapshot: ${snapshot.productId || "Not found in HTML"}`,
      `Handle from page URL: ${snapshot.productHandle || "Not found in URL"}`,
      `Title: ${snapshot.title}`,
      `Description: ${snapshot.description || "Not found"}`,
      `Operator stone clues: ${input.stone_clues || "None"}`,
      `Operator metal clue: ${input.metal_hint || "None"}`,
      `Operator notes: ${input.internal_notes || "None"}`,
      `Preferred weight basis: ${input.weight_basis_preference}`,
      `Current draft before this turn:\n${buildCurrentDraftSummary(options?.currentDraft)}`,
      `Conversation so far:\n${buildConversationTranscript(options?.history)}`,
      `Available image URLs: ${JSON.stringify(snapshot.imageUrls)}`,
      `Candidate stones from Stones sheet: ${JSON.stringify(buildStoneExcerpt(context.stones, searchText))}`,
      `Candidate settings from Settings - Rings: ${JSON.stringify(buildSettingExcerpt(context.settings, searchText))}`,
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

    return normalizeDraftResult(JSON.parse(extractJsonText(rawText)), snapshot, context.stones, context.settings);
  }
}
