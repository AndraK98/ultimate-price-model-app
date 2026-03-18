import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";

import { getAppConfig } from "@/lib/config";
import { getRepository } from "@/lib/repositories";
import { type Setting, type Stone } from "@/lib/types";
import { buildInquiryRecord, resolveSettingReferenceText } from "@/lib/services/quote-service";
import { inquiryInputSchema } from "@/lib/validators";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function badRequest(error: unknown) {
  if (error instanceof ZodError) {
    return NextResponse.json({ error: error.issues[0]?.message ?? "Invalid inquiry payload." }, { status: 400 });
  }

  const message = error instanceof Error ? error.message : "Unexpected inquiry API error.";
  return NextResponse.json({ error: message }, { status: 500 });
}

function parseRecordIds(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function isStone(value: Stone | null): value is Stone {
  return value !== null;
}

function isSetting(value: Setting | null): value is Setting {
  return value !== null;
}

export async function GET() {
  try {
    const repository = getRepository();
    const inquiries = await repository.listInquiries();
    return NextResponse.json(inquiries);
  } catch (error) {
    return badRequest(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const repository = getRepository();
    const config = getAppConfig();
    const input = inquiryInputSchema.parse(await request.json());
    const stoneIds = parseRecordIds(input.stone_id);
    const settingIds = parseRecordIds(input.setting_id);

    const [stones, settings, pricingDefaults] = await Promise.all([
      Promise.all(stoneIds.map((stoneId) => repository.findStoneById(stoneId))).then((records) => records.filter(isStone)),
      Promise.all(settingIds.map((settingId) => repository.findSettingById(settingId))).then((records) =>
        records.filter(isSetting),
      ),
      repository.getPricingDefaults(),
    ]);

    const inquiry = buildInquiryRecord({
      customer_name: input.customer_name,
      stone_ids: stoneIds,
      setting_ids: settingIds,
      custom_stone_text: input.custom_stone_text,
      custom_setting_text: input.custom_setting_text,
      settingReferenceText: resolveSettingReferenceText(settingIds.join(", "), input.custom_setting_text),
      target_size_mm: input.target_size_mm,
      target_gold_weight_g: input.target_gold_weight_g,
      manual_stone_estimate: input.manual_stone_estimate,
      manual_setting_estimate: input.manual_setting_estimate,
      status: input.status,
      reference_image_url: input.reference_image_url,
      created_by: input.created_by,
      stones,
      settings,
      goldPricePerGram: config.goldPricePerGram,
      metalPrices: pricingDefaults.metalPrices,
      quoteMarginMultiplier: config.quoteMarginMultiplier,
    });

    const created = await repository.createInquiry(inquiry);
    return NextResponse.json(created, { status: 201 });
  } catch (error) {
    return badRequest(error);
  }
}
