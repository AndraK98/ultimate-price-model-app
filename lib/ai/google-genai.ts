import { GoogleGenAI } from "@google/genai";

type GroundingCandidate = {
  groundingMetadata?: {
    webSearchQueries?: string[];
    groundingChunks?: Array<{
      web?: {
        uri?: string;
        title?: string;
      };
    }>;
  };
};

type GenerateContentLikeResponse = {
  text?: string;
  candidates?: GroundingCandidate[];
};

const GEMINI_FALLBACK_MODEL = "gemini-2.5-flash";

const clients = new Map<string, GoogleGenAI>();

export function getGoogleGenAI(apiKey: string): GoogleGenAI {
  const existing = clients.get(apiKey);

  if (existing) {
    return existing;
  }

  const client = new GoogleGenAI({ apiKey });
  clients.set(apiKey, client);
  return client;
}

function uniqueModels(primaryModel: string): string[] {
  return Array.from(new Set([primaryModel.trim(), GEMINI_FALLBACK_MODEL].filter(Boolean)));
}

export async function runWithGeminiModelFallback<T>(
  apiKey: string,
  primaryModel: string,
  runner: (client: GoogleGenAI, model: string) => Promise<T>,
): Promise<T> {
  const client = getGoogleGenAI(apiKey);
  const models = uniqueModels(primaryModel);
  const errors: string[] = [];

  for (const model of models) {
    try {
      return await runner(client, model);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push(`${model}: ${message}`);
    }
  }

  throw new Error(`Gemini failed for all configured models. ${errors.join(" | ")}`);
}

export function extractGrounding(response: GenerateContentLikeResponse): {
  searchQueries: string[];
  sources: Array<{ title: string; uri: string }>;
} {
  const candidate = response.candidates?.[0];
  const queries = Array.from(new Set(candidate?.groundingMetadata?.webSearchQueries?.filter(Boolean) ?? []));
  const sources = Array.from(
    new Map(
      (candidate?.groundingMetadata?.groundingChunks ?? [])
        .map((chunk) => ({
          title: chunk.web?.title?.trim() ?? "",
          uri: chunk.web?.uri?.trim() ?? "",
        }))
        .filter((source) => source.title && source.uri)
        .map((source) => [source.uri, source]),
    ).values(),
  );

  return {
    searchQueries: queries,
    sources,
  };
}
