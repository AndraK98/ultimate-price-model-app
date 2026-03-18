import { type Setting, type SettingFilters, type Stone, type StoneFilters } from "@/lib/types";
import { formatStoneSize, hasText, normalizeText } from "@/lib/utils";

type SearchFieldMap = Record<string, string[]>;

function tokenize(query?: string): string[] {
  if (!query) {
    return [];
  }

  return query
    .trim()
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean);
}

function fieldMatches(values: string[] | undefined, token: string): boolean {
  if (!values?.length) {
    return false;
  }

  return values.some((value) => normalizeText(value).includes(token));
}

function freeTextMatches(fieldMap: SearchFieldMap, token: string): boolean {
  return Object.values(fieldMap).some((values) => fieldMatches(values, token));
}

function matchesSmartQuery(fieldMap: SearchFieldMap, query?: string): boolean {
  const tokens = tokenize(query);

  if (!tokens.length) {
    return true;
  }

  return tokens.every((token) => {
    const [rawKey, ...rest] = token.split(":");

    if (rest.length > 0) {
      const key = normalizeText(rawKey);
      const value = normalizeText(rest.join(":"));
      return fieldMatches(fieldMap[key], value);
    }

    return freeTextMatches(fieldMap, normalizeText(token));
  });
}

function matchesTextFilter(value: string, filter?: string): boolean {
  if (!hasText(filter)) {
    return true;
  }

  return normalizeText(value).includes(normalizeText(filter ?? ""));
}

function matchesIncludedSettingIds(settingId: string, filterIds?: string[]): boolean {
  if (!filterIds?.length) {
    return true;
  }

  const normalizedSettingId = normalizeText(settingId);
  return filterIds.some((filterId) => normalizeText(filterId) === normalizedSettingId);
}

function normalizeSizeSearchValue(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/(?<=\d),(?=\d)/g, ".")
    .replace(/[×*]/g, "x")
    .replace(/\bby\b/g, "x")
    .replace(/millimeters?|millimetres?|mm/g, "")
    .replace(/\s*x\s*/g, "x")
    .replace(/\s+/g, "")
    .replace(/[^0-9.x]/g, "");
}

function normalizeSizeNumberToken(value: string): string {
  const parsed = Number(value.replace(",", "."));
  return Number.isFinite(parsed) ? parsed.toString() : value.trim().replace(",", ".");
}

function extractSizeNumberTokens(value: string): string[] {
  return (value.match(/\d+(?:[.,]\d+)?/g) ?? []).map(normalizeSizeNumberToken);
}

function buildStoneSizeSearchValues(stone: Stone): string[] {
  const values = new Set<string>();
  const formattedSize = formatStoneSize(stone.min_size_mm, stone.max_size_mm);
  const minSize = stone.min_size_mm > 0 ? String(stone.min_size_mm) : "";
  const maxSize = stone.max_size_mm > 0 ? String(stone.max_size_mm) : "";

  if (formattedSize) {
    values.add(formattedSize);
  }

  if (minSize) {
    values.add(minSize);
    values.add(`${minSize} mm`);
  }

  if (maxSize) {
    values.add(maxSize);
    values.add(`${maxSize} mm`);
  }

  if (minSize && maxSize) {
    values.add(`${minSize}x${maxSize}`);
    values.add(`${minSize} x ${maxSize} mm`);
    values.add(`${maxSize}x${minSize}`);
    values.add(`${maxSize} x ${minSize} mm`);
  }

  return Array.from(values);
}

function matchesStoneSizeFilter(stone: Stone, filter?: string): boolean {
  if (!hasText(filter)) {
    return true;
  }

  const sizeValues = buildStoneSizeSearchValues(stone);
  const normalizedFilter = normalizeSizeSearchValue(filter ?? "");

  if (!normalizedFilter) {
    return true;
  }

  const normalizedSizeValues = sizeValues.map(normalizeSizeSearchValue).filter(Boolean);

  if (normalizedSizeValues.some((value) => value.includes(normalizedFilter))) {
    return true;
  }

  const filterNumberTokens = extractSizeNumberTokens(filter ?? "");
  if (!filterNumberTokens.length) {
    return false;
  }

  return sizeValues.some((value) => {
    const candidateNumberTokens = extractSizeNumberTokens(value);
    return filterNumberTokens.every((filterToken) => candidateNumberTokens.includes(filterToken));
  });
}

function matchesMin(value: number, min?: number): boolean {
  return min === undefined || value >= min;
}

function matchesMax(value: number, max?: number): boolean {
  return max === undefined || value <= max;
}

export function matchesStoneSearch(stone: Stone, query?: string): boolean {
  const sizeSearchValues = buildStoneSizeSearchValues(stone);
  return matchesSmartQuery(
    {
      sku: [stone.stone_id],
      id: [stone.stone_id],
      stone: [stone.name],
      type: [stone.name],
      name: [stone.name],
      shape: [stone.shape],
      color: [stone.color],
      cut: [stone.quality],
      quality: [stone.quality],
      size: sizeSearchValues,
      carat: [String(stone.carat), `${stone.carat} ct`],
      price: [String(stone.final_price), `${stone.final_price}`],
      notes: [stone.notes],
    },
    query,
  );
}

export function matchesStoneFilters(stone: Stone, filters?: StoneFilters): boolean {
  if (!filters) {
    return true;
  }

  return (
    matchesStoneSearch(stone, filters.query) &&
    matchesTextFilter(stone.stone_id, filters.stoneId) &&
    matchesTextFilter(stone.name, filters.name) &&
    matchesTextFilter(stone.shape, filters.shape) &&
    matchesTextFilter(stone.color, filters.color) &&
    matchesTextFilter(stone.quality, filters.quality) &&
    matchesStoneSizeFilter(stone, filters.size) &&
    matchesMin(stone.carat, filters.minCarat) &&
    matchesMax(stone.carat, filters.maxCarat) &&
    matchesMin(stone.final_price, filters.minPricePerCarat) &&
    matchesMax(stone.final_price, filters.maxPricePerCarat)
  );
}

export function matchesSettingSearch(setting: Setting, query?: string): boolean {
  return matchesSmartQuery(
    {
      sku: [setting.setting_id],
      id: [setting.setting_id],
      style: [setting.style],
      metal: [setting.metal],
      complexity: [String(setting.complexity_level)],
      weight: [String(setting.gold_weight_g), `${setting.gold_weight_g} g`],
      price: [String(setting.base_price), `${setting.base_price}`],
      cost: [String(setting.base_price), `${setting.base_price}`],
      labor: [String(setting.labor_cost), `${setting.labor_cost}`],
    },
    query,
  );
}

export function matchesSettingFilters(setting: Setting, filters?: SettingFilters): boolean {
  if (!filters) {
    return true;
  }

  return (
    matchesSettingSearch(setting, filters.query) &&
    matchesIncludedSettingIds(setting.setting_id, filters.settingIds) &&
    matchesTextFilter(setting.setting_id, filters.settingId) &&
    matchesTextFilter(setting.style, filters.style) &&
    matchesTextFilter(setting.metal, filters.metal) &&
    matchesMin(setting.gold_weight_g, filters.minWeightG) &&
    matchesMax(setting.gold_weight_g, filters.maxWeightG) &&
    matchesMin(setting.complexity_level, filters.minComplexity) &&
    matchesMax(setting.complexity_level, filters.maxComplexity) &&
    matchesMin(setting.labor_cost, filters.minLaborCost) &&
    matchesMax(setting.labor_cost, filters.maxLaborCost) &&
    matchesMin(setting.base_price, filters.minBasePrice) &&
    matchesMax(setting.base_price, filters.maxBasePrice)
  );
}
