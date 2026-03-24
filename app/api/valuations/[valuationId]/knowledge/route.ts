import { NextRequest, NextResponse } from "next/server";

import { promoteValuationToKnowledge } from "@/lib/drive/knowledge-promotion-service";
import { getRepository } from "@/lib/repositories";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function badRequest(error: unknown) {
  const message = error instanceof Error ? error.message : "Unexpected knowledge promotion error.";
  return NextResponse.json({ error: message }, { status: 500 });
}

export async function POST(
  _request: NextRequest,
  context: {
    params: Promise<{
      valuationId: string;
    }>;
  },
) {
  try {
    const repository = getRepository();
    const { valuationId } = await context.params;
    const valuation = await repository.findValuationById(valuationId);

    if (!valuation) {
      return NextResponse.json({ error: "Approximation not found." }, { status: 404 });
    }

    const result = await promoteValuationToKnowledge(valuation);
    return NextResponse.json(result);
  } catch (error) {
    return badRequest(error);
  }
}
