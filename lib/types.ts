export type DataMode = "auto" | "mock" | "sheets";
export type ResolvedDataMode = "mock" | "sheets";
export type ValuationProviderName = "gemini";
export type MetalFamily = "gold" | "silver" | "platinum" | "mixed" | "unknown";
export type ValuationTarget = "stone" | "setting" | "piece";
export type ValuationMessageRole = "user" | "assistant";

export interface GroundingSource {
  title: string;
  uri: string;
}

export interface KnowledgeFileReference {
  file_id: string;
  name: string;
  web_view_url: string;
}

export interface MetalPrices {
  gold: number;
  silver: number;
  platinum: number;
}

export interface PricingDefaults {
  metalPrices: MetalPrices;
  metalPricingSource: "env" | "sheet";
}

export interface Stone {
  stone_id: string;
  name: string;
  shape: string;
  color: string;
  carat: number;
  min_size_mm: number;
  max_size_mm: number;
  quality: string;
  price_per_carat: number;
  final_price: number;
  status: string;
  notes: string;
  created_by: string;
  created_at: string;
}

export interface Setting {
  setting_id: string;
  style: string;
  metal: string;
  ring_size: string;
  dimensions_mm: string;
  complexity_level: number;
  gold_weight_g: number;
  labor_cost: number;
  base_price: number;
  quote_18k_setting_id?: string;
  quote_18k_price?: number;
  quote_18k_gold_weight_g?: number;
  stone_capacity: string;
  status: string;
  created_by: string;
  created_at: string;
}

export interface QuoteBreakdown {
  stone_count: number;
  setting_count: number;
  metal_family: MetalFamily;
  metal_price_per_gram: number;
  gold_weight_g: number;
  gold_price_per_gram: number;
  quote_margin_multiplier: number;
  metalCost: number;
  stoneCost: number;
  manualStoneCost: number;
  manualSettingCost: number;
  laborCost: number;
  basePrice: number;
  catalogSubtotal: number;
  materialCost: number;
  estimatedQuote: number;
  estimatedQuote14k: number;
  estimatedQuote18k: number;
  quote18kDelta: number;
  quote18kWeightG: number;
  matched18kSettingCount: number;
}

export interface Inquiry {
  inquiry_id: string;
  customer_name: string;
  stone_id: string;
  setting_id: string;
  custom_stone_text: string;
  custom_setting_text: string;
  target_size_mm: number;
  target_gold_weight_g: number;
  manual_stone_estimate: number;
  manual_setting_estimate: number;
  estimated_material_cost: number;
  estimated_quote: number;
  estimated_quote_18k?: number;
  status: string;
  reference_image_url: string;
  created_by: string;
  created_at: string;
  quote_breakdown?: QuoteBreakdown;
}

export interface ValuationRequestInput {
  image_data_url: string;
  reference_image_url: string;
  description: string;
  created_by: string;
}

export interface ListingDraftRequestInput {
  source_url: string;
  created_by: string;
}

export interface ValuationResolvedDetails {
  valuation_target: ValuationTarget;
  stone_type: string;
  stone_shape: string;
  stone_cut: string;
  setting_style: string;
  metal: string;
  carat: number;
  complexity_level: number;
  gold_weight_g: number;
  notes: string;
}

export interface ValuationEstimate {
  estimated_value_low: number;
  estimated_value_high: number;
  estimated_stone_total: number;
  estimated_setting_total: number;
  inferred_complexity_multiplier: number;
  estimated_formula_total: number;
  pricing_summary: string;
  reasoning: string;
  recommended_next_step: string;
  matched_catalog_stone_id: string;
  matched_catalog_setting_id: string;
  inferred_valuation_target: ValuationTarget;
  inferred_stone_type: string;
  inferred_stone_shape: string;
  inferred_stone_cut: string;
  inferred_setting_style: string;
  inferred_metal: string;
  inferred_carat: number;
  inferred_complexity_level: number;
  inferred_gold_weight_g: number;
  grounding_search_queries: string[];
  grounding_sources: GroundingSource[];
  referenced_knowledge_files: KnowledgeFileReference[];
}

export interface ValuationMessage {
  message_id: string;
  role: ValuationMessageRole;
  content: string;
  created_at: string;
  estimated_value_low?: number;
  estimated_value_high?: number;
  estimated_formula_total?: number;
  pricing_summary?: string;
  reasoning?: string;
  recommended_next_step?: string;
}

export interface ValuationRecord extends ValuationRequestInput, ValuationResolvedDetails, ValuationEstimate {
  valuation_id: string;
  provider: ValuationProviderName;
  created_at: string;
  updated_at: string;
  messages: ValuationMessage[];
}

export interface ListingDraftResult {
  source_url: string;
  provider: ValuationProviderName;
  product_id: string;
  product_handle: string;
  title: string;
  weight_reference_size: string;
  estimated_gold_weight_g: number;
  main_stone: string;
  main_stone_quantity: number;
  side_stone: string;
  side_stone_quantity: number;
  setting_sku: string;
  setting_sku_source: "catalog" | "generated";
  matched_catalog_setting_id: string;
  setting_style: string;
  metal: string;
  page_description: string;
  image_urls: string[];
  reasoning: string;
  recommended_next_step: string;
  grounding_search_queries: string[];
  grounding_sources: GroundingSource[];
}

export interface ProductCompositionStoneLine {
  stone_id: string;
  quantity: number;
  role: "main" | "accent";
  stone: Stone | null;
  label: string;
  shape: string;
  cut: string;
  quality: string;
  color: string;
  measurements: string;
}

export interface ProductCompositionVariant {
  variant_key: string;
  variant_sku: string;
  ring_set_sku: string;
  set_sku_fix: string;
  metal: string;
  band_size: string;
  setting_style: string;
  additional_description: string;
  setting_ids: string[];
  settings: Setting[];
  stones: ProductCompositionStoneLine[];
  source_row_count: number;
}

export interface ProductComposition {
  reference: string;
  matched_by: "id" | "handle" | "url";
  product_id: string;
  product_handle: string;
  title: string;
  description: string;
  default_variant_key: string;
  variants: ProductCompositionVariant[];
}

export interface DashboardKpis {
  stoneCount: number;
  activeStoneCount: number;
  settingCount: number;
  activeSettingCount: number;
  openInquiryCount: number;
  valuationCount: number;
  averageQuote: number;
}

export interface PaginatedResult<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface DashboardSnapshot {
  dataMode: ResolvedDataMode;
  valuationProvider: ValuationProviderName;
  liveStatus: {
    sheetsConfigured: boolean;
    geminiConfigured: boolean;
    catalogReadOnly: boolean;
    driveConfigured: boolean;
    activityStorage: "local" | "drive";
    spreadsheetId: string;
    driveFolderIds: {
      parent: string;
      knowledge: string;
    };
    sheetNames: {
      stones: string;
      settings: string;
      metalPricing: string;
      masterPopisi: string;
      inquiries: string;
      valuations: string;
    };
    missingEnv: string[];
  };
  defaults: {
    goldPricePerGram: number;
    quoteMarginMultiplier: number;
    metalPrices: MetalPrices;
    metalPricingSource: "env" | "sheet";
  };
  kpis: DashboardKpis;
  stones: Stone[];
  settings: Setting[];
  inquiries: Inquiry[];
  valuations: ValuationRecord[];
}

export interface StoneFilters {
  query?: string;
  stoneId?: string;
  name?: string;
  shape?: string;
  color?: string;
  quality?: string;
  size?: string;
  minCarat?: number;
  maxCarat?: number;
  minPricePerCarat?: number;
  maxPricePerCarat?: number;
}

export interface SettingFilters {
  query?: string;
  settingId?: string;
  settingIds?: string[];
  style?: string;
  metal?: string;
  minWeightG?: number;
  maxWeightG?: number;
  minComplexity?: number;
  maxComplexity?: number;
  minLaborCost?: number;
  maxLaborCost?: number;
  minBasePrice?: number;
  maxBasePrice?: number;
}

export interface QuoteInput {
  stone?: Stone | null;
  stones?: Stone[];
  setting?: Setting | null;
  settings?: Setting[];
  settingReferenceText?: string;
  targetGoldWeightG?: number;
  manualStoneCost?: number;
  manualSettingCost?: number;
  goldPricePerGram: number;
  metalPrices: MetalPrices;
  quoteMarginMultiplier: number;
}
