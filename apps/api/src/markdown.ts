import { createHash } from "node:crypto";
import sanitizeHtml from "sanitize-html";
import type { AppConfig } from "./config.js";

const allowedTags = ["h1", "h2", "h3", "h4", "h5", "h6", "p", "ul", "ol", "li", "blockquote", "pre", "code", "em", "strong", "table", "thead", "tbody", "tr", "th", "td", "br"];

export function validateMarkdownFilename(filename: string): string {
  const trimmed = filename.trim();
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}\.md$/i.test(trimmed) || trimmed.includes("..")) {
    throw new Error("MARKDOWN_FILENAME_INVALID");
  }
  return trimmed;
}

export function normalizeMarkdown(input: string, config: AppConfig): string {
  const value = input.split(String.fromCharCode(0)).join("").replace(/\r\n?/g, "\n");
  const bytes = Buffer.byteLength(value, "utf8");
  if (bytes > config.maxMdBytes) throw new Error("MARKDOWN_TOO_LARGE");
  return sanitizeHtml(value, {
    allowedTags,
    allowedAttributes: {},
    allowedSchemes: [],
    disallowedTagsMode: "discard",
  }).trim();
}

export function parseMarkdownBuffer(buffer: Buffer, config: AppConfig): string {
  if (buffer.byteLength > config.maxMdBytes) throw new Error("MARKDOWN_TOO_LARGE");
  return normalizeMarkdown(buffer.toString("utf8"), config);
}

export function markdownHash(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}
