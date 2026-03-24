import { type ActivityDatabase } from "@/lib/data/activity-schema";
import {
  isDriveActivityStoreConfigured,
  mutateDriveActivityDatabase,
  readDriveActivityDatabase,
  writeDriveActivityDatabase,
} from "@/lib/data/drive-activity-store";
import {
  mutateFileActivityDatabase,
  readFileActivityDatabase,
  writeFileActivityDatabase,
} from "@/lib/data/file-activity-store";

export async function readActivityDatabase(): Promise<ActivityDatabase> {
  if (isDriveActivityStoreConfigured()) {
    return readDriveActivityDatabase();
  }

  return readFileActivityDatabase();
}

export async function writeActivityDatabase(database: ActivityDatabase): Promise<void> {
  if (isDriveActivityStoreConfigured()) {
    await writeDriveActivityDatabase(database);
    return;
  }

  await writeFileActivityDatabase(database);
}

export async function mutateActivityDatabase<T>(
  mutator: (database: ActivityDatabase) => Promise<T> | T,
): Promise<T> {
  if (isDriveActivityStoreConfigured()) {
    return mutateDriveActivityDatabase(mutator);
  }

  return mutateFileActivityDatabase(mutator);
}
