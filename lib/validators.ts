import { z } from "zod";

const numericField = z.coerce.number().finite().nonnegative();
const textField = z.string().trim().default("");
const valuationNumericField = z.preprocess((value) => {
  if (value === undefined || value === null || value === "") {
    return 0;
  }

  if (typeof value === "number") {
    return Number.isFinite(value) && value >= 0 ? value : 0;
  }

  const normalized = String(value).trim();

  if (!normalized) {
    return 0;
  }

  const direct = Number(normalized.replace(/,/g, ""));
  if (Number.isFinite(direct) && direct >= 0) {
    return direct;
  }

  const match = normalized.replace(/,/g, "").match(/\d+(?:\.\d+)?/);
  if (!match) {
    return 0;
  }

  const parsed = Number(match[0]);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}, z.number().finite().nonnegative());
const groundingSourceSchema = z.object({
  title: z.string().trim().min(1),
  uri: z.string().trim().url(),
});

export const stoneInputSchema = z.object({
  stone_id: z.string().trim().min(1).optional(),
  name: z.string().trim().min(1),
  shape: z.string().trim().min(1),
  color: z.string().trim().default(""),
  carat: numericField.default(0),
  min_size_mm: numericField.default(0),
  max_size_mm: numericField.default(0),
  quality: textField,
  price_per_carat: numericField.default(0),
  final_price: numericField.default(0),
  status: z.string().trim().default("active"),
  notes: textField,
  created_by: z.string().trim().default("atelier-team"),
});

export const settingInputSchema = z.object({
  setting_id: z.string().trim().min(1).optional(),
  style: z.string().trim().min(1),
  metal: z.string().trim().min(1),
  ring_size: textField,
  dimensions_mm: textField,
  complexity_level: numericField.default(0),
  gold_weight_g: numericField.default(0),
  labor_cost: numericField.default(0),
  base_price: numericField.default(0),
  stone_capacity: textField,
  status: z.string().trim().default("active"),
  created_by: z.string().trim().default("atelier-team"),
});

export const inquiryInputSchema = z.object({
  inquiry_id: z.string().trim().min(1).optional(),
  customer_name: z.string().trim().min(1),
  stone_id: textField,
  setting_id: textField,
  custom_stone_text: textField,
  custom_setting_text: textField,
  target_size_mm: numericField.default(0),
  target_gold_weight_g: numericField.default(0),
  manual_stone_estimate: numericField.default(0),
  manual_setting_estimate: numericField.default(0),
  status: z.string().trim().default("open"),
  reference_image_url: textField,
  created_by: z.string().trim().default("atelier-team"),
});

export const valuationRequestSchema = z.object({
  image_data_url: textField,
  reference_image_url: textField,
  description: z.string().trim().min(1),
  created_by: z.string().trim().default("atelier-team"),
});

export const valuationResolvedDetailsSchema = z.object({
  valuation_target: z.enum(["stone", "setting", "piece"]).default("piece"),
  stone_type: textField,
  stone_shape: textField,
  stone_cut: textField,
  setting_style: textField,
  metal: textField,
  carat: valuationNumericField.default(0),
  complexity_level: valuationNumericField.default(0),
  gold_weight_g: valuationNumericField.default(0),
  notes: textField,
});

export const valuationEstimateSchema = z.object({
  estimated_value_low: valuationNumericField.default(0),
  estimated_value_high: valuationNumericField.default(0),
  pricing_summary: z.string().trim().min(1).default("No pricing summary logged."),
  reasoning: z.string().trim().min(1),
  recommended_next_step: z.string().trim().min(1),
  matched_catalog_stone_id: textField,
  matched_catalog_setting_id: textField,
  inferred_valuation_target: z.enum(["stone", "setting", "piece"]).default("piece"),
  inferred_stone_type: textField,
  inferred_stone_shape: textField,
  inferred_stone_cut: textField,
  inferred_setting_style: textField,
  inferred_metal: textField,
  inferred_carat: valuationNumericField.default(0),
  inferred_complexity_level: valuationNumericField.default(0),
  inferred_gold_weight_g: valuationNumericField.default(0),
  grounding_search_queries: z.array(z.string().trim().min(1)).default([]),
  grounding_sources: z.array(groundingSourceSchema).default([]),
});

const optionalTextField = z.string().trim().optional();
const optionalNumericField = z.coerce.number().finite().nonnegative().optional();

export const catalogSearchAssistRequestSchema = z.object({
  target: z.enum(["stone", "setting"]),
  query: z.string().trim().min(1),
});

export const stoneSearchAssistFiltersSchema = z.object({
  stoneId: optionalTextField,
  name: optionalTextField,
  shape: optionalTextField,
  color: optionalTextField,
  quality: optionalTextField,
  size: optionalTextField,
  minCarat: optionalNumericField,
  maxCarat: optionalNumericField,
  minPricePerCarat: optionalNumericField,
  maxPricePerCarat: optionalNumericField,
});

export const settingSearchAssistFiltersSchema = z.object({
  settingId: optionalTextField,
  style: optionalTextField,
  metal: optionalTextField,
  minWeightG: optionalNumericField,
  maxWeightG: optionalNumericField,
  minComplexity: optionalNumericField,
  maxComplexity: optionalNumericField,
  minLaborCost: optionalNumericField,
  maxLaborCost: optionalNumericField,
  minBasePrice: optionalNumericField,
  maxBasePrice: optionalNumericField,
});

export const catalogSearchAssistResultSchema = z.object({
  normalized_query: textField,
  summary: z.string().trim().min(1),
  stone_filters: stoneSearchAssistFiltersSchema.optional(),
  setting_filters: settingSearchAssistFiltersSchema.optional(),
});
