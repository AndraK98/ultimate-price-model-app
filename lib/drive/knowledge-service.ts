import { getAppConfig } from "@/lib/config";
import { GoogleDriveClient, type DriveFile } from "@/lib/drive/google-drive-client";
import { type KnowledgeFileReference, type ValuationMessage } from "@/lib/types";

type LoadedKnowledgeFile = {
  file_id: string;
  name: string;
  web_view_url: string;
  content: string;
  modified_time: string;
};

type KnowledgeSnippet = {
  reference: KnowledgeFileReference;
  excerpt: string;
};

const supportedExtensions = [".md", ".txt", ".json", ".csv"] as const;
const cacheTtlMs = 60_000;

let cache:
  | {
      key: string;
      loadedAt: number;
      files: LoadedKnowledgeFile[];
    }
  | null = null;

function createClient() {
  const config = getAppConfig();

  return new GoogleDriveClient({
    serviceAccountEmail: config.google.serviceAccountEmail,
    privateKey: config.google.privateKey,
  });
}

function normalizeText(value: string) {
  return value.trim().toLowerCase();
}

function tokenize(value: string) {
  return Array.from(
    new Set(
      value
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((token) => token.length >= 3),
    ),
  );
}

function isSupportedKnowledgeFile(file: DriveFile) {
  const normalizedName = file.name.trim().toLowerCase();
  return supportedExtensions.some((extension) => normalizedName.endsWith(extension));
}

function buildKnowledgeExcerpt(content: string, tokens: string[]) {
  const normalizedContent = content.trim();

  if (!normalizedContent) {
    return "";
  }

  const lower = normalizedContent.toLowerCase();
  const firstMatchIndex = tokens
    .map((token) => lower.indexOf(token))
    .filter((index) => index >= 0)
    .sort((left, right) => left - right)[0];

  if (firstMatchIndex === undefined) {
    return normalizedContent.slice(0, 1400);
  }

  const start = Math.max(0, firstMatchIndex - 320);
  const end = Math.min(normalizedContent.length, start + 1400);
  return normalizedContent.slice(start, end);
}

async function loadKnowledgeFiles(): Promise<LoadedKnowledgeFile[]> {
  const config = getAppConfig();
  const cacheKey = `${config.google.drive.knowledgeFolderId}`;

  if (cache && cache.key === cacheKey && Date.now() - cache.loadedAt < cacheTtlMs) {
    return cache.files;
  }

  const client = createClient();
  const files = await client.listFiles({
    query: `'${config.google.drive.knowledgeFolderId}' in parents and trashed=false`,
  });

  const supported = files.filter(isSupportedKnowledgeFile);
  const loaded = await Promise.all(
    supported.map(async (file) => ({
      file_id: file.id,
      name: file.name,
      web_view_url: file.webViewLink ?? `https://drive.google.com/file/d/${file.id}/view`,
      content: await client.downloadTextFile(file.id),
      modified_time: file.modifiedTime ?? "",
    })),
  );

  cache = {
    key: cacheKey,
    loadedAt: Date.now(),
    files: loaded,
  };

  return loaded;
}

function scoreKnowledgeFile(file: LoadedKnowledgeFile, tokens: string[]) {
  if (!tokens.length) {
    return 0;
  }

  const haystack = `${file.name}\n${file.content}`.toLowerCase();

  return tokens.reduce((score, token) => {
    if (!haystack.includes(token)) {
      return score;
    }

    return score + (file.name.toLowerCase().includes(token) ? 6 : 2);
  }, 0);
}

export async function selectRelevantKnowledgeFiles(input: {
  description: string;
  history?: ValuationMessage[];
}): Promise<KnowledgeSnippet[]> {
  const config = getAppConfig();

  if (!config.google.drive.knowledgeFolderId) {
    return [];
  }

  const historyText = (input.history ?? [])
    .slice(-6)
    .map((message) => message.content)
    .join("\n");
  const tokens = tokenize(`${input.description}\n${historyText}`);

  if (!tokens.length) {
    return [];
  }

  const files = await loadKnowledgeFiles();
  const scored = files
    .map((file) => ({
      file,
      score: scoreKnowledgeFile(file, tokens),
    }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score)
    .slice(0, 4);

  return scored.map(({ file }) => ({
    reference: {
      file_id: file.file_id,
      name: file.name,
      web_view_url: file.web_view_url,
    },
    excerpt: buildKnowledgeExcerpt(file.content, tokens),
  }));
}

export function buildKnowledgePromptSection(snippets: KnowledgeSnippet[]) {
  if (!snippets.length) {
    return "No matching internal knowledge files were found.";
  }

  return snippets
    .map((snippet, index) => {
      const title = normalizeText(snippet.reference.name) || `knowledge-${index + 1}`;
      return `Knowledge file ${index + 1}: ${title}\n${snippet.excerpt}`;
    })
    .join("\n\n");
}
