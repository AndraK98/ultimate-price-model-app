import { getAppConfig } from "@/lib/config";
import { matchesSettingFilters, matchesStoneFilters } from "@/lib/catalog-search";
import { mutateActivityDatabase, readActivityDatabase } from "@/lib/data/activity-store";
import { type AppRepository } from "@/lib/repositories/contracts";
import { GoogleSheetsClient } from "@/lib/repositories/google-sheets-client";
import {
  type Inquiry,
  type PricingDefaults,
  type ProductComposition,
  type ProductCompositionStoneLine,
  type ProductCompositionVariant,
  type Setting,
  type SettingFilters,
  type Stone,
  type StoneFilters,
  type ValuationRecord,
} from "@/lib/types";
import {
  columnFromIndex,
  extractShopifyProductHandle,
  normalizeDigits,
  normalizeHeader,
  normalizeText,
  parseNumber,
  parseStoneSizeRange,
} from "@/lib/utils";

const stoneHeaders = [
  "stone_id",
  "name",
  "shape",
  "color",
  "carat",
  "min_size_mm",
  "max_size_mm",
  "quality",
  "price_per_carat",
  "status",
  "notes",
  "created_by",
  "created_at",
] as const;

const settingHeaders = [
  "setting_id",
  "style",
  "metal",
  "ring_size",
  "dimensions_mm",
  "complexity_level",
  "gold_weight_g",
  "labor_cost",
  "base_price",
  "stone_capacity",
  "status",
  "created_by",
  "created_at",
] as const;

type HeaderKeys = Record<string, number>;
type HeaderMatch = { index: number; headerMap: HeaderKeys };
type CatalogCache<T> = { loadedAt: number; items: T[] } | null;
type PricingDefaultsCache = { loadedAt: number; item: PricingDefaults } | null;
type SheetRowsCache = { loadedAt: number; rows: string[][] } | null;
const catalogCacheTtlMs = 60_000;
const legacySettingWeightHeaders = [
  "Gold 999 / Platinum 950/ Silver 999 - metal loss 7% included",
  "Gold 999",
] as const;

function findHeaderRow(values: string[][], requiredHeaders: string[]): HeaderMatch | null {
  for (let rowIndex = 0; rowIndex < Math.min(values.length, 10); rowIndex += 1) {
    const row = values[rowIndex] ?? [];
    const normalized = row.map((value) => normalizeHeader(value));

    if (requiredHeaders.every((header) => normalized.includes(normalizeHeader(header)))) {
      return {
        index: rowIndex,
        headerMap: Object.fromEntries(normalized.map((value, index) => [value, index])),
      };
    }
  }

  return null;
}

function cell(row: string[], headerMap: HeaderKeys, key: string): string {
  const index = headerMap[normalizeHeader(key)];
  return index === undefined ? "" : row[index] ?? "";
}

function toStringRow(record: unknown, headers: readonly string[]): string[] {
  const source = record as Record<string, string | number | undefined>;
  return headers.map((header) => {
    const value = source[header];
    return typeof value === "number" ? String(value) : value ?? "";
  });
}

function createMappedRow(headerMap: HeaderKeys, assignments: Record<string, string | number>): string[] {
  const width = Math.max(...Object.values(headerMap), 0) + 1;
  const row = Array.from({ length: width }, () => "");

  for (const [header, value] of Object.entries(assignments)) {
    const index = headerMap[normalizeHeader(header)];
    if (index !== undefined) {
      row[index] = typeof value === "number" ? String(value) : value;
    }
  }

  return row;
}

function adjacentCell(row: string[], headerMap: HeaderKeys, key: string, offset = 1): string {
  const index = headerMap[normalizeHeader(key)];
  return index === undefined ? "" : row[index + offset] ?? "";
}

function isUrlLike(value: string): boolean {
  return /^https?:\/\//i.test(value.trim());
}

function titleizeSlug(value: string): string {
  return value
    .trim()
    .replace(/^https?:\/\/[^/]+\/products\//i, "")
    .replace(/[?#].*$/, "")
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function resolveLegacySettingStyle(row: string[], headerMap: HeaderKeys): string {
  const style = cell(row, headerMap, "Setting Name").trim();

  if (style && !isUrlLike(style)) {
    return style;
  }

  const handle = adjacentCell(row, headerMap, "URL").trim();
  if (handle) {
    return titleizeSlug(handle);
  }

  const url = cell(row, headerMap, "URL").trim();
  if (url) {
    return titleizeSlug(url);
  }

  return cell(row, headerMap, "Setting Master SKU");
}

function extractMasterPopisiSettingSkus(value: string): string[] {
  return Array.from(
    new Set(
      (value.match(/\bSRY4[A-Z0-9_-]*\b/gi) ?? [])
        .map((sku) => sku.trim().toUpperCase())
        .filter(Boolean),
    ),
  );
}

function resolveProductReference(reference: string): {
  raw: string;
  normalizedId: string;
  normalizedHandle: string;
  matchedBy: ProductComposition["matched_by"];
} {
  const raw = reference.trim();
  const normalizedId = normalizeDigits(raw);
  const normalizedHandle = extractShopifyProductHandle(raw);

  return {
    raw,
    normalizedId,
    normalizedHandle,
    matchedBy: /^https?:\/\//i.test(raw) ? "url" : normalizedId ? "id" : "handle",
  };
}

function buildVariantKey(parts: Array<string | undefined>) {
  const normalized = parts.map((part) => part?.trim()).filter(Boolean);
  return normalized.join("::") || crypto.randomUUID();
}

function createProductStoneLine(args: {
  stoneId: string;
  quantity: number;
  role: "main" | "accent";
  stone: Stone | null;
  label: string;
  shape: string;
  cut: string;
  quality: string;
  color: string;
  measurements: string;
}): ProductCompositionStoneLine {
  return {
    stone_id: args.stoneId,
    quantity: args.quantity,
    role: args.role,
    stone: args.stone,
    label: args.label,
    shape: args.shape,
    cut: args.cut,
    quality: args.quality,
    color: args.color,
    measurements: args.measurements,
  };
}

function valueAtColumn(row: string[], columnIndex: number): string {
  return row[columnIndex] ?? "";
}

function resolveLegacySettingPrice(row: string[], headerMap: HeaderKeys): number {
  return parseNumber(
    cell(row, headerMap, "Setting Price ($USD)") ||
      cell(row, headerMap, "B2C Setting Price with all overheads ($USD)") ||
      cell(row, headerMap, "Setting Price") ||
      valueAtColumn(row, 13),
  );
}

function to18kCounterpartSku(settingId: string): string | undefined {
  const normalizedSettingId = settingId.trim().toUpperCase();

  if (!normalizedSettingId) {
    return undefined;
  }

  if (normalizedSettingId.includes("RY4")) {
    return normalizedSettingId.replace("RY4", "RY8");
  }

  return undefined;
}

function enrich18kCounterparts(settings: Setting[]): Setting[] {
  const byId = new Map(settings.map((setting) => [setting.setting_id.trim().toUpperCase(), setting]));

  return settings.map((setting) => {
    if ((setting.quote_18k_price ?? 0) > 0) {
      return setting;
    }

    const counterpartSku = to18kCounterpartSku(setting.setting_id);

    if (!counterpartSku) {
      return setting;
    }

    const counterpart = byId.get(counterpartSku);

    if (!counterpart || counterpart.setting_id === setting.setting_id) {
      return setting;
    }

    return {
      ...setting,
      quote_18k_setting_id: counterpart.setting_id,
      quote_18k_price: counterpart.base_price,
      quote_18k_gold_weight_g: counterpart.gold_weight_g,
    };
  });
}

export class SheetsRepository implements AppRepository {
  mode = "sheets" as const;

  private readonly config = getAppConfig();
  private readonly client = new GoogleSheetsClient({
    spreadsheetId: this.config.google.spreadsheetId,
    serviceAccountEmail: this.config.google.serviceAccountEmail,
    privateKey: this.config.google.privateKey,
  });
  private stoneCache: CatalogCache<Stone> = null;
  private settingCache: CatalogCache<Setting> = null;
  private pricingDefaultsCache: PricingDefaultsCache = null;
  private masterPopisiCache: SheetRowsCache = null;

  private async ensureCanonicalTab(
    sheetName: string,
    headers: readonly string[],
    options?: { createIfMissing?: boolean },
  ): Promise<void> {
    if (options?.createIfMissing) {
      await this.client.ensureSheetExists(sheetName);
    }

    const rows = await this.client.getRows(sheetName);

    if (rows.length === 0) {
      const lastColumn = columnFromIndex(headers.length - 1);
      await this.client.updateRows(`${sheetName}!A1:${lastColumn}1`, [Array.from(headers)]);
      return;
    }

    const firstRow = rows[0] ?? [];
    const normalizedHeader = firstRow.map((value) => normalizeHeader(value));
    const isCanonical = headers.every((header) => normalizedHeader.includes(normalizeHeader(header)));

    if (!isCanonical) {
      throw new Error(
        `Sheet "${sheetName}" is not using the canonical app headers. Create a dedicated app tab or point the env var to one that starts with: ${headers.join(", ")}.`,
      );
    }
  }

  private detectStoneLayout(values: string[][]): { kind: "canonical" | "legacy" | "empty" | "unknown"; match?: HeaderMatch } {
    if (values.length === 0) {
      return { kind: "empty" };
    }

    const canonical = findHeaderRow(values, Array.from(stoneHeaders));
    if (canonical) {
      return { kind: "canonical", match: canonical };
    }

    const legacy = findHeaderRow(values, [
      "SKU",
      "Type",
      "Shape",
      "Color",
      "NEW Size (mm)",
      "Weight per Piece (ct)",
      "Price per Carat ($USD)",
    ]);

    if (legacy) {
      return { kind: "legacy", match: legacy };
    }

    return { kind: "unknown" };
  }

  private detectSettingLayout(values: string[][]): { kind: "canonical" | "legacy" | "empty" | "unknown"; match?: HeaderMatch } {
    if (values.length === 0) {
      return { kind: "empty" };
    }

    const canonical = findHeaderRow(values, Array.from(settingHeaders));
    if (canonical) {
      return { kind: "canonical", match: canonical };
    }

    const legacy =
      findHeaderRow(values, [
        "Setting Master SKU",
        "Setting Name",
        "Setting Material",
        legacySettingWeightHeaders[0],
        "B2c labor, OH, MA, packing, shipping",
      ]) ??
      findHeaderRow(values, [
        "Setting Master SKU",
        "Setting Name",
        "Setting Material",
        legacySettingWeightHeaders[1],
        "B2c labor, OH, MA, packing, shipping",
      ]);

    if (legacy) {
      return { kind: "legacy", match: legacy };
    }

    return { kind: "unknown" };
  }

  private parseStoneRows(values: string[][]): Stone[] {
    const canonical = findHeaderRow(values, Array.from(stoneHeaders));
    if (canonical) {
      return values
        .slice(canonical.index + 1)
        .filter((row) => row.length > 0 && cell(row, canonical.headerMap, "stone_id"))
        .map((row) => ({
          stone_id: cell(row, canonical.headerMap, "stone_id"),
          name: cell(row, canonical.headerMap, "name"),
          shape: cell(row, canonical.headerMap, "shape"),
          color: cell(row, canonical.headerMap, "color"),
          carat: parseNumber(cell(row, canonical.headerMap, "carat")),
          min_size_mm: parseNumber(cell(row, canonical.headerMap, "min_size_mm")),
          max_size_mm: parseNumber(cell(row, canonical.headerMap, "max_size_mm")),
          quality: cell(row, canonical.headerMap, "quality"),
          price_per_carat: parseNumber(cell(row, canonical.headerMap, "price_per_carat")),
          final_price: parseNumber(
            cell(row, canonical.headerMap, "final_price"),
            parseNumber(cell(row, canonical.headerMap, "carat")) * parseNumber(cell(row, canonical.headerMap, "price_per_carat")),
          ),
          status: cell(row, canonical.headerMap, "status") || "active",
          notes: cell(row, canonical.headerMap, "notes"),
          created_by: cell(row, canonical.headerMap, "created_by") || "sheet-import",
          created_at: cell(row, canonical.headerMap, "created_at") || "",
        }));
    }

    const legacy = findHeaderRow(values, [
      "SKU",
      "Type",
      "Shape",
      "Color",
      "NEW Size (mm)",
      "Weight per Piece (ct)",
      "Price per Carat ($USD)",
    ]);

    if (!legacy) {
      return [];
    }

    return values
      .slice(legacy.index + 1)
      .filter((row) => row.length > 0 && cell(row, legacy.headerMap, "SKU"))
      .map((row) => {
        const oldSize = parseStoneSizeRange(cell(row, legacy.headerMap, "OLD Size (mm)"));
        const newSize = parseStoneSizeRange(cell(row, legacy.headerMap, "NEW Size (mm)"));

        return {
          stone_id: cell(row, legacy.headerMap, "SKU"),
          name: cell(row, legacy.headerMap, "Type"),
          shape: cell(row, legacy.headerMap, "Shape"),
          color: cell(row, legacy.headerMap, "Color"),
          carat: parseNumber(cell(row, legacy.headerMap, "Weight per Piece (ct)")),
          min_size_mm: oldSize.min || newSize.min,
          max_size_mm: newSize.max || newSize.min || oldSize.max || oldSize.min,
          quality: cell(row, legacy.headerMap, "Cut"),
          price_per_carat: parseNumber(cell(row, legacy.headerMap, "Price per Carat ($USD)")),
          final_price: parseNumber(
            cell(row, legacy.headerMap, "Final Stone Price ($USD)"),
            parseNumber(cell(row, legacy.headerMap, "Weight per Piece (ct)")) *
              parseNumber(cell(row, legacy.headerMap, "Price per Carat ($USD)")),
          ),
          status: "active",
          notes: [cell(row, legacy.headerMap, "Remarks"), cell(row, legacy.headerMap, "Notes")].filter(Boolean).join(" | "),
          created_by: "sheet-import",
          created_at: "",
        };
      });
  }

  private parseSettingRows(values: string[][]): Setting[] {
    const canonical = findHeaderRow(values, Array.from(settingHeaders));
    if (canonical) {
      return enrich18kCounterparts(
        values
          .slice(canonical.index + 1)
          .filter((row) => row.length > 0 && cell(row, canonical.headerMap, "setting_id"))
          .map((row) => ({
            setting_id: cell(row, canonical.headerMap, "setting_id"),
            style: cell(row, canonical.headerMap, "style"),
            metal: cell(row, canonical.headerMap, "metal"),
            ring_size: cell(row, canonical.headerMap, "ring_size"),
            dimensions_mm: cell(row, canonical.headerMap, "dimensions_mm"),
            complexity_level: parseNumber(cell(row, canonical.headerMap, "complexity_level")),
            gold_weight_g: parseNumber(cell(row, canonical.headerMap, "gold_weight_g")),
            labor_cost: parseNumber(cell(row, canonical.headerMap, "labor_cost")),
            base_price: parseNumber(cell(row, canonical.headerMap, "base_price")),
            quote_18k_setting_id: cell(row, canonical.headerMap, "quote_18k_setting_id") || undefined,
            quote_18k_price: parseNumber(cell(row, canonical.headerMap, "quote_18k_price"), 0) || undefined,
            quote_18k_gold_weight_g: parseNumber(cell(row, canonical.headerMap, "quote_18k_gold_weight_g"), 0) || undefined,
            stone_capacity: cell(row, canonical.headerMap, "stone_capacity"),
            status: cell(row, canonical.headerMap, "status") || "active",
            created_by: cell(row, canonical.headerMap, "created_by") || "sheet-import",
            created_at: cell(row, canonical.headerMap, "created_at") || "",
          })),
      );
    }

    const legacy =
      findHeaderRow(values, [
        "Setting Master SKU",
        "Setting Name",
        "Setting Material",
        legacySettingWeightHeaders[0],
        "B2c labor, OH, MA, packing, shipping",
      ]) ??
      findHeaderRow(values, [
        "Setting Master SKU",
        "Setting Name",
        "Setting Material",
        legacySettingWeightHeaders[1],
        "B2c labor, OH, MA, packing, shipping",
      ]);

    if (!legacy) {
      return [];
    }

    return enrich18kCounterparts(
      values
      .slice(legacy.index + 1)
      .filter((row) => row.length > 0 && cell(row, legacy.headerMap, "Setting Master SKU"))
      .map((row) => ({
        setting_id: cell(row, legacy.headerMap, "Setting Master SKU"),
        style: resolveLegacySettingStyle(row, legacy.headerMap),
        metal: cell(row, legacy.headerMap, "Setting Material"),
        ring_size: "",
        dimensions_mm: "",
        complexity_level: parseNumber(
          cell(row, legacy.headerMap, "Complexity Level") ||
            cell(row, legacy.headerMap, "Complexity") ||
            adjacentCell(row, legacy.headerMap, "Setting Master SKU"),
        ),
        gold_weight_g: parseNumber(
          cell(row, legacy.headerMap, legacySettingWeightHeaders[0]) || cell(row, legacy.headerMap, legacySettingWeightHeaders[1]),
        ),
        labor_cost: parseNumber(cell(row, legacy.headerMap, "B2c labor, OH, MA, packing, shipping")),
        base_price: resolveLegacySettingPrice(row, legacy.headerMap),
        quote_18k_setting_id: undefined,
        quote_18k_price: undefined,
        quote_18k_gold_weight_g: undefined,
        stone_capacity: "",
        status: "active",
        created_by: "sheet-import",
        created_at: "",
      })),
    );
  }

  private parseInquiryRows(values: string[][]): Inquiry[] {
    const canonical = findHeaderRow(values, ["inquiry_id", "customer_name", "estimated_material_cost", "estimated_quote"]);
    if (!canonical) {
      return [];
    }

    return values
      .slice(canonical.index + 1)
      .filter((row) => row.length > 0 && cell(row, canonical.headerMap, "inquiry_id"))
      .map((row) => ({
        inquiry_id: cell(row, canonical.headerMap, "inquiry_id"),
        customer_name: cell(row, canonical.headerMap, "customer_name"),
        stone_id: cell(row, canonical.headerMap, "stone_id"),
        setting_id: cell(row, canonical.headerMap, "setting_id"),
        custom_stone_text: cell(row, canonical.headerMap, "custom_stone_text"),
        custom_setting_text: cell(row, canonical.headerMap, "custom_setting_text"),
        target_size_mm: parseNumber(cell(row, canonical.headerMap, "target_size_mm")),
        target_gold_weight_g: parseNumber(cell(row, canonical.headerMap, "target_gold_weight_g")),
        manual_stone_estimate: parseNumber(cell(row, canonical.headerMap, "manual_stone_estimate")),
        manual_setting_estimate: parseNumber(cell(row, canonical.headerMap, "manual_setting_estimate")),
        estimated_material_cost: parseNumber(cell(row, canonical.headerMap, "estimated_material_cost")),
        estimated_quote: parseNumber(cell(row, canonical.headerMap, "estimated_quote")),
        status: cell(row, canonical.headerMap, "status") || "open",
        reference_image_url: cell(row, canonical.headerMap, "reference_image_url"),
        created_by: cell(row, canonical.headerMap, "created_by") || "sheet-import",
        created_at: cell(row, canonical.headerMap, "created_at") || "",
      }));
  }

  private parseValuationRows(values: string[][]): ValuationRecord[] {
    const canonical = findHeaderRow(values, ["valuation_id", "description", "metal", "estimated_value_low", "estimated_value_high"]);
    if (!canonical) {
      return [];
    }

    return values
      .slice(canonical.index + 1)
      .filter((row) => row.length > 0 && cell(row, canonical.headerMap, "valuation_id"))
      .map((row) => ({
        valuation_id: cell(row, canonical.headerMap, "valuation_id"),
        valuation_target:
          cell(row, canonical.headerMap, "valuation_target") === "stone"
            ? "stone"
            : cell(row, canonical.headerMap, "valuation_target") === "setting"
              ? "setting"
              : "piece",
        description: cell(row, canonical.headerMap, "description"),
        stone_type: cell(row, canonical.headerMap, "stone_type"),
        stone_shape: cell(row, canonical.headerMap, "stone_shape"),
        stone_cut: cell(row, canonical.headerMap, "stone_cut"),
        setting_style: cell(row, canonical.headerMap, "setting_style"),
        metal: cell(row, canonical.headerMap, "metal"),
        carat: parseNumber(cell(row, canonical.headerMap, "carat")),
        complexity_level: parseNumber(cell(row, canonical.headerMap, "complexity_level")),
        gold_weight_g: parseNumber(cell(row, canonical.headerMap, "gold_weight_g")),
        notes: cell(row, canonical.headerMap, "notes"),
        image_data_url: cell(row, canonical.headerMap, "image_data_url"),
        reference_image_url: cell(row, canonical.headerMap, "reference_image_url"),
        estimated_value_low: parseNumber(cell(row, canonical.headerMap, "estimated_value_low")),
        estimated_value_high: parseNumber(cell(row, canonical.headerMap, "estimated_value_high")),
        estimated_stone_total: parseNumber(cell(row, canonical.headerMap, "estimated_stone_total")),
        estimated_setting_total: parseNumber(cell(row, canonical.headerMap, "estimated_setting_total")),
        inferred_complexity_multiplier: parseNumber(cell(row, canonical.headerMap, "inferred_complexity_multiplier")),
        estimated_formula_total: parseNumber(cell(row, canonical.headerMap, "estimated_formula_total")),
        pricing_summary: cell(row, canonical.headerMap, "pricing_summary") || "No pricing summary logged.",
        reasoning: cell(row, canonical.headerMap, "reasoning"),
        recommended_next_step: cell(row, canonical.headerMap, "recommended_next_step"),
        matched_catalog_stone_id: cell(row, canonical.headerMap, "matched_catalog_stone_id"),
        matched_catalog_setting_id: cell(row, canonical.headerMap, "matched_catalog_setting_id"),
        inferred_valuation_target:
          cell(row, canonical.headerMap, "inferred_valuation_target") === "stone"
            ? "stone"
            : cell(row, canonical.headerMap, "inferred_valuation_target") === "setting"
              ? "setting"
              : cell(row, canonical.headerMap, "valuation_target") === "stone"
                ? "stone"
                : cell(row, canonical.headerMap, "valuation_target") === "setting"
                  ? "setting"
                  : "piece",
        inferred_stone_type: cell(row, canonical.headerMap, "inferred_stone_type") || cell(row, canonical.headerMap, "stone_type"),
        inferred_stone_shape: cell(row, canonical.headerMap, "inferred_stone_shape") || cell(row, canonical.headerMap, "stone_shape"),
        inferred_stone_cut: cell(row, canonical.headerMap, "inferred_stone_cut") || cell(row, canonical.headerMap, "stone_cut"),
        inferred_setting_style:
          cell(row, canonical.headerMap, "inferred_setting_style") || cell(row, canonical.headerMap, "setting_style"),
        inferred_metal: cell(row, canonical.headerMap, "inferred_metal") || cell(row, canonical.headerMap, "metal"),
        inferred_carat: parseNumber(cell(row, canonical.headerMap, "inferred_carat"), parseNumber(cell(row, canonical.headerMap, "carat"))),
        inferred_complexity_level: parseNumber(
          cell(row, canonical.headerMap, "inferred_complexity_level"),
          parseNumber(cell(row, canonical.headerMap, "complexity_level")),
        ),
        inferred_gold_weight_g: parseNumber(
          cell(row, canonical.headerMap, "inferred_gold_weight_g"),
          parseNumber(cell(row, canonical.headerMap, "gold_weight_g")),
        ),
        grounding_search_queries: [],
        grounding_sources: [],
        referenced_knowledge_files: [],
        provider: "gemini",
        created_by: cell(row, canonical.headerMap, "created_by") || "sheet-import",
        created_at: cell(row, canonical.headerMap, "created_at") || "",
        updated_at: cell(row, canonical.headerMap, "updated_at") || cell(row, canonical.headerMap, "created_at") || "",
        messages: [],
      }));
  }

  private isFresh<T>(cache: CatalogCache<T>): cache is { loadedAt: number; items: T[] } {
    return Boolean(cache && Date.now() - cache.loadedAt < catalogCacheTtlMs);
  }

  private isFreshSheetRows(cache: SheetRowsCache): cache is { loadedAt: number; rows: string[][] } {
    return Boolean(cache && Date.now() - cache.loadedAt < catalogCacheTtlMs);
  }

  private async getCachedStones(): Promise<Stone[]> {
    if (this.isFresh(this.stoneCache)) {
      return this.stoneCache.items;
    }

    const values = await this.client.getRows(this.config.google.sheets.stones);
    const items = this.parseStoneRows(values).sort((left, right) => right.created_at.localeCompare(left.created_at));
    this.stoneCache = {
      loadedAt: Date.now(),
      items,
    };
    return items;
  }

  private async getCachedSettings(): Promise<Setting[]> {
    if (this.isFresh(this.settingCache)) {
      return this.settingCache.items;
    }

    const values = await this.client.getRows(this.config.google.sheets.settings);
    const items = this.parseSettingRows(values).sort((left, right) => right.created_at.localeCompare(left.created_at));
    this.settingCache = {
      loadedAt: Date.now(),
      items,
    };
    return items;
  }

  private async getCachedPricingDefaults(): Promise<PricingDefaults> {
    if (this.pricingDefaultsCache && Date.now() - this.pricingDefaultsCache.loadedAt < catalogCacheTtlMs) {
      return this.pricingDefaultsCache.item;
    }

    let item: PricingDefaults;

    try {
      const values = await this.client.getSheetRange(this.config.google.sheets.metalPricing, "B18:B20");
      item = {
        metalPrices: {
          gold: parseNumber(values[0]?.[0], this.config.goldPricePerGram),
          silver: parseNumber(values[1]?.[0], this.config.goldPricePerGram),
          platinum: parseNumber(values[2]?.[0], this.config.goldPricePerGram),
        },
        metalPricingSource: "sheet",
      };
    } catch {
      item = {
        metalPrices: {
          gold: this.config.goldPricePerGram,
          silver: this.config.goldPricePerGram,
          platinum: this.config.goldPricePerGram,
        },
        metalPricingSource: "env",
      };
    }

    this.pricingDefaultsCache = {
      loadedAt: Date.now(),
      item,
    };

    return item;
  }

  private async getCachedMasterPopisiRows(): Promise<string[][]> {
    if (this.isFreshSheetRows(this.masterPopisiCache)) {
      return this.masterPopisiCache.rows;
    }

    const rows = await this.client.getRows(this.config.google.sheets.masterPopisi);
    this.masterPopisiCache = {
      loadedAt: Date.now(),
      rows,
    };
    return rows;
  }

  async listStones(filters?: StoneFilters): Promise<Stone[]> {
    return (await this.getCachedStones())
      .filter((stone) => matchesStoneFilters(stone, filters));
  }

  async createStone(stone: Stone): Promise<Stone> {
    if (this.mode === "sheets") {
      void stone;
      throw new Error("Stone catalog is read-only in Sheets mode. Update the source Google Sheet instead of writing through the app.");
    }

    const sheetName = this.config.google.sheets.stones;
    const rows = await this.client.getRows(sheetName);
    const layout = this.detectStoneLayout(rows);

    if (layout.kind === "empty") {
      await this.ensureCanonicalTab(sheetName, stoneHeaders);
      await this.client.appendRows(`${sheetName}!A:${columnFromIndex(stoneHeaders.length - 1)}`, [toStringRow(stone, stoneHeaders)]);
      this.stoneCache = null;
      return stone;
    }

    if (layout.kind === "canonical") {
      await this.client.appendRows(`${sheetName}!A:${columnFromIndex(stoneHeaders.length - 1)}`, [toStringRow(stone, stoneHeaders)]);
      this.stoneCache = null;
      return stone;
    }

    if (layout.kind === "legacy" && layout.match) {
      const note = [stone.notes, `status:${stone.status}`, `created_by:${stone.created_by}`, `created_at:${stone.created_at}`]
        .filter(Boolean)
        .join(" | ");
      const finalStonePrice = stone.final_price || stone.carat * stone.price_per_carat;
      const row = createMappedRow(layout.match.headerMap, {
        SKU: stone.stone_id,
        Type: stone.name,
        Shape: stone.shape,
        Cut: stone.quality,
        Color: stone.color,
        "OLD Size (mm)": stone.min_size_mm,
        "NEW Size (mm)": stone.max_size_mm || stone.min_size_mm,
        "Weight per Piece (ct)": stone.carat,
        "Price per Carat ($USD)": stone.price_per_carat,
        "Stone Price ($USD)": stone.carat * stone.price_per_carat,
        Multiplicator: 1,
        "Final Stone Price ($USD)": finalStonePrice,
        Remarks: stone.notes,
        Notes: note,
      });
      await this.client.appendRows(`${sheetName}!A:${columnFromIndex(row.length - 1)}`, [row]);
      this.stoneCache = null;
      return stone;
    }

    throw new Error(
      `Sheet "${sheetName}" is not using a supported stone layout. Use either the canonical app headers or the legacy Capucinne Stones layout.`,
    );
  }

  async findStoneById(stoneId: string): Promise<Stone | null> {
    const stones = await this.getCachedStones();
    return stones.find((stone) => stone.stone_id === stoneId) ?? null;
  }

  async listSettings(filters?: SettingFilters): Promise<Setting[]> {
    return (await this.getCachedSettings())
      .filter((setting) => !setting.setting_id.trim().toUpperCase().startsWith("SRY8"))
      .filter((setting) => matchesSettingFilters(setting, filters));
  }

  async createSetting(setting: Setting): Promise<Setting> {
    if (this.mode === "sheets") {
      void setting;
      throw new Error(
        "Setting catalog is read-only in Sheets mode. Update the source Google Sheet instead of writing through the app.",
      );
    }

    const sheetName = this.config.google.sheets.settings;
    const rows = await this.client.getRows(sheetName);
    const layout = this.detectSettingLayout(rows);

    if (layout.kind === "empty") {
      await this.ensureCanonicalTab(sheetName, settingHeaders);
      await this.client.appendRows(`${sheetName}!A:${columnFromIndex(settingHeaders.length - 1)}`, [
        toStringRow(setting, settingHeaders),
      ]);
      this.settingCache = null;
      return setting;
    }

    if (layout.kind === "canonical") {
      await this.client.appendRows(`${sheetName}!A:${columnFromIndex(settingHeaders.length - 1)}`, [
        toStringRow(setting, settingHeaders),
      ]);
      this.settingCache = null;
      return setting;
    }

    if (layout.kind === "legacy" && layout.match) {
      const row = createMappedRow(layout.match.headerMap, {
        "Setting Name": setting.style,
        "Setting Master SKU": setting.setting_id,
        "Setting Material": setting.metal,
        "Gold 999": setting.gold_weight_g,
        "Gold 999 / Platinum 950/ Silver 999 - metal loss 7% included": setting.gold_weight_g,
        "B2c labor, OH, MA, packing, shipping": setting.labor_cost,
        "Material Cost and overheads ($USD) - B2C": setting.base_price,
        URL: "",
      });
      await this.client.appendRows(`${sheetName}!A:${columnFromIndex(row.length - 1)}`, [row]);
      this.settingCache = null;
      return setting;
    }

    throw new Error(
      `Sheet "${sheetName}" is not using a supported setting layout. Use either the canonical app headers or the legacy Capucinne setting layout.`,
    );
  }

  async findSettingById(settingId: string): Promise<Setting | null> {
    const settings = await this.getCachedSettings();
    return settings.find((setting) => setting.setting_id === settingId) ?? null;
  }

  async findSettingSkusByProductId(productId: string): Promise<string[]> {
    const normalizedProductId = normalizeText(productId);

    if (!normalizedProductId) {
      return [];
    }

    const rows = await this.getCachedMasterPopisiRows();
    const headerMatch = findHeaderRow(rows, ["ID", "SKU Setting"]);
    const dataRows = headerMatch ? rows.slice(headerMatch.index + 1) : rows;
    const idColumnIndex = headerMatch?.headerMap[normalizeHeader("ID")] ?? 0;
    const skuColumnIndex = headerMatch?.headerMap[normalizeHeader("SKU Setting")] ?? 24;
    const matchedSkus = new Set<string>();

    for (const row of dataRows) {
      if (normalizeText(row[idColumnIndex] ?? "") !== normalizedProductId) {
        continue;
      }

      for (const sku of extractMasterPopisiSettingSkus(row[skuColumnIndex] ?? "")) {
        matchedSkus.add(sku);
      }
    }

    return Array.from(matchedSkus);
  }

  async findProductComposition(reference: string): Promise<ProductComposition | null> {
    const resolvedReference = resolveProductReference(reference);

    if (!resolvedReference.raw) {
      return null;
    }

    const rows = await this.getCachedMasterPopisiRows();
    const headerMatch = findHeaderRow(rows, ["ID", "Product Handle", "Title", "Description", "SKU Setting"]);

    if (!headerMatch) {
      return null;
    }

    const dataRows = rows.slice(headerMatch.index + 1);
    const productIdColumnIndex = headerMatch.headerMap[normalizeHeader("ID")] ?? 0;
    const productHandleColumnIndex = headerMatch.headerMap[normalizeHeader("Product Handle")] ?? 1;
    const titleColumnIndex = headerMatch.headerMap[normalizeHeader("Title")] ?? 2;
    const descriptionColumnIndex = headerMatch.headerMap[normalizeHeader("Description")] ?? 3;
    const variantSkuColumnIndex = headerMatch.headerMap[normalizeHeader("Variant SKU")] ?? 26;
    const ringSetSkuColumnIndex = headerMatch.headerMap[normalizeHeader("Ring set SKU")] ?? 27;
    const setSkuFixColumnIndex = headerMatch.headerMap[normalizeHeader("Set SKU fix")] ?? 28;

    const matchingRows = dataRows.filter((row) => {
      const rowId = normalizeDigits(row[productIdColumnIndex] ?? "");
      const rowHandle = normalizeText(row[productHandleColumnIndex] ?? "");

      return (
        Boolean(resolvedReference.normalizedId && rowId === resolvedReference.normalizedId) ||
        Boolean(resolvedReference.normalizedHandle && rowHandle === resolvedReference.normalizedHandle)
      );
    });

    if (!matchingRows.length) {
      return null;
    }

    const [stones, settings] = await Promise.all([this.getCachedStones(), this.getCachedSettings()]);
    const stonesById = new Map(stones.map((stone) => [stone.stone_id.trim().toUpperCase(), stone]));
    const settingsById = new Map(settings.map((setting) => [setting.setting_id.trim().toUpperCase(), setting]));
    const variants = new Map<
      string,
      ProductCompositionVariant & {
        stoneLineIndex: Map<string, number>;
      }
    >();

    for (const row of matchingRows) {
      const settingIds = extractMasterPopisiSettingSkus(valueAtColumn(row, 24));
      const variantSku = valueAtColumn(row, variantSkuColumnIndex).trim();
      const ringSetSku = valueAtColumn(row, ringSetSkuColumnIndex).trim();
      const setSkuFix = valueAtColumn(row, setSkuFixColumnIndex).trim();
      const metal = valueAtColumn(row, 22).trim();
      const bandSize = valueAtColumn(row, 20).trim();
      const settingStyle = valueAtColumn(row, 21).trim();
      const additionalDescription = valueAtColumn(row, 23).trim();
      const variantKey = buildVariantKey([variantSku, ringSetSku || setSkuFix, settingIds.join("|"), metal, bandSize]);

      let variant = variants.get(variantKey);

      if (!variant) {
        variant = {
          variant_key: variantKey,
          variant_sku: variantSku,
          ring_set_sku: ringSetSku,
          set_sku_fix: setSkuFix,
          metal,
          band_size: bandSize,
          setting_style: settingStyle,
          additional_description: additionalDescription,
          setting_ids: [],
          settings: [],
          stones: [],
          source_row_count: 0,
          stoneLineIndex: new Map<string, number>(),
        };
        variants.set(variantKey, variant);
      }

      variant.source_row_count += 1;

      for (const settingId of settingIds) {
        if (variant.setting_ids.includes(settingId)) {
          continue;
        }

        variant.setting_ids.push(settingId);

        const setting = settingsById.get(settingId);
        if (setting) {
          variant.settings.push(setting);
        }
      }

      const appendStoneLine = (line: ProductCompositionStoneLine) => {
        const lineKey = `${line.role}::${line.stone_id}`;
        const existingIndex = variant?.stoneLineIndex.get(lineKey);

        if (existingIndex !== undefined) {
          variant!.stones[existingIndex] = {
            ...variant!.stones[existingIndex],
            quantity: variant!.stones[existingIndex].quantity + line.quantity,
            stone: variant!.stones[existingIndex].stone ?? line.stone,
          };
          return;
        }

        variant!.stoneLineIndex.set(lineKey, variant!.stones.length);
        variant!.stones.push(line);
      };

      const mainStoneId = valueAtColumn(row, 10).trim().toUpperCase();
      const mainStoneQuantity = parseNumber(valueAtColumn(row, 11), 0);

      if (mainStoneId && mainStoneQuantity > 0) {
        appendStoneLine(
          createProductStoneLine({
            stoneId: mainStoneId,
            quantity: mainStoneQuantity,
            role: "main",
            stone: stonesById.get(mainStoneId) ?? null,
            label: valueAtColumn(row, 4).trim() || "Main stone",
            shape: valueAtColumn(row, 5).trim(),
            cut: valueAtColumn(row, 6).trim(),
            quality: valueAtColumn(row, 8).trim(),
            color: valueAtColumn(row, 9).trim(),
            measurements: valueAtColumn(row, 7).trim(),
          }),
        );
      }

      const accentStoneId = valueAtColumn(row, 18).trim().toUpperCase();
      const accentStoneQuantity = parseNumber(valueAtColumn(row, 19), 0);

      if (accentStoneId && accentStoneQuantity > 0) {
        appendStoneLine(
          createProductStoneLine({
            stoneId: accentStoneId,
            quantity: accentStoneQuantity,
            role: "accent",
            stone: stonesById.get(accentStoneId) ?? null,
            label: valueAtColumn(row, 12).trim() || "Accent stones",
            shape: valueAtColumn(row, 13).trim(),
            cut: valueAtColumn(row, 14).trim(),
            quality: valueAtColumn(row, 15).trim(),
            color: valueAtColumn(row, 16).trim(),
            measurements: valueAtColumn(row, 17).trim(),
          }),
        );
      }
    }

    const firstRow = matchingRows[0] ?? [];
    const productId = normalizeDigits(valueAtColumn(firstRow, productIdColumnIndex)) || resolvedReference.normalizedId;
    const productHandle = valueAtColumn(firstRow, productHandleColumnIndex).trim() || resolvedReference.normalizedHandle;
    const title = valueAtColumn(firstRow, titleColumnIndex).trim() || productHandle;
    const description = valueAtColumn(firstRow, descriptionColumnIndex).trim();
    const variantList = Array.from(variants.values()).map(({ stoneLineIndex: _stoneLineIndex, ...variant }) => variant);
    const defaultVariant =
      [...variantList].sort((left, right) => {
        const score = (variant: ProductCompositionVariant) => {
          let value = 0;
          if (variant.settings.some((setting) => setting.setting_id.includes("SRY4"))) value += 30;
          if (variant.metal.toLowerCase().includes("14k")) value += 20;
          if (variant.metal.toLowerCase().includes("yellow")) value += 10;
          if (variant.variant_sku) value += 5;
          return value;
        };

        return score(right) - score(left);
      })[0] ?? variantList[0];

    return {
      reference: resolvedReference.raw,
      matched_by: resolvedReference.matchedBy,
      product_id: productId,
      product_handle: productHandle,
      title,
      description,
      default_variant_key: defaultVariant?.variant_key ?? "",
      variants: variantList,
    };
  }

  async getPricingDefaults(): Promise<PricingDefaults> {
    return this.getCachedPricingDefaults();
  }

  async listInquiries(): Promise<Inquiry[]> {
    const database = await readActivityDatabase();
    return database.inquiries.sort((left, right) => right.created_at.localeCompare(left.created_at));
  }

  async createInquiry(inquiry: Inquiry): Promise<Inquiry> {
    return mutateActivityDatabase(async (database) => {
      database.inquiries.unshift(inquiry);
      return inquiry;
    });
  }

  async listValuations(): Promise<ValuationRecord[]> {
    const database = await readActivityDatabase();
    return database.valuations.sort((left, right) => right.updated_at.localeCompare(left.updated_at));
  }

  async findValuationById(valuationId: string): Promise<ValuationRecord | null> {
    const database = await readActivityDatabase();
    return database.valuations.find((valuation) => valuation.valuation_id === valuationId) ?? null;
  }

  async createValuation(valuation: ValuationRecord): Promise<ValuationRecord> {
    return mutateActivityDatabase(async (database) => {
      database.valuations.unshift(valuation);
      return valuation;
    });
  }

  async updateValuation(valuation: ValuationRecord): Promise<ValuationRecord> {
    return mutateActivityDatabase(async (database) => {
      const index = database.valuations.findIndex((entry) => entry.valuation_id === valuation.valuation_id);

      if (index === -1) {
        database.valuations.unshift(valuation);
      } else {
        database.valuations[index] = valuation;
      }

      return valuation;
    });
  }
}
