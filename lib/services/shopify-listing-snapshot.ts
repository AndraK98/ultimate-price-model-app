function decodeHtmlEntities(value: string) {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function stripTags(value: string) {
  return decodeHtmlEntities(value.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function extractMetaContent(html: string, key: string, attribute: "property" | "name") {
  const pattern = new RegExp(
    `<meta[^>]+${attribute}=["']${escapeRegExp(key)}["'][^>]+content=["']([^"']+)["'][^>]*>`,
    "i",
  );
  return decodeHtmlEntities(html.match(pattern)?.[1] ?? "").trim();
}

function extractTitleFromHtml(html: string) {
  return decodeHtmlEntities(html.match(/<title>([\s\S]*?)<\/title>/i)?.[1] ?? "").replace(/\s+/g, " ").trim();
}

function parseJsonLdBlocks(html: string) {
  const blocks = Array.from(html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi));
  const parsed: unknown[] = [];

  for (const block of blocks) {
    const raw = block[1]?.trim();

    if (!raw) {
      continue;
    }

    try {
      parsed.push(JSON.parse(raw));
    } catch {
      // Ignore malformed JSON-LD blocks.
    }
  }

  return parsed.flatMap((entry) => (Array.isArray(entry) ? entry : [entry]));
}

function normalizeUrl(candidate: string, baseUrl: string) {
  try {
    return new URL(candidate, baseUrl).toString();
  } catch {
    return "";
  }
}

function dedupeUrls(values: string[]) {
  return Array.from(new Set(values.filter(Boolean)));
}

function extractProductId(html: string, jsonLdBlocks: unknown[]) {
  const regexes = [
    /ShopifyAnalytics\.meta\s*=\s*\{"product":\{"id":(\d+)/i,
    /"product"\s*:\s*\{"id"\s*:\s*(\d+)/i,
    /"product_id"\s*:\s*"?(\d+)"?/i,
    /data-product-id=["'](\d+)["']/i,
    /"id"\s*:\s*(\d{10,})/i,
  ];

  for (const regex of regexes) {
    const match = html.match(regex);
    if (match?.[1]) {
      return match[1];
    }
  }

  for (const block of jsonLdBlocks) {
    if (!block || typeof block !== "object") {
      continue;
    }

    const source = block as Record<string, unknown>;
    const candidates = [source.productID, source.productId, source.sku];

    for (const candidate of candidates) {
      const normalized = String(candidate ?? "").trim();
      if (/^\d+$/.test(normalized)) {
        return normalized;
      }
    }
  }

  return "";
}

function extractHandle(sourceUrl: string) {
  try {
    const url = new URL(sourceUrl);
    const segments = url.pathname.split("/").filter(Boolean);
    const productsIndex = segments.findIndex((segment) => segment === "products");

    if (productsIndex !== -1 && segments[productsIndex + 1]) {
      return segments[productsIndex + 1];
    }
  } catch {
    // Ignore parse failures.
  }

  return "";
}

function extractDescription(html: string, jsonLdBlocks: unknown[]) {
  for (const block of jsonLdBlocks) {
    if (!block || typeof block !== "object") {
      continue;
    }

    const description = String((block as Record<string, unknown>).description ?? "").trim();
    if (description) {
      return stripTags(description);
    }
  }

  return (
    extractMetaContent(html, "og:description", "property") ||
    extractMetaContent(html, "description", "name") ||
    ""
  );
}

function extractTitle(html: string, jsonLdBlocks: unknown[]) {
  for (const block of jsonLdBlocks) {
    if (!block || typeof block !== "object") {
      continue;
    }

    const title = String((block as Record<string, unknown>).name ?? "").trim();
    if (title) {
      return decodeHtmlEntities(title);
    }
  }

  return extractMetaContent(html, "og:title", "property") || extractTitleFromHtml(html);
}

function extractImageUrls(html: string, jsonLdBlocks: unknown[], sourceUrl: string) {
  const urls = new Set<string>();

  const ogImage = extractMetaContent(html, "og:image", "property");
  if (ogImage) {
    const normalized = normalizeUrl(ogImage, sourceUrl);
    if (normalized) {
      urls.add(normalized);
    }
  }

  for (const block of jsonLdBlocks) {
    if (!block || typeof block !== "object") {
      continue;
    }

    const source = block as Record<string, unknown>;
    const image = source.image;
    const candidates = Array.isArray(image) ? image : image ? [image] : [];

    for (const candidate of candidates) {
      if (typeof candidate === "string") {
        const normalized = normalizeUrl(candidate, sourceUrl);
        if (normalized) {
          urls.add(normalized);
        }
      } else if (candidate && typeof candidate === "object") {
        const url = String((candidate as Record<string, unknown>).url ?? "").trim();
        const normalized = normalizeUrl(url, sourceUrl);
        if (normalized) {
          urls.add(normalized);
        }
      }
    }
  }

  for (const match of html.matchAll(/https?:\/\/[^"'<>]+\.(?:jpg|jpeg|png|webp)(?:\?[^"'<>]*)?/gi)) {
    const normalized = normalizeUrl(match[0], sourceUrl);
    if (normalized) {
      urls.add(normalized);
    }
  }

  return dedupeUrls(Array.from(urls));
}

async function fetchImageDataUrls(imageUrls: string[]) {
  const imageDataUrls: string[] = [];

  for (const imageUrl of imageUrls.slice(0, 6)) {
    try {
      const response = await fetch(imageUrl, {
        cache: "no-store",
        headers: {
          "User-Agent": "CapucinneAtelierBot/2.4.0",
        },
      });

      if (!response.ok) {
        continue;
      }

      const contentType = response.headers.get("content-type")?.trim() ?? "";
      if (!contentType.startsWith("image/")) {
        continue;
      }

      const arrayBuffer = await response.arrayBuffer();
      if (arrayBuffer.byteLength === 0 || arrayBuffer.byteLength > 4_500_000) {
        continue;
      }

      imageDataUrls.push(`data:${contentType};base64,${Buffer.from(arrayBuffer).toString("base64")}`);
    } catch {
      // Ignore individual image fetch failures.
    }
  }

  return imageDataUrls;
}

export interface ShopifyListingSnapshot {
  sourceUrl: string;
  productId: string;
  productHandle: string;
  title: string;
  description: string;
  imageUrls: string[];
  imageDataUrls: string[];
}

export async function fetchShopifyListingSnapshot(sourceUrl: string): Promise<ShopifyListingSnapshot> {
  const normalizedUrl = new URL(sourceUrl).toString();
  const response = await fetch(normalizedUrl, {
    cache: "no-store",
    headers: {
      "User-Agent": "CapucinneAtelierBot/2.4.0",
      Accept: "text/html,application/xhtml+xml",
    },
    redirect: "follow",
  });

  if (!response.ok) {
    throw new Error(`Could not load that Shopify page (${response.status}).`);
  }

  const html = await response.text();
  const jsonLdBlocks = parseJsonLdBlocks(html);
  const productId = extractProductId(html, jsonLdBlocks);
  const productHandle = extractHandle(normalizedUrl);
  const title = extractTitle(html, jsonLdBlocks) || productHandle || "Untitled Shopify listing";
  const description = extractDescription(html, jsonLdBlocks);
  const imageUrls = extractImageUrls(html, jsonLdBlocks, normalizedUrl);
  const imageDataUrls = await fetchImageDataUrls(imageUrls);

  return {
    sourceUrl: normalizedUrl,
    productId,
    productHandle,
    title,
    description,
    imageUrls,
    imageDataUrls,
  };
}
