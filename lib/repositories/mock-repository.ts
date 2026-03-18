import { getAppConfig } from "@/lib/config";
import { mutateMockDatabase, readMockDatabase } from "@/lib/data/mock-store";
import { matchesSettingFilters, matchesStoneFilters } from "@/lib/catalog-search";
import { type AppRepository } from "@/lib/repositories/contracts";
import { type Inquiry, type PricingDefaults, type Setting, type SettingFilters, type Stone, type StoneFilters, type ValuationRecord } from "@/lib/types";
import { normalizeText } from "@/lib/utils";

const mockProductSettingSkuMap: Record<string, string[]> = {
  "1001001": ["SRY4PBS001"],
  "1001002": ["SRY4PBS002", "SRY4PBS004"],
  "1001003": ["SRY4HAS003"],
};

export class MockRepository implements AppRepository {
  mode = "mock" as const;
  private readonly config = getAppConfig();

  async listStones(filters?: StoneFilters): Promise<Stone[]> {
    const database = await readMockDatabase();

    return database.stones
      .filter((stone) => matchesStoneFilters(stone, filters))
      .sort((left, right) => right.created_at.localeCompare(left.created_at));
  }

  async createStone(stone: Stone): Promise<Stone> {
    return mutateMockDatabase(async (database) => {
      database.stones.unshift(stone);
      return stone;
    });
  }

  async findStoneById(stoneId: string): Promise<Stone | null> {
    const database = await readMockDatabase();
    return database.stones.find((stone) => stone.stone_id === stoneId) ?? null;
  }

  async listSettings(filters?: SettingFilters): Promise<Setting[]> {
    const database = await readMockDatabase();

    return database.settings
      .filter((setting) => !setting.setting_id.trim().toUpperCase().startsWith("SRY8"))
      .filter((setting) => matchesSettingFilters(setting, filters))
      .sort((left, right) => right.created_at.localeCompare(left.created_at));
  }

  async createSetting(setting: Setting): Promise<Setting> {
    return mutateMockDatabase(async (database) => {
      database.settings.unshift(setting);
      return setting;
    });
  }

  async findSettingById(settingId: string): Promise<Setting | null> {
    const database = await readMockDatabase();
    return database.settings.find((setting) => setting.setting_id === settingId) ?? null;
  }

  async findSettingSkusByProductId(productId: string): Promise<string[]> {
    return mockProductSettingSkuMap[normalizeText(productId)] ?? [];
  }

  async getPricingDefaults(): Promise<PricingDefaults> {
    return {
      metalPrices: {
        gold: this.config.goldPricePerGram,
        silver: this.config.goldPricePerGram,
        platinum: this.config.goldPricePerGram,
      },
      metalPricingSource: "env",
    };
  }

  async listInquiries(): Promise<Inquiry[]> {
    const database = await readMockDatabase();
    return database.inquiries.sort((left, right) => right.created_at.localeCompare(left.created_at));
  }

  async createInquiry(inquiry: Inquiry): Promise<Inquiry> {
    return mutateMockDatabase(async (database) => {
      database.inquiries.unshift(inquiry);
      return inquiry;
    });
  }

  async listValuations(): Promise<ValuationRecord[]> {
    const database = await readMockDatabase();
    return database.valuations.sort((left, right) => right.created_at.localeCompare(left.created_at));
  }

  async createValuation(valuation: ValuationRecord): Promise<ValuationRecord> {
    return mutateMockDatabase(async (database) => {
      database.valuations.unshift(valuation);
      return valuation;
    });
  }
}
