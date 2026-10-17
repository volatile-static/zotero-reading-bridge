/**
 * Choose the part of a full text one get_fulltext call returns. Pure: no Zotero globals (unit-tested in Node).
 */

export interface SliceLimit {
  /** Hard cap in UTF-16 code units (an explicit maxLength); null to size by estimated tokens. */
  maxChars: number | null;
  /** Estimated-token budget used when maxChars is null. */
  maxTokens: number;
}

/**
 * Rough token cost of one UTF-16 code unit: about four ASCII characters per token, about one token per CJK or other
 * non-ASCII character. Deliberately pessimistic for non-Latin text so a slice never overshoots a client's cap.
 */
function unitCost(code: number): number {
  return code < 0x80 ? 0.25 : 1;
}

/** Fraction of the slice searched backwards for a line break to end on. */
const BREAK_WINDOW = 0.2;

/**
 * End offset (exclusive) of the slice starting at `offset`. A slice that stops before the end of the text ends after
 * a line break when one lies in its last 20%, and never between the two halves of a surrogate pair.
 */
export function sliceEnd(text: string, offset: number, limit: SliceLimit): number {
  const start = Math.min(Math.max(offset, 0), text.length);
  let end: number;
  if (limit.maxChars !== null) {
    end = Math.min(text.length, start + limit.maxChars);
  } else {
    let cost = 0;
    end = start;
    while (end < text.length) {
      cost += unitCost(text.charCodeAt(end));
      if (cost > limit.maxTokens) break;
      end += 1;
    }
  }
  if (end >= text.length) return text.length;
  const floor = end - Math.floor((end - start) * BREAK_WINDOW);
  const lineBreak = text.lastIndexOf("\n", end - 1);
  if (lineBreak >= floor && lineBreak + 1 > start) end = lineBreak + 1;
  const last = text.charCodeAt(end - 1);
  if (end - 1 > start && last >= 0xd800 && last <= 0xdbff) end -= 1;
  // Always make progress, even when a single unit exceeds the budget.
  return Math.max(end, Math.min(start + 1, text.length));
}
