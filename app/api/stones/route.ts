import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";

import { getRepository } from "@/lib/repositories";
import { paginateItems, parseInteger, parseOptionalNumber } from "@/lib/utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const allowedPageSizes = new Set([20, 50, 100]);

function badRequest(error: unknown) {
  if (error instanceof ZodError) {
    return NextResponse.json({ error: error.issues[0]?.message ?? "Invalid stone payload." }, { status: 400 });
  }

  const message = error instanceof Error ? error.message : "Unexpected stone API error.";
  return NextResponse.json({ error: message }, { status: 500 });
}

export async function GET(request: NextRequest) {
  try {
    const repository = getRepository();
    const requestedPageSize = parseInteger(
      request.nextUrl.searchParams.get("pageSize") ?? request.nextUrl.searchParams.get("limit"),
      20,
    );
    const pageSize = allowedPageSizes.has(requestedPageSize) ? requestedPageSize : 20;
    const page = Math.max(1, parseInteger(request.nextUrl.searchParams.get("page"), 1));
    const productReference = request.nextUrl.searchParams.get("productId")?.trim() ?? "";
    const filters = {
      query: request.nextUrl.searchParams.get("query") ?? undefined,
      stoneId: request.nextUrl.searchParams.get("stoneId") ?? undefined,
      name: request.nextUrl.searchParams.get("name") ?? undefined,
      shape: request.nextUrl.searchParams.get("shape") ?? undefined,
      color: request.nextUrl.searchParams.get("color") ?? undefined,
      quality: request.nextUrl.searchParams.get("quality") ?? undefined,
      size: request.nextUrl.searchParams.get("size") ?? undefined,
      minCarat: parseOptionalNumber(request.nextUrl.searchParams.get("minCarat")),
      maxCarat: parseOptionalNumber(request.nextUrl.searchParams.get("maxCarat")),
      minPricePerCarat: parseOptionalNumber(request.nextUrl.searchParams.get("minPricePerCarat")),
      maxPricePerCarat: parseOptionalNumber(request.nextUrl.searchParams.get("maxPricePerCarat")),
    };

    const stones = await repository.listStones(filters);

    if (!productReference) {
      return NextResponse.json(paginateItems(stones, page, pageSize));
    }

    const composition = await repository.findProductComposition(productReference);

    if (!composition) {
      return NextResponse.json(paginateItems([], page, pageSize));
    }

    const recalledStoneIds = new Set(
      composition.variants.flatMap((variant) =>
        variant.stones.map((line) => line.stone_id.trim().toUpperCase()).filter(Boolean),
      ),
    );
    const filteredStones = stones.filter((stone) => recalledStoneIds.has(stone.stone_id.trim().toUpperCase()));

    return NextResponse.json(paginateItems(filteredStones, page, pageSize));
  } catch (error) {
    return badRequest(error);
  }
}

export async function POST(request: NextRequest) {
  void request;
  return NextResponse.json(
    { error: "Stone catalog is read-only. Update the source Google Sheet instead of writing through the app." },
    { status: 405 },
  );
}
