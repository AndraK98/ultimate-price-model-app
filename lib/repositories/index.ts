import { getAppConfig } from "@/lib/config";
import { type AppRepository } from "@/lib/repositories/contracts";
import { MockRepository } from "@/lib/repositories/mock-repository";
import { SheetsRepository } from "@/lib/repositories/sheets-repository";

let repository: AppRepository | null = null;

export function getRepository(): AppRepository {
  if (repository) {
    return repository;
  }

  const config = getAppConfig();

  if (config.resolvedDataMode === "sheets") {
    if (!config.sheetsReady) {
      throw new Error("DATA_MODE is set to sheets, but Google Sheets credentials are incomplete.");
    }

    repository = new SheetsRepository();
    return repository;
  }

  repository = new MockRepository();
  return repository;
}
