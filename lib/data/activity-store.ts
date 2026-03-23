import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

import { resolveRuntimeStoragePath } from "@/lib/data/runtime-storage";
import {
  inquiryInputSchema,
  valuationEstimateSchema,
  valuationMessageSchema,
  valuationRequestSchema,
  valuationResolvedDetailsSchema,
} from "@/lib/validators";

const dbPath = resolveRuntimeStoragePath("activity-db.json");

const inquirySchema = inquiryInputSchema.extend({
  inquiry_id: z.string().trim().min(1),
  estimated_material_cost: z.coerce.number().finite(),
  estimated_quote: z.coerce.number().finite(),
  estimated_quote_18k: z.coerce.number().finite().optional(),
  created_at: z.string().trim().min(1),
  quote_breakdown: z.any().optional(),
});

const valuationRecordSchema = valuationRequestSchema.merge(valuationResolvedDetailsSchema).merge(valuationEstimateSchema).extend({
  valuation_id: z.string().trim().min(1),
  provider: z.literal("gemini"),
  created_at: z.string().trim().min(1),
  updated_at: z.string().trim().min(1),
  messages: z.array(valuationMessageSchema).default([]),
});

const activityDatabaseSchema = z.object({
  inquiries: z.array(inquirySchema),
  valuations: z.array(valuationRecordSchema),
});

export type ActivityDatabase = z.infer<typeof activityDatabaseSchema>;

const emptyActivityDatabase: ActivityDatabase = {
  inquiries: [],
  valuations: [],
};

let writeQueue = Promise.resolve();

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

function normalizeLegacyActivityDatabase(database: unknown): unknown {
  if (!database || typeof database !== "object") {
    return database;
  }

  const source = database as {
    inquiries?: unknown[];
    valuations?: Array<Record<string, unknown>>;
  };

  return {
    ...source,
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

async function ensureStorage(): Promise<void> {
  await mkdir(path.dirname(dbPath), { recursive: true });

  try {
    await access(dbPath);
  } catch {
    await writeFile(dbPath, JSON.stringify(emptyActivityDatabase, null, 2), "utf8");
  }
}

export async function readActivityDatabase(): Promise<ActivityDatabase> {
  await ensureStorage();
  const raw = await readFile(dbPath, "utf8");
  const parsedRaw = JSON.parse(raw);
  const normalized = normalizeLegacyActivityDatabase(parsedRaw);
  const database = activityDatabaseSchema.parse(normalized);

  if (JSON.stringify(parsedRaw) !== JSON.stringify(normalized)) {
    await writeActivityDatabase(database);
  }

  return database;
}

export async function writeActivityDatabase(database: ActivityDatabase): Promise<void> {
  writeQueue = writeQueue.then(async () => {
    await ensureStorage();
    await writeFile(dbPath, JSON.stringify(database, null, 2), "utf8");
  });

  await writeQueue;
}

export async function mutateActivityDatabase<T>(mutator: (database: ActivityDatabase) => Promise<T> | T): Promise<T> {
  const database = await readActivityDatabase();
  const result = await mutator(database);
  await writeActivityDatabase(database);
  return result;
}
