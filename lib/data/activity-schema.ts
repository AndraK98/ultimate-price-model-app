import { z } from "zod";

import {
  inquiryInputSchema,
  listingDraftRecordSchema,
  valuationEstimateSchema,
  valuationMessageSchema,
  valuationRequestSchema,
  valuationResolvedDetailsSchema,
} from "@/lib/validators";

const inquirySchema = inquiryInputSchema.extend({
  inquiry_id: z.string().trim().min(1),
  estimated_material_cost: z.coerce.number().finite(),
  estimated_quote: z.coerce.number().finite(),
  estimated_quote_18k: z.coerce.number().finite().optional(),
  created_at: z.string().trim().min(1),
  quote_breakdown: z.any().optional(),
});

const valuationRecordSchema = valuationRequestSchema
  .merge(valuationResolvedDetailsSchema)
  .merge(valuationEstimateSchema)
  .extend({
    valuation_id: z.string().trim().min(1),
    provider: z.literal("gemini"),
    created_at: z.string().trim().min(1),
    updated_at: z.string().trim().min(1),
    messages: z.array(valuationMessageSchema).default([]),
  });

export const activityDatabaseSchema = z.object({
  inquiries: z.array(inquirySchema),
  valuations: z.array(valuationRecordSchema),
  listingDrafts: z.array(listingDraftRecordSchema).default([]),
});

export type ActivityDatabase = z.infer<typeof activityDatabaseSchema>;

export const emptyActivityDatabase: ActivityDatabase = {
  inquiries: [],
  valuations: [],
  listingDrafts: [],
};

function buildLegacyAssistantMessage(valuation: Record<string, unknown>) {
  const createdAt = String(valuation.created_at ?? "").trim();
  const pricingSummary = String(valuation.pricing_summary ?? "").trim();
  const reasoning = String(valuation.reasoning ?? "").trim();
  const recommendedNextStep = String(valuation.recommended_next_step ?? "").trim();
  const assistantBody = [pricingSummary, reasoning, recommendedNextStep].filter(Boolean).join("\n\n");

  return {
    message_id: String(valuation.valuation_id ?? "valuation").trim() || "valuation",
    role: "assistant" as const,
    content: assistantBody || "Gemini approximation logged.",
    created_at: createdAt || new Date().toISOString(),
    estimated_value_low: valuation.estimated_value_low,
    estimated_value_high: valuation.estimated_value_high,
    estimated_formula_total: valuation.estimated_formula_total,
    pricing_summary: pricingSummary,
    reasoning,
    recommended_next_step: recommendedNextStep,
  };
}

export function normalizeLegacyActivityDatabase(database: unknown): unknown {
  if (!database || typeof database !== "object") {
    return database;
  }

  const source = database as {
    inquiries?: unknown[];
    valuations?: Array<Record<string, unknown>>;
    listingDrafts?: unknown[];
  };

  return {
    ...source,
    listingDrafts: Array.isArray(source.listingDrafts) ? source.listingDrafts : [],
    valuations: Array.isArray(source.valuations)
      ? source.valuations.map((valuation) => {
          const createdAt = String(valuation.created_at ?? "").trim() || new Date().toISOString();
          const description = String(valuation.description ?? "").trim();
          const messages =
            Array.isArray(valuation.messages) && valuation.messages.length > 0
              ? valuation.messages
              : [
                  ...(description
                    ? [
                        {
                          message_id: `${String(valuation.valuation_id ?? "valuation").trim() || "valuation"}_user`,
                          role: "user" as const,
                          content: description,
                          created_at: createdAt,
                        },
                      ]
                    : []),
                  buildLegacyAssistantMessage(valuation),
                ];

          return {
            ...valuation,
            provider: "gemini",
            updated_at: String(valuation.updated_at ?? "").trim() || createdAt,
            messages,
          };
        })
      : source.valuations,
  };
}
