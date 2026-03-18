import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

import { mockSeed, type MockDatabase } from "@/lib/data/mock-seed";
import { resolveRuntimeStoragePath } from "@/lib/data/runtime-storage";
import {
  inquiryInputSchema,
  settingInputSchema,
  stoneInputSchema,
  valuationEstimateSchema,
  valuationRequestSchema,
  valuationResolvedDetailsSchema,
} from "@/lib/validators";

const dbPath = resolveRuntimeStoragePath("mock-db.json");

const stoneSchema = stoneInputSchema.extend({
  stone_id: z.string().trim().min(1),
  created_at: z.string().trim().min(1),
});

const settingSchema = settingInputSchema.extend({
  setting_id: z.string().trim().min(1),
  created_at: z.string().trim().min(1),
  quote_18k_setting_id: z.string().trim().optional(),
  quote_18k_price: z.coerce.number().finite().nonnegative().optional(),
  quote_18k_gold_weight_g: z.coerce.number().finite().nonnegative().optional(),
});

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

const mockDatabaseSchema = z.object({
  stones: z.array(stoneSchema),
  settings: z.array(settingSchema),
  inquiries: z.array(inquirySchema),
  valuations: z.array(valuationRecordSchema),
});

let writeQueue = Promise.resolve();

function normalizeLegacyMockDatabase(database: unknown): unknown {
  if (!database || typeof database !== "object") {
    return database;
  }

  const source = database as {
    stones?: unknown[];
    settings?: unknown[];
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
    await writeFile(dbPath, JSON.stringify(mockSeed, null, 2), "utf8");
  }
}

export async function readMockDatabase(): Promise<MockDatabase> {
  await ensureStorage();
  const raw = await readFile(dbPath, "utf8");
  const parsedRaw = JSON.parse(raw);
  const normalized = normalizeLegacyMockDatabase(parsedRaw);
  const database = mockDatabaseSchema.parse(normalized);

  if (JSON.stringify(parsedRaw) !== JSON.stringify(normalized)) {
    await writeMockDatabase(database);
  }

  return database;
}

export async function writeMockDatabase(database: MockDatabase): Promise<void> {
  writeQueue = writeQueue.then(async () => {
    await ensureStorage();
    await writeFile(dbPath, JSON.stringify(database, null, 2), "utf8");
  });

  await writeQueue;
}

export async function mutateMockDatabase<T>(mutator: (database: MockDatabase) => Promise<T> | T): Promise<T> {
  const database = await readMockDatabase();
  const result = await mutator(database);
  await writeMockDatabase(database);
  return result;
}
