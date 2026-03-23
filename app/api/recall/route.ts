import { NextRequest, NextResponse } from "next/server";

import { getRepository } from "@/lib/repositories";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const reference = request.nextUrl.searchParams.get("reference")?.trim() ?? "";

    if (!reference) {
      return NextResponse.json({ error: "reference is required." }, { status: 400 });
    }

    const repository = getRepository();
    const composition = await repository.findProductComposition(reference);

    if (!composition) {
      return NextResponse.json({ error: "No matching Shopify composition was found." }, { status: 404 });
    }

    return NextResponse.json(composition);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected recall API error.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
