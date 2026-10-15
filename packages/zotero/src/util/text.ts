/**
 * Pure text helpers (no Zotero globals; unit-tested in Node).
 */
import type { TruncatedText } from "../../../../shared/types/snapshot.js";

/** Truncate to `max` UTF-16 code units without splitting a surrogate pair. */
export function truncateText(value: string, max: number): TruncatedText {
  const length = value.length;
  if (length <= max) return { text: value, length, truncated: false };
  let end = Math.max(0, max);
  const code = value.charCodeAt(end - 1);
  if (end > 0 && code >= 0xd800 && code <= 0xdbff) end -= 1;
  return { text: value.slice(0, end), length, truncated: true };
}

/** Collapse whitespace runs and trim; keeps paragraph breaks as single newlines. */
export function normalizeWhitespace(value: string): string {
  return value
    .replace(/\r\n?/g, "\n")
    .replace(/[\t\f\v  ]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

const ENTITY_MAP: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

/**
 * Dependency-free HTML -> text fallback. Inside Zotero the plugin prefers nsIParserUtils.convertToPlainText;
 * this is used when that service is unavailable and in tests.
 */
export function htmlToPlainTextFallback(html: string): string {
  const withBreaks = html
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|h[1-6]|li|blockquote|pre|tr|table|ul|ol)\s*>/gi, "\n")
    .replace(/<li\b[^>]*>/gi, "- ")
    .replace(/<[^>]+>/g, "");
  const decoded = withBreaks.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, (match, entity: string) => {
    if (entity[0] === "#") {
      const code = entity[1] === "x" || entity[1] === "X" ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10);
      return Number.isFinite(code) && code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match;
    }
    return ENTITY_MAP[entity.toLowerCase()] ?? match;
  });
  return normalizeWhitespace(decoded);
}

/** Remove U+2068 FIRST STRONG ISOLATE / U+2069 POP DIRECTIONAL ISOLATE (invisible; Zotero wraps creator names in them). */
export function stripBidiIsolates(value: string): string {
  return value.replace(/[⁨⁩]/g, "");
}

/** Strip control characters (except tab/newline) and cap length; used for ids echoed into snapshots/logs. */
export function sanitizeIdentifier(value: string | undefined | null, max = 128): string | null {
  if (value === undefined || value === null) return null;
  // eslint-disable-next-line no-control-regex
  const cleaned = value.replace(/[\u0000-\u001f\u007f]/g, "").trim();
  if (!cleaned) return null;
  return cleaned.length > max ? cleaned.slice(0, max) : cleaned;
}
