import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";

import { buildListingDraft } from "@/lib/ai";
import { getRepository } from "@/lib/repositories";
import { fetchShopifyListingSnapshot } from "@/lib/services/shopify-listing-snapshot";
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

export async function POST(request: NextRequest) {
  try {
    const input = listingDraftRequestSchema.parse(await request.json());
    const repository = getRepository();
    const [snapshot, settings] = await Promise.all([
      fetchShopifyListingSnapshot(input.source_url),
      repository.listSettings(),
    ]);

    const { result } = await buildListingDraft(input, snapshot, { settings });
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return badRequest(error);
  }
}
