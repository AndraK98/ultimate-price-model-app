import { getAppConfig } from "@/lib/config";
import { mutateMockDatabase, readMockDatabase } from "@/lib/data/mock-store";
import { matchesSettingFilters, matchesStoneFilters } from "@/lib/catalog-search";
import { type AppRepository } from "@/lib/repositories/contracts";
import {
  type Inquiry,
  type PricingDefaults,
  type ProductComposition,
  type ProductCompositionStoneLine,
  type ProductCompositionVariant,
  type Setting,
  type SettingFilters,
  type Stone,
  type StoneFilters,
  type ValuationRecord,
} from "@/lib/types";
import { extractShopifyProductHandle, normalizeDigits, normalizeText } from "@/lib/utils";

const mockProductSettingSkuMap: Record<string, string[]> = {
  "1001001": ["SRY4PBS001"],
  "1001002": ["SRY4PBS002", "SRY4PBS004"],
  "1001003": ["SRY4HAS003"],
};

const mockProductHandleMap: Record<string, string> = {
  "halo-diamond-ring-demo": "1001003",
  "curve-band-ring-set-demo": "1001002",
  "plain-band-demo": "1001001",
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

  async findProductComposition(reference: string): Promise<ProductComposition | null> {
    const normalizedReference = normalizeText(reference);
    const digitReference = normalizeDigits(reference);
    const handleReference = extractShopifyProductHandle(reference);
    const productId =
      (digitReference && mockProductSettingSkuMap[digitReference] ? digitReference : "") ||
      mockProductHandleMap[handleReference] ||
      mockProductHandleMap[normalizedReference];

    if (!productId) {
      return null;
    }

    const database = await readMockDatabase();
    const settingIds = mockProductSettingSkuMap[productId] ?? [];
    const settings = settingIds
      .map((settingId) => database.settings.find((setting) => setting.setting_id === settingId) ?? null)
      .filter((setting): setting is Setting => setting !== null);

    const stoneLines: ProductCompositionStoneLine[] =
      productId === "1001003"
        ? [
            {
              stone_id: "NSDIWBO019",
              quantity: 1,
              role: "main",
              stone: database.stones.find((stone) => stone.stone_id === "NSDIWBO019") ?? null,
              label: "Main stone",
              shape: "Oval",
              cut: "Brilliant",
              quality: "VS / GIA",
              color: "F-G White",
              measurements: "8x6 mm",
            },
            {
              stone_id: "NSDIWBR120",
              quantity: 6,
              role: "accent",
              stone: database.stones.find((stone) => stone.stone_id === "NSDIWBR120") ?? null,
              label: "Accent stones",
              shape: "Round",
              cut: "Brilliant",
              quality: "Brilliant Cut",
              color: "White",
              measurements: "1.2 mm",
            },
          ]
        : productId === "1001002"
          ? [
              {
                stone_id: "NSDIWBR100",
                quantity: 2,
                role: "accent",
                stone: database.stones.find((stone) => stone.stone_id === "NSDIWBR100") ?? null,
                label: "Accent stones",
                shape: "Round",
                cut: "Brilliant",
                quality: "Brilliant Cut",
                color: "White",
                measurements: "1 mm",
              },
            ]
          : [];

    const variants: ProductCompositionVariant[] = [
      {
        variant_key: `${productId}::default`,
        variant_sku: productId === "1001003" ? "CAP-OVAL-HALO-14KY" : productId === "1001002" ? "CAP-CURVE-SET-14KY" : "CAP-PLAIN-14KY",
        ring_set_sku: "",
        set_sku_fix: "",
        metal: "14K Yellow Gold",
        band_size: "6",
        setting_style: settings.map((setting) => setting.style).join(", "),
        additional_description: "Mock recalled composition",
        setting_ids: settings.map((setting) => setting.setting_id),
        settings,
        stones: stoneLines,
        source_row_count: 1,
      },
    ];

    return {
      reference,
      matched_by: digitReference === productId ? "id" : normalizedReference.includes("http") ? "url" : "handle",
      product_id: productId,
      product_handle:
        Object.entries(mockProductHandleMap).find(([, id]) => id === productId)?.[0] ??
        normalizedReference,
      title:
        productId === "1001003"
          ? "Oval halo ring demo"
          : productId === "1001002"
            ? "Curve band ring set demo"
            : "Plain band demo",
      description: "Mock recalled composition from Shopify ID / URL.",
      default_variant_key: variants[0].variant_key,
      variants,
    };
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
    return database.valuations.sort((left, right) => right.updated_at.localeCompare(left.updated_at));
  }

  async findValuationById(valuationId: string): Promise<ValuationRecord | null> {
    const database = await readMockDatabase();
    return database.valuations.find((valuation) => valuation.valuation_id === valuationId) ?? null;
  }

  async createValuation(valuation: ValuationRecord): Promise<ValuationRecord> {
    return mutateMockDatabase(async (database) => {
      database.valuations.unshift(valuation);
      return valuation;
    });
  }

  async updateValuation(valuation: ValuationRecord): Promise<ValuationRecord> {
    return mutateMockDatabase(async (database) => {
      const index = database.valuations.findIndex((entry) => entry.valuation_id === valuation.valuation_id);

      if (index === -1) {
        database.valuations.unshift(valuation);
      } else {
        database.valuations[index] = valuation;
      }

      return valuation;
    });
  }
}
