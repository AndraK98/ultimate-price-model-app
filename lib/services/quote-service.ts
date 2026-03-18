import { type Inquiry, type MetalFamily, type QuoteBreakdown, type QuoteInput, type Setting, type Stone } from "@/lib/types";
import { createRecordId, roundCurrency, toIsoNow } from "@/lib/utils";

const complexityMultiplierMap: Record<number, number> = {
  1: 2.5,
  2: 2.7,
  3: 2.8,
  4: 2.9,
  5: 3.0,
};

function containsMultiSettingReference(referenceText?: string): boolean {
  return typeof referenceText === "string" && referenceText.includes(",");
}

export function resolveSettingReferenceText(settingId?: string, customSettingText?: string): string | undefined {
  const normalizedSettingId = settingId?.trim();
  const normalizedCustomSettingText = customSettingText?.trim();

  if (containsMultiSettingReference(normalizedCustomSettingText)) {
    return normalizedCustomSettingText;
  }

  return normalizedSettingId || normalizedCustomSettingText || undefined;
}

function normalizeRecordIds(value?: string | string[]): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => item.trim()).filter(Boolean);
  }

  if (typeof value === "string") {
    return value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  }

  return [];
}

function resolveSelectedStones(input: QuoteInput): Stone[] {
  if (input.stones?.length) {
    return input.stones;
  }

  return input.stone ? [input.stone] : [];
}

function resolveSelectedSettings(input: QuoteInput): Setting[] {
  if (input.settings?.length) {
    return input.settings;
  }

  return input.setting ? [input.setting] : [];
}

export function resolveMetalFamily(metalText?: string): MetalFamily {
  const normalizedMetalText = metalText?.trim().toLowerCase() ?? "";

  if (normalizedMetalText.includes("platinum")) {
    return "platinum";
  }

  if (normalizedMetalText.includes("silver")) {
    return "silver";
  }

  if (normalizedMetalText.includes("gold")) {
    return "gold";
  }

  return "unknown";
}

function resolveMetalBreakdown(input: QuoteInput): {
  metalFamily: MetalFamily;
  metalPricePerGram: number;
  goldWeightG: number;
  metalCost: number;
} {
  const settings = resolveSelectedSettings(input);
  const fallbackGoldRate = input.metalPrices.gold || input.goldPricePerGram;
  const overrideWeight = input.targetGoldWeightG && input.targetGoldWeightG > 0 ? input.targetGoldWeightG : undefined;

  if (!settings.length) {
    const goldWeightG = roundCurrency(overrideWeight ?? 0);
    const metalPricePerGram = fallbackGoldRate;
    return {
      metalFamily: "unknown",
      metalPricePerGram,
      goldWeightG,
      metalCost: roundCurrency(goldWeightG * metalPricePerGram),
    };
  }

  const pricedSettings = settings.map((setting) => {
    const metalFamily = resolveMetalFamily(setting.metal);
    const metalPricePerGram =
      metalFamily === "gold" || metalFamily === "silver" || metalFamily === "platinum"
        ? input.metalPrices[metalFamily]
        : fallbackGoldRate;

    return {
      metalFamily,
      goldWeightG: setting.gold_weight_g,
      metalPricePerGram,
      metalCost: setting.gold_weight_g * metalPricePerGram,
    };
  });

  const familySet = new Set(pricedSettings.map((setting) => setting.metalFamily));
  const metalFamily = familySet.size === 1 ? pricedSettings[0]?.metalFamily ?? "unknown" : "mixed";
  const totalSettingWeight = pricedSettings.reduce((sum, setting) => sum + setting.goldWeightG, 0);
  const totalSettingMetalCost = pricedSettings.reduce((sum, setting) => sum + setting.metalCost, 0);
  const metalPricePerGram =
    totalSettingWeight > 0
      ? roundCurrency(totalSettingMetalCost / totalSettingWeight)
      : pricedSettings[0]?.metalPricePerGram ?? fallbackGoldRate;
  const goldWeightG = roundCurrency(overrideWeight ?? totalSettingWeight);

  return {
    metalFamily,
    metalPricePerGram,
    goldWeightG,
    metalCost: roundCurrency(goldWeightG * metalPricePerGram),
  };
}

function resolveCatalogSettingSubtotal(input: QuoteInput, settings: Setting[]): number {
  const fallbackGoldRate = input.metalPrices.gold || input.goldPricePerGram;

  return roundCurrency(
    settings.reduce((sum, setting) => {
      if (setting.base_price > 0) {
        return sum + setting.base_price;
      }

      const metalFamily = resolveMetalFamily(setting.metal);
      const metalPricePerGram =
        metalFamily === "gold" || metalFamily === "silver" || metalFamily === "platinum"
          ? input.metalPrices[metalFamily]
          : fallbackGoldRate;

      return sum + setting.gold_weight_g * metalPricePerGram + setting.labor_cost;
    }, 0),
  );
}

function resolveQuoteMarginMultiplier(settings: Setting[], settingReferenceText?: string): number {
  if (!settings.length) {
    return 1;
  }

  if (settings.length > 1 || containsMultiSettingReference(settingReferenceText)) {
    return 2.8;
  }

  const complexityLevel = Math.round(settings[0]?.complexity_level ?? 0);
  return complexityMultiplierMap[complexityLevel] ?? 2.8;
}

function resolve18kSettingDelta(settings: Setting[]): {
  quote18kDelta: number;
  quote18kWeightG: number;
  matched18kSettingCount: number;
} {
  const uplift = settings.reduce(
    (current, setting) => {
      const currentPrice = Math.max(0, setting.base_price);
      const counterpartPrice = Math.max(0, setting.quote_18k_price ?? 0);

      if (counterpartPrice <= 0 || currentPrice <= 0) {
        return current;
      }

      current.matched18kSettingCount += 1;
      current.quote18kDelta += Math.max(0, counterpartPrice - currentPrice);
      return current;
    },
    { quote18kDelta: 0, quote18kWeightG: 0, matched18kSettingCount: 0 },
  );

  return {
    quote18kDelta: roundCurrency(uplift.quote18kDelta),
    quote18kWeightG: roundCurrency(uplift.quote18kWeightG),
    matched18kSettingCount: uplift.matched18kSettingCount,
  };
}

export function calculateStoneCost(stone?: Stone | null): number {
  if (!stone) {
    return 0;
  }

  return roundCurrency(stone.final_price || stone.carat * stone.price_per_carat);
}

export function calculateQuoteBreakdown(input: QuoteInput): QuoteBreakdown {
  const stones = resolveSelectedStones(input);
  const settings = resolveSelectedSettings(input);
  const { metalFamily, metalPricePerGram, goldWeightG, metalCost } = resolveMetalBreakdown(input);
  const manualStoneCost = roundCurrency(Math.max(0, input.manualStoneCost ?? 0));
  const manualSettingCost = roundCurrency(Math.max(0, input.manualSettingCost ?? 0));

  const stoneCost = roundCurrency(stones.reduce((sum, stone) => sum + calculateStoneCost(stone), 0));
  const laborCost = roundCurrency(settings.reduce((sum, setting) => sum + setting.labor_cost, 0));
  const catalogSettingSubtotal = resolveCatalogSettingSubtotal(input, settings);
  const catalogSubtotal = roundCurrency(stoneCost + catalogSettingSubtotal);
  const quoteMarginMultiplier = resolveQuoteMarginMultiplier(settings, input.settingReferenceText);
  const materialCost = roundCurrency(catalogSubtotal + manualStoneCost + manualSettingCost);
  const estimatedQuote14k = roundCurrency(catalogSubtotal * quoteMarginMultiplier + manualStoneCost + manualSettingCost);
  const { quote18kDelta, quote18kWeightG, matched18kSettingCount } = resolve18kSettingDelta(settings);
  const estimatedQuote18k = roundCurrency(estimatedQuote14k + quote18kDelta);

  return {
    stone_count: stones.length,
    setting_count: settings.length,
    metal_family: metalFamily,
    metal_price_per_gram: metalPricePerGram,
    gold_weight_g: goldWeightG,
    gold_price_per_gram: input.metalPrices.gold || input.goldPricePerGram,
    quote_margin_multiplier: quoteMarginMultiplier,
    metalCost,
    stoneCost,
    manualStoneCost,
    manualSettingCost,
    laborCost,
    basePrice: catalogSettingSubtotal,
    catalogSubtotal,
    materialCost,
    estimatedQuote: estimatedQuote14k,
    estimatedQuote14k,
    estimatedQuote18k,
    quote18kDelta,
    quote18kWeightG,
    matched18kSettingCount,
  };
}

export function buildInquiryRecord(input: {
  customer_name: string;
  stone_id?: string;
  stone_ids?: string[] | string;
  setting_id?: string;
  setting_ids?: string[] | string;
  custom_stone_text?: string;
  custom_setting_text?: string;
  target_size_mm?: number;
  target_gold_weight_g?: number;
  manual_stone_estimate?: number;
  manual_setting_estimate?: number;
  status?: string;
  reference_image_url?: string;
  created_by?: string;
  stone?: Stone | null;
  stones?: Stone[];
  setting?: Setting | null;
  settings?: Setting[];
  settingReferenceText?: string;
  goldPricePerGram: number;
  metalPrices: QuoteInput["metalPrices"];
  quoteMarginMultiplier: number;
}): Inquiry {
  const stoneIds = normalizeRecordIds(
    input.stone_ids ?? input.stone_id ?? input.stones?.map((stone) => stone.stone_id) ?? input.stone?.stone_id,
  );
  const settingIds = normalizeRecordIds(
    input.setting_ids ??
      input.setting_id ??
      input.settings?.map((setting) => setting.setting_id) ??
      input.setting?.setting_id,
  );
  const quote = calculateQuoteBreakdown({
    stone: input.stone,
    stones: input.stones,
    setting: input.setting,
    settings: input.settings,
    settingReferenceText:
      input.settingReferenceText ??
      resolveSettingReferenceText(settingIds.join(", "), input.custom_setting_text),
    targetGoldWeightG: input.target_gold_weight_g,
    manualStoneCost: input.manual_stone_estimate,
    manualSettingCost: input.manual_setting_estimate,
    goldPricePerGram: input.goldPricePerGram,
    metalPrices: input.metalPrices,
    quoteMarginMultiplier: input.quoteMarginMultiplier,
  });

  return {
    inquiry_id: createRecordId("inquiry"),
    customer_name: input.customer_name,
    stone_id: stoneIds.join(", "),
    setting_id: settingIds.join(", "),
    custom_stone_text: input.custom_stone_text ?? "",
    custom_setting_text: input.custom_setting_text ?? "",
    target_size_mm: input.target_size_mm ?? 0,
    target_gold_weight_g: quote.gold_weight_g,
    manual_stone_estimate: roundCurrency(Math.max(0, input.manual_stone_estimate ?? 0)),
    manual_setting_estimate: roundCurrency(Math.max(0, input.manual_setting_estimate ?? 0)),
    estimated_material_cost: quote.materialCost,
    estimated_quote: quote.estimatedQuote,
    estimated_quote_18k: quote.estimatedQuote18k,
    status: input.status ?? "open",
    reference_image_url: input.reference_image_url ?? "",
    created_by: input.created_by ?? "atelier-team",
    created_at: toIsoNow(),
    quote_breakdown: quote,
  };
}
