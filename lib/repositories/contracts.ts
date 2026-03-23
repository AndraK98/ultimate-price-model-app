import {
  type Inquiry,
  type ProductComposition,
  type PricingDefaults,
  type ResolvedDataMode,
  type Setting,
  type SettingFilters,
  type Stone,
  type StoneFilters,
  type ValuationRecord,
} from "@/lib/types";

export interface AppRepository {
  mode: ResolvedDataMode;
  listStones(filters?: StoneFilters): Promise<Stone[]>;
  createStone(stone: Stone): Promise<Stone>;
  findStoneById(stoneId: string): Promise<Stone | null>;
  listSettings(filters?: SettingFilters): Promise<Setting[]>;
  createSetting(setting: Setting): Promise<Setting>;
  findSettingById(settingId: string): Promise<Setting | null>;
  findSettingSkusByProductId(productId: string): Promise<string[]>;
  findProductComposition(reference: string): Promise<ProductComposition | null>;
  getPricingDefaults(): Promise<PricingDefaults>;
  listInquiries(): Promise<Inquiry[]>;
  createInquiry(inquiry: Inquiry): Promise<Inquiry>;
  listValuations(): Promise<ValuationRecord[]>;
  findValuationById(valuationId: string): Promise<ValuationRecord | null>;
  createValuation(valuation: ValuationRecord): Promise<ValuationRecord>;
  updateValuation(valuation: ValuationRecord): Promise<ValuationRecord>;
}
