export function roundCurrency(value: number): number {
  return Math.round(value * 100) / 100;
}

export function toIsoNow(): string {
  return new Date().toISOString();
}

export function createRecordId(prefix: string): string {
  const compact = crypto.randomUUID().replaceAll("-", "").slice(0, 10);
  return `${prefix}_${compact}`;
}

export function normalizeText(value: string): string {
  return value.trim().toLowerCase();
}

export function hasText(value: string | null | undefined): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

export function parseNumber(value: unknown, fallback = 0): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string") {
    const normalized = value.trim().replace(/[^0-9.-]+/g, "");
    if (!normalized) {
      return fallback;
    }

    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  return fallback;
}

export function normalizeHeader(value: string): string {
  return value.trim().toLowerCase();
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function columnFromIndex(index: number): string {
  let current = index + 1;
  let output = "";

  while (current > 0) {
    const remainder = (current - 1) % 26;
    output = String.fromCharCode(65 + remainder) + output;
    current = Math.floor((current - 1) / 26);
  }

  return output;
}

export function parseInteger(value: string | null | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : fallback;
}

export function parseOptionalNumber(value: string | null | undefined): number | undefined {
  if (value === null || value === undefined || value.trim() === "") {
    return undefined;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function formatStoneSize(minSizeMm: number, maxSizeMm: number): string {
  const min = Number.isFinite(minSizeMm) && minSizeMm > 0 ? minSizeMm : 0;
  const max = Number.isFinite(maxSizeMm) && maxSizeMm > 0 ? maxSizeMm : 0;

  if (min > 0 && max > 0) {
    if (Math.abs(min - max) < 0.001) {
      return `${min} mm`;
    }

    return `${min}x${max} mm`;
  }

  if (max > 0) {
    return `${max} mm`;
  }

  if (min > 0) {
    return `${min} mm`;
  }

  return "";
}

export function paginateItems<T>(items: T[], page: number, pageSize: number) {
  const safePageSize = Math.max(1, pageSize);
  const total = items.length;
  const totalPages = Math.max(1, Math.ceil(total / safePageSize));
  const safePage = clamp(page, 1, totalPages);
  const startIndex = (safePage - 1) * safePageSize;

  return {
    items: items.slice(startIndex, startIndex + safePageSize),
    total,
    page: safePage,
    pageSize: safePageSize,
    totalPages,
  };
}
