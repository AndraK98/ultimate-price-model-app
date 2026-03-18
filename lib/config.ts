import {
  type DashboardSnapshot,
  type DataMode,
  type ResolvedDataMode,
  type ValuationProviderName,
} from "@/lib/types";
import { hasText } from "@/lib/utils";

type LiveSetupStatus = DashboardSnapshot["liveStatus"];

type Config = {
  dataMode: DataMode;
  resolvedDataMode: ResolvedDataMode;
  goldPricePerGram: number;
  quoteMarginMultiplier: number;
  valuationProvider: ValuationProviderName;
  sheetsReady: boolean;
  geminiReady: boolean;
  liveStatus: LiveSetupStatus;
  google: {
    spreadsheetId: string;
    serviceAccountEmail: string;
    privateKey: string;
    sheets: {
      stones: string;
      settings: string;
      metalPricing: string;
      masterPopisi: string;
      inquiries: string;
      valuations: string;
    };
  };
  gemini: {
    apiKey: string;
    model: string;
  };
};

function parseDataMode(value: string | undefined): DataMode {
  if (value === "mock" || value === "sheets" || value === "auto") {
    return value;
  }

  return "auto";
}

function parseValuationProvider(value: string | undefined): ValuationProviderName {
  void value;
  return "gemini";
}

function parseNumberEnv(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizePrivateKey(value: string | undefined): string {
  return value ? value.replace(/\\n/g, "\n").trim() : "";
}

function createMissingEnv(
  google: Config["google"],
  valuationProvider: ValuationProviderName,
  geminiApiKey: string,
): string[] {
  const missing: string[] = [];

  if (!hasText(google.spreadsheetId)) {
    missing.push("GOOGLE_SPREADSHEET_ID");
  }

  if (!hasText(google.serviceAccountEmail)) {
    missing.push("GOOGLE_SERVICE_ACCOUNT_EMAIL");
  }

  if (!hasText(google.privateKey)) {
    missing.push("GOOGLE_PRIVATE_KEY");
  }

  if (valuationProvider === "gemini" && !hasText(geminiApiKey)) {
    missing.push("GEMINI_API_KEY");
  }

  return missing;
}

function createConfig(): Config {
  const dataMode = parseDataMode(process.env.DATA_MODE);
  const valuationProvider = parseValuationProvider(process.env.VALUATION_PROVIDER);
  const google = {
    spreadsheetId: process.env.GOOGLE_SPREADSHEET_ID?.trim() ?? "",
    serviceAccountEmail: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL?.trim() ?? "",
    privateKey: normalizePrivateKey(process.env.GOOGLE_PRIVATE_KEY),
    sheets: {
      stones: process.env.GOOGLE_SHEET_STONES?.trim() || "Stones",
      settings: process.env.GOOGLE_SHEET_SETTINGS?.trim() || "Settings",
      metalPricing: process.env.GOOGLE_SHEET_METAL_PRICING?.trim() || "Metal & Pricing Variables",
      masterPopisi: process.env.GOOGLE_SHEET_MASTER_POPISI?.trim() || "Master Popisi-Shopify",
      inquiries: process.env.GOOGLE_SHEET_INQUIRIES?.trim() || "Inquiries",
      valuations: process.env.GOOGLE_SHEET_VALUATIONS?.trim() || "Valuations",
    },
  };

  const sheetsReady =
    hasText(google.spreadsheetId) &&
    hasText(google.serviceAccountEmail) &&
    hasText(google.privateKey);
  const geminiApiKey = process.env.GEMINI_API_KEY?.trim() ?? "";
  const geminiReady = hasText(geminiApiKey);

  const resolvedDataMode: ResolvedDataMode =
    dataMode === "mock" ? "mock" : dataMode === "sheets" ? "sheets" : sheetsReady ? "sheets" : "mock";
  const missingEnv = createMissingEnv(google, valuationProvider, geminiApiKey);

  return {
    dataMode,
    resolvedDataMode,
    goldPricePerGram: parseNumberEnv(process.env.GOLD_PRICE_PER_GRAM, 76),
    quoteMarginMultiplier: parseNumberEnv(process.env.QUOTE_MARGIN_MULTIPLIER, 1.85),
    valuationProvider,
    sheetsReady,
    geminiReady,
    liveStatus: {
      sheetsConfigured: sheetsReady,
      geminiConfigured: geminiReady,
      catalogReadOnly: resolvedDataMode === "sheets",
      activityStorage: "local",
      spreadsheetId: google.spreadsheetId,
      sheetNames: { ...google.sheets },
      missingEnv,
    },
    google,
    gemini: {
      apiKey: geminiApiKey,
      model: process.env.GEMINI_MODEL?.trim() || "gemini-2.5-pro",
    },
  };
}

const appConfig = createConfig();

export function getAppConfig(): Config {
  return appConfig;
}

export function getLiveSetupStatus(): LiveSetupStatus {
  return appConfig.liveStatus;
}
