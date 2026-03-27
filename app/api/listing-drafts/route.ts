import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";

import { buildListingDraft } from "@/lib/ai";
import { mutateActivityDatabase, readActivityDatabase } from "@/lib/data/activity-store";
import { getRepository } from "@/lib/repositories";
import { fetchShopifyListingSnapshot } from "@/lib/services/shopify-listing-snapshot";
import { type ListingDraftMessage, type ListingDraftRecord } from "@/lib/types";
import { createRecordId, toIsoNow } from "@/lib/utils";
import { listingDraftRequestSchema } from "@/lib/validators";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function badRequest(error: unknown) {
  if (error instanceof ZodError) {
    return NextResponse.json({ error: error.issues[0]?.message ?? "Invalid listing draft payload." }, { status: 400 });
  }

  const message = error instanceof Error ? error.message : "Unexpected listing draft API error.";
  return NextResponse.json({ error: message }, { status: 500 });
}

function buildAssistantMessageContent(record: ListingDraftRecord) {
  return [
    `Drafted ${record.setting_sku || "no setting SKU"} with main stone ${record.main_stone_sku || record.main_stone || "none"} and side stone ${record.side_stone_sku || record.side_stone || "none"}.`,
    record.stone_matching_notes,
    record.reasoning,
    record.recommended_next_step,
  ]
    .filter(Boolean)
    .join("\n\n");
}

export async function GET() {
  try {
    const database = await readActivityDatabase();
    const listingDrafts = [...database.listingDrafts].sort((left, right) => right.updated_at.localeCompare(left.updated_at));
    return NextResponse.json(listingDrafts);
  } catch (error) {
    return badRequest(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const input = listingDraftRequestSchema.parse(await request.json());
    const repository = getRepository();
    const [snapshot, stones, settings] = await Promise.all([
      fetchShopifyListingSnapshot(input.source_url),
      repository.listStones(),
      repository.listSettings(),
    ]);

    const { result, provider } = await buildListingDraft(input, snapshot, { stones, settings });
    const createdAt = toIsoNow();
    const userMessage: ListingDraftMessage = {
      message_id: createRecordId("listing_draft_msg"),
      role: "user",
      content: [input.source_url, input.stone_clues, input.metal_hint, input.internal_notes].filter(Boolean).join("\n"),
      created_at: createdAt,
    };

    const draft: ListingDraftRecord = {
      ...input,
      ...result,
      provider,
      listing_draft_id: createRecordId("listing_draft"),
      created_at: createdAt,
      updated_at: createdAt,
      messages: [],
    };

    const assistantMessage: ListingDraftMessage = {
      message_id: createRecordId("listing_draft_msg"),
      role: "assistant",
      content: buildAssistantMessageContent(draft),
      created_at: createdAt,
    };

    draft.messages = [userMessage, assistantMessage];

    const created = await mutateActivityDatabase(async (database) => {
      database.listingDrafts.unshift(draft);
      return draft;
    });

    return NextResponse.json(created, { status: 201 });
  } catch (error) {
    return badRequest(error);
  }
}
