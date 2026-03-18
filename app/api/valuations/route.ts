import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";

import { estimateValuation } from "@/lib/ai";
import { getAppConfig } from "@/lib/config";
import { getRepository } from "@/lib/repositories";
import { type ValuationRecord } from "@/lib/types";
import { createRecordId, toIsoNow } from "@/lib/utils";
import { valuationRequestSchema } from "@/lib/validators";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function badRequest(error: unknown) {
  if (error instanceof ZodError) {
    return NextResponse.json({ error: error.issues[0]?.message ?? "Invalid valuation payload." }, { status: 400 });
  }

  const message = error instanceof Error ? error.message : "Unexpected valuation API error.";
  return NextResponse.json({ error: message }, { status: 500 });
}

export async function GET() {
  try {
    const repository = getRepository();
    const valuations = await repository.listValuations();
    return NextResponse.json(valuations);
  } catch (error) {
    return badRequest(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const repository = getRepository();
    const config = getAppConfig();
    const input = valuationRequestSchema.parse(await request.json());
    const [stones, settings, pricingDefaults] = await Promise.all([
      repository.listStones(),
      repository.listSettings(),
      repository.getPricingDefaults(),
    ]);

    const { estimate, provider } = await estimateValuation(input, {
      stones,
      settings,
      defaults: {
        goldPricePerGram: config.goldPricePerGram,
        quoteMarginMultiplier: config.quoteMarginMultiplier,
        metalPrices: pricingDefaults.metalPrices,
        metalPricingSource: pricingDefaults.metalPricingSource,
      },
    });

    const valuation: ValuationRecord = {
      valuation_id: createRecordId("valuation"),
      valuation_target: estimate.inferred_valuation_target,
      description: input.description,
      stone_type: estimate.inferred_stone_type,
      stone_shape: estimate.inferred_stone_shape,
      stone_cut: estimate.inferred_stone_cut,
      setting_style: estimate.inferred_setting_style,
      metal: estimate.inferred_metal,
      carat: estimate.inferred_carat,
      complexity_level: estimate.inferred_complexity_level,
      gold_weight_g: estimate.inferred_gold_weight_g,
      notes: "",
      image_data_url: input.image_data_url,
      reference_image_url: input.reference_image_url,
      estimated_value_low: estimate.estimated_value_low,
      estimated_value_high: estimate.estimated_value_high,
      pricing_summary: estimate.pricing_summary,
      reasoning: estimate.reasoning,
      recommended_next_step: estimate.recommended_next_step,
      matched_catalog_stone_id: estimate.matched_catalog_stone_id,
      matched_catalog_setting_id: estimate.matched_catalog_setting_id,
      grounding_search_queries: estimate.grounding_search_queries ?? [],
      grounding_sources: estimate.grounding_sources ?? [],
      provider,
      created_by: input.created_by,
      created_at: toIsoNow(),
    };

    const created = await repository.createValuation(valuation);
    return NextResponse.json(created, { status: 201 });
  } catch (error) {
    return badRequest(error);
  }
}
