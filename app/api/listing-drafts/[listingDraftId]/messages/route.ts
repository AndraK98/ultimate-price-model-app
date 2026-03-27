import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";

import { buildListingDraft } from "@/lib/ai";
import { mutateActivityDatabase } from "@/lib/data/activity-store";
import { getRepository } from "@/lib/repositories";
import { fetchShopifyListingSnapshot } from "@/lib/services/shopify-listing-snapshot";
import { type ListingDraftMessage, type ListingDraftRecord } from "@/lib/types";
import { createRecordId, toIsoNow } from "@/lib/utils";
import { valuationFollowUpSchema } from "@/lib/validators";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function badRequest(error: unknown) {
  if (error instanceof ZodError) {
    return NextResponse.json({ error: error.issues[0]?.message ?? "Invalid listing draft follow-up payload." }, { status: 400 });
  }

  const message = error instanceof Error ? error.message : "Unexpected listing draft follow-up API error.";
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

export async function POST(
  request: NextRequest,
  context: {
    params: Promise<{
      listingDraftId: string;
    }>;
  },
) {
  try {
    const repository = getRepository();
    const input = valuationFollowUpSchema.parse(await request.json());
    const { listingDraftId } = await context.params;

    const updated = await mutateActivityDatabase(async (database) => {
      const existing = database.listingDrafts.find((draft) => draft.listing_draft_id === listingDraftId);

      if (!existing) {
        throw new Error("Missing listing draft not found.");
      }

      const [snapshot, stones, settings] = await Promise.all([
        fetchShopifyListingSnapshot(existing.source_url),
        repository.listStones(),
        repository.listSettings(),
      ]);

      const createdAt = toIsoNow();
      const userMessage: ListingDraftMessage = {
        message_id: createRecordId("listing_draft_msg"),
        role: "user",
        content: input.message,
        created_at: createdAt,
      };

      const history = [...existing.messages, userMessage];
      const { result, provider } = await buildListingDraft(
        {
          source_url: existing.source_url,
          stone_clues: existing.stone_clues,
          metal_hint: existing.metal_hint,
          internal_notes: existing.internal_notes,
          weight_basis_preference: existing.weight_basis_preference,
          created_by: input.created_by,
        },
        snapshot,
        { stones, settings },
        { history, currentDraft: existing },
      );

      const nextRecord: ListingDraftRecord = {
        ...existing,
        ...result,
        provider,
        updated_at: createdAt,
        messages: history,
      };

      const assistantMessage: ListingDraftMessage = {
        message_id: createRecordId("listing_draft_msg"),
        role: "assistant",
        content: buildAssistantMessageContent(nextRecord),
        created_at: createdAt,
      };

      nextRecord.messages = [...history, assistantMessage];

      const index = database.listingDrafts.findIndex((draft) => draft.listing_draft_id === listingDraftId);
      database.listingDrafts[index] = nextRecord;
      return nextRecord;
    });

    return NextResponse.json(updated);
  } catch (error) {
    return badRequest(error);
  }
}
