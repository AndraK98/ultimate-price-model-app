import { GeminiCatalogSearchAssistProvider } from "@/lib/ai/providers/gemini-catalog-search-assist-provider";
import { GeminiListingDraftProvider } from "@/lib/ai/providers/gemini-listing-draft-provider";
import { GeminiValuationProvider } from "@/lib/ai/providers/gemini-valuation-provider";
import { type CatalogSearchAssistRequest, type CatalogSearchAssistResult, type ListingDraftCatalogContext, type ValuationCatalogContext } from "@/lib/ai/types";
import { getAppConfig } from "@/lib/config";
import { type ListingDraftRequestInput, type ListingDraftResult, type ValuationEstimate, type ValuationMessage, type ValuationProviderName, type ValuationRequestInput } from "@/lib/types";
import { type ShopifyListingSnapshot } from "@/lib/services/shopify-listing-snapshot";

export async function estimateValuation(input: ValuationRequestInput, context: ValuationCatalogContext): Promise<{
  estimate: ValuationEstimate;
  provider: ValuationProviderName;
}>;
export async function estimateValuation(
  input: ValuationRequestInput,
  context: ValuationCatalogContext,
  options: { history?: ValuationMessage[] },
): Promise<{
  estimate: ValuationEstimate;
  provider: ValuationProviderName;
}>;
export async function estimateValuation(
  input: ValuationRequestInput,
  context: ValuationCatalogContext,
  options?: { history?: ValuationMessage[] },
): Promise<{
  estimate: ValuationEstimate;
  provider: ValuationProviderName;
}> {
  const config = getAppConfig();

  if (!config.gemini.apiKey) {
    throw new Error("GEMINI_API_KEY is required for AI valuation.");
  }

  const provider = new GeminiValuationProvider(config.gemini.apiKey, config.gemini.model);
  const estimate = await provider.estimate(input, context, options);
  return {
    estimate,
    provider: "gemini",
  };
}

export async function assistCatalogSearch(
  input: CatalogSearchAssistRequest,
  context: ValuationCatalogContext,
): Promise<{
  result: CatalogSearchAssistResult;
  provider: ValuationProviderName;
}> {
  const config = getAppConfig();

  if (!config.gemini.apiKey) {
    throw new Error("GEMINI_API_KEY is required for AI catalog filtering.");
  }

  const provider = new GeminiCatalogSearchAssistProvider(config.gemini.apiKey, config.gemini.model);
  const result = await provider.assist(input, context);
  return {
    result,
    provider: "gemini",
  };
}

export async function buildListingDraft(
  input: ListingDraftRequestInput,
  snapshot: ShopifyListingSnapshot,
  context: ListingDraftCatalogContext,
): Promise<{
  result: ListingDraftResult;
  provider: ValuationProviderName;
}> {
  const config = getAppConfig();

  if (!config.gemini.apiKey) {
    throw new Error("GEMINI_API_KEY is required for AI listing draft generation.");
  }

  const provider = new GeminiListingDraftProvider(config.gemini.apiKey, config.gemini.model);
  const result = await provider.draft(input, snapshot, context);
  return {
    result,
    provider: "gemini",
  };
}
