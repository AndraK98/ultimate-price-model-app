import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  activityDatabaseSchema,
  emptyActivityDatabase,
  normalizeLegacyActivityDatabase,
  type ActivityDatabase,
} from "@/lib/data/activity-schema";
import { resolveRuntimeStoragePath } from "@/lib/data/runtime-storage";

const dbPath = resolveRuntimeStoragePath("activity-db.json");

let writeQueue = Promise.resolve();

async function ensureStorage(): Promise<void> {
  await mkdir(path.dirname(dbPath), { recursive: true });

  try {
    await access(dbPath);
  } catch {
    await writeFile(dbPath, JSON.stringify(emptyActivityDatabase, null, 2), "utf8");
  }
}

export async function readFileActivityDatabase(): Promise<ActivityDatabase> {
  await ensureStorage();
  const raw = await readFile(dbPath, "utf8");
  const parsedRaw = JSON.parse(raw);
  const normalized = normalizeLegacyActivityDatabase(parsedRaw);
  const database = activityDatabaseSchema.parse(normalized);

  if (JSON.stringify(parsedRaw) !== JSON.stringify(normalized)) {
    await writeFileActivityDatabase(database);
  }

  return database;
}

export async function writeFileActivityDatabase(database: ActivityDatabase): Promise<void> {
  writeQueue = writeQueue.then(async () => {
    await ensureStorage();
    await writeFile(dbPath, JSON.stringify(database, null, 2), "utf8");
  });

  await writeQueue;
}

export async function mutateFileActivityDatabase<T>(
  mutator: (database: ActivityDatabase) => Promise<T> | T,
): Promise<T> {
  const database = await readFileActivityDatabase();
  const result = await mutator(database);
  await writeFileActivityDatabase(database);
  return result;
}
