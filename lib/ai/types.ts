import {
  type MetalPrices,
  type SettingFilters,
  type Setting,
  type StoneFilters,
  type Stone,
  type ValuationEstimate,
  type ValuationMessage,
  type ValuationProviderName,
  type ValuationRequestInput,
} from "@/lib/types";

export interface ValuationCatalogContext {
  stones: Stone[];
  settings: Setting[];
  defaults: {
    goldPricePerGram: number;
    quoteMarginMultiplier: number;
    metalPrices: MetalPrices;
    metalPricingSource: "env" | "sheet";
  };
}

export interface ValuationProvider {
  providerName: ValuationProviderName;
  estimate(
    input: ValuationRequestInput,
    context: ValuationCatalogContext,
    options?: { history?: ValuationMessage[] },
  ): Promise<ValuationEstimate>;
}

export type CatalogSearchAssistTarget = "stone" | "setting";

export interface CatalogSearchAssistRequest {
  target: CatalogSearchAssistTarget;
  query: string;
}

export interface CatalogSearchAssistResult {
  normalizedQuery: string;
  summary: string;
  stoneFilters?: Partial<StoneFilters>;
  settingFilters?: Partial<SettingFilters>;
}

export interface CatalogSearchAssistProvider {
  providerName: ValuationProviderName;
  assist(
    input: CatalogSearchAssistRequest,
    context: ValuationCatalogContext,
  ): Promise<CatalogSearchAssistResult>;
}
