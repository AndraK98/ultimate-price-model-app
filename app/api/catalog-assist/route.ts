import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";

import { assistCatalogSearch } from "@/lib/ai";
import { getAppConfig } from "@/lib/config";
import { getRepository } from "@/lib/repositories";
import { catalogSearchAssistRequestSchema } from "@/lib/validators";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function badRequest(error: unknown) {
  if (error instanceof ZodError) {
    return NextResponse.json({ error: error.issues[0]?.message ?? "Invalid catalog assist request." }, { status: 400 });
  }

  const message = error instanceof Error ? error.message : "Unexpected catalog assist API error.";
  return NextResponse.json({ error: message }, { status: 500 });
}

export async function POST(request: NextRequest) {
  try {
    const repository = getRepository();
    const config = getAppConfig();
    const input = catalogSearchAssistRequestSchema.parse(await request.json());
    const [stones, settings, pricingDefaults] = await Promise.all([
      repository.listStones(),
      repository.listSettings(),
      repository.getPricingDefaults(),
    ]);

    const { result, provider } = await assistCatalogSearch(
      {
        target: input.target,
        query: input.query,
      },
      {
        stones,
        settings,
        defaults: {
          goldPricePerGram: config.goldPricePerGram,
          quoteMarginMultiplier: config.quoteMarginMultiplier,
          metalPrices: pricingDefaults.metalPrices,
          metalPricingSource: pricingDefaults.metalPricingSource,
        },
      },
    );

    return NextResponse.json({
      provider,
      normalizedQuery: result.normalizedQuery,
      summary: result.summary,
      filters: input.target === "stone" ? result.stoneFilters ?? {} : result.settingFilters ?? {},
    });
  } catch (error) {
    return badRequest(error);
  }
}
