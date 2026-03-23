import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";

import { getRepository } from "@/lib/repositories";
import { paginateItems, parseInteger, parseOptionalNumber } from "@/lib/utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const allowedPageSizes = new Set([20, 50, 100]);

function badRequest(error: unknown) {
  if (error instanceof ZodError) {
    return NextResponse.json({ error: error.issues[0]?.message ?? "Invalid setting payload." }, { status: 400 });
  }

  const message = error instanceof Error ? error.message : "Unexpected setting API error.";
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
    const composition = productReference ? await repository.findProductComposition(productReference) : null;
    const settingIds = composition
      ? Array.from(new Set(composition.variants.flatMap((variant) => variant.setting_ids)))
      : undefined;

    if (productReference && !settingIds?.length) {
      return NextResponse.json(paginateItems([], page, pageSize));
    }

    const filters = {
      query: request.nextUrl.searchParams.get("query") ?? undefined,
      settingIds,
      settingId: request.nextUrl.searchParams.get("settingId") ?? undefined,
      style: request.nextUrl.searchParams.get("style") ?? undefined,
      metal: request.nextUrl.searchParams.get("metal") ?? undefined,
      minWeightG: parseOptionalNumber(request.nextUrl.searchParams.get("minWeightG")),
      maxWeightG: parseOptionalNumber(request.nextUrl.searchParams.get("maxWeightG")),
      minComplexity: parseOptionalNumber(request.nextUrl.searchParams.get("minComplexity")),
      maxComplexity: parseOptionalNumber(request.nextUrl.searchParams.get("maxComplexity")),
      minLaborCost: parseOptionalNumber(request.nextUrl.searchParams.get("minLaborCost")),
      maxLaborCost: parseOptionalNumber(request.nextUrl.searchParams.get("maxLaborCost")),
      minBasePrice: parseOptionalNumber(request.nextUrl.searchParams.get("minBasePrice")),
      maxBasePrice: parseOptionalNumber(request.nextUrl.searchParams.get("maxBasePrice")),
    };

    const settings = await repository.listSettings(filters);
    return NextResponse.json(paginateItems(settings, page, pageSize));
  } catch (error) {
    return badRequest(error);
  }
}

export async function POST(request: NextRequest) {
  void request;
  return NextResponse.json(
    { error: "Setting catalog is read-only. Update the source Google Sheet instead of writing through the app." },
    { status: 405 },
  );
}
