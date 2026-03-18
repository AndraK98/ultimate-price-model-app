import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

import { inquiryInputSchema, valuationEstimateSchema, valuationRequestSchema, valuationResolvedDetailsSchema } from "@/lib/validators";

const dbPath = path.join(process.cwd(), "storage", "activity-db.json");

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
      ? source.valuations.map((valuation) => ({
          ...valuation,
          provider: "gemini",
        }))
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
