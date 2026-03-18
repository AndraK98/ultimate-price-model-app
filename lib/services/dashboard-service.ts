import { getAppConfig } from "@/lib/config";
import { getRepository } from "@/lib/repositories";
import { type DashboardSnapshot } from "@/lib/types";
import { roundCurrency } from "@/lib/utils";

const initialCatalogPageSize = 20;

export async function getDashboardSnapshot(): Promise<DashboardSnapshot> {
  const repository = getRepository();
  const config = getAppConfig();

  const [stones, settings, inquiries, valuations, pricingDefaults] = await Promise.all([
    repository.listStones(),
    repository.listSettings(),
    repository.listInquiries(),
    repository.listValuations(),
    repository.getPricingDefaults(),
  ]);

  const averageQuote =
    inquiries.length > 0
      ? roundCurrency(inquiries.reduce((sum, inquiry) => sum + inquiry.estimated_quote, 0) / inquiries.length)
      : 0;

  return {
    dataMode: repository.mode,
    valuationProvider: config.valuationProvider,
    liveStatus: config.liveStatus,
    defaults: {
      goldPricePerGram: config.goldPricePerGram,
      quoteMarginMultiplier: config.quoteMarginMultiplier,
      metalPrices: pricingDefaults.metalPrices,
      metalPricingSource: pricingDefaults.metalPricingSource,
    },
    kpis: {
      stoneCount: stones.length,
      activeStoneCount: stones.filter((stone) => stone.status === "active").length,
      settingCount: settings.length,
      activeSettingCount: settings.filter((setting) => setting.status === "active").length,
      openInquiryCount: inquiries.filter((inquiry) => inquiry.status !== "quoted" && inquiry.status !== "closed").length,
      valuationCount: valuations.length,
      averageQuote,
    },
    stones: stones.slice(0, initialCatalogPageSize),
    settings: settings.slice(0, initialCatalogPageSize),
    inquiries,
    valuations,
  };
}
