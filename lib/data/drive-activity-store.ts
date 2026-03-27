import { getAppConfig } from "@/lib/config";
import {
  activityDatabaseSchema,
  emptyActivityDatabase,
  normalizeLegacyActivityDatabase,
  type ActivityDatabase,
} from "@/lib/data/activity-schema";
import { GoogleDriveClient } from "@/lib/drive/google-drive-client";

type DriveFolderSet = {
  chatsFolderId: string;
  customListingsFolderId: string;
  approximationsFolderId: string;
  missingListingDraftsFolderId: string;
};

let folderCache: DriveFolderSet | null = null;
let folderCacheKey = "";
let writeQueue = Promise.resolve();

function getDriveClient() {
  const config = getAppConfig();

  return new GoogleDriveClient({
    serviceAccountEmail: config.google.serviceAccountEmail,
    privateKey: config.google.privateKey,
  });
}

async function resolveDriveFolders(): Promise<DriveFolderSet> {
  const config = getAppConfig();
  const cacheKey = [
    config.google.drive.parentFolderId,
    config.google.drive.assistantFolderId,
    config.google.drive.knowledgeFolderId,
    config.google.drive.chatsFolderId,
    config.google.drive.customListingsFolderId,
    config.google.drive.approximationsFolderId,
    config.google.drive.missingListingDraftsFolderId,
  ].join("::");

  if (folderCache && folderCacheKey === cacheKey) {
    return folderCache;
  }

  const client = getDriveClient();
  const knowledgeFolder = await client.getFile(config.google.drive.knowledgeFolderId);
  const assistantFolderId = config.google.drive.assistantFolderId || knowledgeFolder.parents?.[0];

  if (!assistantFolderId) {
    throw new Error("The configured Google Drive knowledge folder has no parent folder.");
  }

  const [chatsFolder, customListingsFolder, approximationsFolder, missingListingDraftsFolder] = await Promise.all([
    config.google.drive.chatsFolderId
      ? client.getFile(config.google.drive.chatsFolderId)
      : client.ensureFolder(assistantFolderId, "Chats"),
    config.google.drive.customListingsFolderId
      ? client.getFile(config.google.drive.customListingsFolderId)
      : client.ensureFolder(config.google.drive.parentFolderId, "custom-listings"),
    config.google.drive.approximationsFolderId
      ? client.getFile(config.google.drive.approximationsFolderId)
      : client.ensureFolder(config.google.drive.parentFolderId, "approximations"),
    config.google.drive.missingListingDraftsFolderId
      ? client.getFile(config.google.drive.missingListingDraftsFolderId)
      : client.ensureFolder(config.google.drive.parentFolderId, "Missing Listing Draft Conversations"),
  ]);

  folderCache = {
    chatsFolderId: chatsFolder.id,
    customListingsFolderId: customListingsFolder.id,
    approximationsFolderId: approximationsFolder.id,
    missingListingDraftsFolderId: missingListingDraftsFolder.id,
  };
  folderCacheKey = cacheKey;

  return folderCache;
}

async function readJsonFolder<T>(folderId: string): Promise<T[]> {
  const client = getDriveClient();
  const files = await client.listFiles({
    query: `'${folderId}' in parents and trashed=false and mimeType='application/json'`,
  });

  if (!files.length) {
    return [];
  }

  const items = await Promise.all(
    files.map(async (file) => {
      const content = await client.downloadTextFile(file.id);
      return JSON.parse(content) as T;
    }),
  );

  return items;
}

async function upsertJsonFile(folderId: string, name: string, content: unknown): Promise<void> {
  const client = getDriveClient();
  const existing = await client.findChildByName(folderId, name, "application/json");

  if (existing) {
    await client.updateJsonFile(existing.id, name, content);
    return;
  }

  await client.createJsonFile(folderId, name, content);
}

export async function readDriveActivityDatabase(): Promise<ActivityDatabase> {
  const folders = await resolveDriveFolders();
  const [inquiries, valuations, listingDrafts] = await Promise.all([
    readJsonFolder(folders.customListingsFolderId),
    readJsonFolder(folders.approximationsFolderId),
    readJsonFolder(folders.missingListingDraftsFolderId),
  ]);

  const normalized = normalizeLegacyActivityDatabase({
    inquiries,
    valuations,
    listingDrafts,
  });

  return activityDatabaseSchema.parse(normalized);
}

export async function writeDriveActivityDatabase(database: ActivityDatabase): Promise<void> {
  writeQueue = writeQueue.then(async () => {
    const folders = await resolveDriveFolders();

    await Promise.all([
      ...database.inquiries.map((inquiry) =>
        upsertJsonFile(folders.customListingsFolderId, `${inquiry.inquiry_id}.json`, inquiry),
      ),
      ...database.valuations.flatMap((valuation) => [
        upsertJsonFile(folders.approximationsFolderId, `${valuation.valuation_id}.json`, valuation),
        upsertJsonFile(folders.chatsFolderId, `${valuation.valuation_id}.json`, valuation),
      ]),
      ...database.listingDrafts.map((listingDraft) =>
        upsertJsonFile(
          folders.missingListingDraftsFolderId,
          `${listingDraft.listing_draft_id}.json`,
          listingDraft,
        ),
      ),
    ]);
  });

  await writeQueue;
}

export async function mutateDriveActivityDatabase<T>(
  mutator: (database: ActivityDatabase) => Promise<T> | T,
): Promise<T> {
  const database = await readDriveActivityDatabase();
  const result = await mutator(database);
  await writeDriveActivityDatabase(database);
  return result;
}

export function isDriveActivityStoreConfigured() {
  const config = getAppConfig();

  return (
    Boolean(config.google.serviceAccountEmail) &&
    Boolean(config.google.privateKey) &&
    Boolean(config.google.drive.parentFolderId) &&
    Boolean(config.google.drive.knowledgeFolderId)
  );
}

export async function readDriveActivityDatabaseOrEmpty(): Promise<ActivityDatabase> {
  if (!isDriveActivityStoreConfigured()) {
    return emptyActivityDatabase;
  }

  return readDriveActivityDatabase();
}
