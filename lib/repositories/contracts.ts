import {
  type Inquiry,
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
  getPricingDefaults(): Promise<PricingDefaults>;
  listInquiries(): Promise<Inquiry[]>;
  createInquiry(inquiry: Inquiry): Promise<Inquiry>;
  listValuations(): Promise<ValuationRecord[]>;
  createValuation(valuation: ValuationRecord): Promise<ValuationRecord>;
}
