import { readActivityDatabase } from "@/lib/data/activity-store";
import { getAppConfig } from "@/lib/config";
import { getRepository } from "@/lib/repositories";
import { type DashboardSnapshot } from "@/lib/types";
import { roundCurrency } from "@/lib/utils";

const initialCatalogPageSize = 20;

export async function getDashboardSnapshot(): Promise<DashboardSnapshot> {
  const repository = getRepository();
  const config = getAppConfig();

  const [stones, settings, inquiries, valuations, pricingDefaults, activityDatabase] = await Promise.all([
    repository.listStones(),
    repository.listSettings(),
    repository.listInquiries(),
    repository.listValuations(),
    repository.getPricingDefaults(),
    readActivityDatabase(),
  ]);
  const listingDrafts = activityDatabase.listingDrafts.sort((left, right) => right.updated_at.localeCompare(left.updated_at));

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
      listingDraftCount: listingDrafts.length,
      averageQuote,
    },
    stones: stones.slice(0, initialCatalogPageSize),
    settings: settings.slice(0, initialCatalogPageSize),
    inquiries,
    valuations,
    listingDrafts,
  };
}
