import { GeminiCatalogSearchAssistProvider } from "@/lib/ai/providers/gemini-catalog-search-assist-provider";
import { GeminiValuationProvider } from "@/lib/ai/providers/gemini-valuation-provider";
import { type CatalogSearchAssistRequest, type CatalogSearchAssistResult, type ValuationCatalogContext } from "@/lib/ai/types";
import { getAppConfig } from "@/lib/config";
import { type ValuationEstimate, type ValuationProviderName, type ValuationRequestInput } from "@/lib/types";

export async function estimateValuation(input: ValuationRequestInput, context: ValuationCatalogContext): Promise<{
  estimate: ValuationEstimate;
  provider: ValuationProviderName;
}> {
  const config = getAppConfig();

  if (!config.gemini.apiKey) {
    throw new Error("GEMINI_API_KEY is required for AI valuation.");
  }

  const provider = new GeminiValuationProvider(config.gemini.apiKey, config.gemini.model);
  const estimate = await provider.estimate(input, context);
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
