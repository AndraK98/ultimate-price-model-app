import { getAppConfig } from "@/lib/config";
import { GoogleDriveClient } from "@/lib/drive/google-drive-client";
import { type ValuationRecord } from "@/lib/types";

type KnowledgePromotionResult = {
  status: "created" | "updated" | "unchanged";
  fileId: string;
  fileName: string;
  webViewUrl: string;
};

function createDriveClient() {
  const config = getAppConfig();

  return new GoogleDriveClient({
    serviceAccountEmail: config.google.serviceAccountEmail,
    privateKey: config.google.privateKey,
  });
}

function markdownEscape(value: string) {
  return value.replace(/\r\n/g, "\n").trim();
}

function headingSafeExcerpt(value: string, max = 72) {
  const trimmed = value.trim().replace(/\s+/g, " ");

  if (!trimmed) {
    return "Approximation";
  }

  return trimmed.length > max ? `${trimmed.slice(0, max - 1)}…` : trimmed;
}

function buildConversationSnapshot(valuation: ValuationRecord) {
  if (!valuation.messages.length) {
    return "- No messages stored yet.";
  }

  return valuation.messages
    .map((message) => {
      const speaker = message.role === "user" ? "User" : "Gemini";
      return `#### ${speaker}\n${markdownEscape(message.content) || "No content."}`;
    })
    .join("\n\n");
}

function buildKnowledgeHeader(valuation: ValuationRecord) {
  return [
    `# ${headingSafeExcerpt(valuation.description)}`,
    "",
    `- Source valuation ID: \`${valuation.valuation_id}\``,
    `- First created: ${valuation.created_at}`,
    `- Latest update at capture time: ${valuation.updated_at}`,
    "- Source: Capucinne approximation thread",
    "",
    "This file is appended from the same approximation context over time. Older captures remain below for audit and continuity.",
  ].join("\n");
}

function buildKnowledgeCapture(valuation: ValuationRecord) {
  const snapshotMarker = `<!-- valuation-snapshot:${valuation.updated_at} -->`;
  const pricingLines = [
    `- Stone subtotal: ${valuation.estimated_stone_total} USD`,
    `- Setting subtotal: ${valuation.estimated_setting_total} USD`,
    `- Complexity level: ${valuation.inferred_complexity_level || valuation.complexity_level || 0}`,
    `- Complexity multiplier: ${valuation.inferred_complexity_multiplier}`,
    `- Formula total: ${valuation.estimated_formula_total} USD`,
  ].join("\n");
  const knowledgeLinks = valuation.referenced_knowledge_files.length
    ? valuation.referenced_knowledge_files
        .map((file) => `- [${file.name}](${file.web_view_url})`)
        .join("\n")
    : "- None referenced during this run.";

  return [
    snapshotMarker,
    `## Capture ${valuation.updated_at}`,
    "",
    "### Request",
    markdownEscape(valuation.description) || "No request stored.",
    "",
    valuation.reference_image_url ? "### Reference image URL\n" + valuation.reference_image_url + "\n" : "",
    "### Formula snapshot",
    pricingLines,
    "",
    "### Gemini pricing summary",
    markdownEscape(valuation.pricing_summary) || "No pricing summary stored.",
    "",
    "### Gemini reasoning",
    markdownEscape(valuation.reasoning) || "No reasoning stored.",
    "",
    "### Recommended next step",
    markdownEscape(valuation.recommended_next_step) || "No next step stored.",
    "",
    "### Knowledge files used",
    knowledgeLinks,
    "",
    "### Conversation snapshot",
    buildConversationSnapshot(valuation),
  ]
    .filter(Boolean)
    .join("\n");
}

export async function promoteValuationToKnowledge(valuation: ValuationRecord): Promise<KnowledgePromotionResult> {
  const config = getAppConfig();

  if (!config.google.drive.knowledgeFolderId) {
    throw new Error("GOOGLE_DRIVE_KNOWLEDGE_FOLDER_ID is required to promote approximations into knowledge.");
  }

  const client = createDriveClient();
  const fileName = `${valuation.valuation_id}.md`;
  const existing = await client.findChildByName(config.google.drive.knowledgeFolderId, fileName, "text/markdown");
  const nextCapture = buildKnowledgeCapture(valuation);
  const marker = `<!-- valuation-snapshot:${valuation.updated_at} -->`;

  if (!existing) {
    const content = [buildKnowledgeHeader(valuation), "", nextCapture, ""].join("\n");
    const created = await client.createTextFile(config.google.drive.knowledgeFolderId, fileName, content, "text/markdown");

    return {
      status: "created",
      fileId: created.id,
      fileName: created.name,
      webViewUrl: created.webViewLink ?? `https://drive.google.com/file/d/${created.id}/view`,
    };
  }

  const existingContent = await client.downloadTextFile(existing.id);

  if (existingContent.includes(marker)) {
    return {
      status: "unchanged",
      fileId: existing.id,
      fileName: existing.name,
      webViewUrl: existing.webViewLink ?? `https://drive.google.com/file/d/${existing.id}/view`,
    };
  }

  const updatedContent = `${existingContent.trimEnd()}\n\n---\n\n${nextCapture}\n`;
  const updated = await client.updateTextFile(existing.id, existing.name, updatedContent, "text/markdown");

  return {
    status: "updated",
    fileId: updated.id,
    fileName: updated.name,
    webViewUrl: updated.webViewLink ?? `https://drive.google.com/file/d/${updated.id}/view`,
  };
}

export type { KnowledgePromotionResult };
