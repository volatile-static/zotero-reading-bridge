/**
 * Pure planning for item searches: which Zotero 11 search conditions to add, and result ordering.
 * src/zotero/search.ts applies the plan to live Zotero.Search objects. Condition names and operators are the
 * ones defined in Zotero 11's xpcom/data/searchConditions.js (verified against 11.0-beta.1).
 */
import type { SearchMode, SearchRequest, SortDirection } from "./data-args.js";
import { ToolError } from "./types.js";

export interface SearchCondition {
  condition: string;
  operator: string;
  value?: string;
}

/** One word or "quoted phrase" as split by Zotero.SearchConditions.parseSearchString. */
export interface SearchTerm {
  text: string;
  inQuotes: boolean;
}

/**
 * Conditions of the scope search that applies the filters. `resultLevel item` makes Zotero 11 return top-level
 * rows and map lower-level matches up (a tag on a child note counts for its parent), so every filter combines with
 * AND at the item level.
 */
export function filterConditions(request: SearchRequest, recursiveCollections: boolean): SearchCondition[] {
  const conditions: SearchCondition[] = [{ condition: "resultLevel", operator: "item" }];
  for (const tag of request.tags) {
    conditions.push({ condition: "tag", operator: "is", value: tag });
  }
  if (request.creator !== null) {
    conditions.push({ condition: "creator", operator: "contains", value: request.creator });
  }
  if (request.itemType !== null) {
    conditions.push({ condition: "itemType", operator: "is", value: request.itemType });
  }
  if (request.collectionKey !== null) {
    conditions.push({ condition: "collection", operator: "is", value: request.collectionKey });
    // Same scope as the collection view in Zotero, which follows the "show items from subcollections" pref.
    if (recursiveCollections) conditions.push({ condition: "recursive", operator: "true" });
  }
  return conditions;
}

/**
 * Conditions for the text query. Quick-search modes pass the raw query to Zotero's `quicksearch-<mode>` expansion
 * (each word an OR-group over the mode's fields, words ANDed). `fulltext` adds one `fulltextContent` condition per
 * word. Returns [] when the query holds no usable term.
 *
 * `canSearchContent` is Zotero.FullText.canSearchContent: false for a term the content index cannot answer at all
 * (mixed CJK and Latin/digits, a single CJK character, no letters or digits) and for single words under 3 letters.
 * A full-text condition on an unanswerable term makes Zotero fall back to reading the cached text of every
 * attachment in the library (Zotero.FullText.findTextInItems), which can take minutes on a large library and keeps
 * running after the client gives up. Zotero's quick search sends every QUOTED term to the index, so:
 *  - `fulltext`: every term must be answerable; dropping one silently would return broader results than asked for;
 *  - `everything`: quoted terms must be answerable (unquoted short words only match titles, tags, notes...).
 * Offending terms fail with INVALID_ARGUMENT naming each term and why.
 */
export function queryConditions(
  mode: SearchMode,
  query: string,
  terms: readonly SearchTerm[],
  canSearchContent: (text: string) => boolean,
): SearchCondition[] {
  const usable = terms.filter((term) => term.text.trim() !== "");
  if (usable.length === 0) return [];
  if (mode === "fulltext") {
    const unanswerable = usable.filter((term) => !canSearchContent(term.text));
    if (unanswerable.length > 0) throw unanswerableTermsError(mode, unanswerable);
    return usable.map((term) => ({ condition: "fulltextContent", operator: "contains", value: term.text }));
  }
  if (mode === "everything") {
    const unanswerable = usable.filter((term) => term.inQuotes && !canSearchContent(term.text));
    if (unanswerable.length > 0) throw unanswerableTermsError(mode, unanswerable);
  }
  return [{ condition: `quicksearch-${mode}`, operator: "contains", value: query }];
}

// Same character classes as Zotero 11's content index (xpcom/fulltext.js _cjkCharRE / _wordTokenRE).
const CJK_CHAR = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;
const CJK_RUN = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]+/gu;
const WORD_TOKEN = /[\p{L}\p{N}]+/gu;

/** Zotero.Utilities.Internal.normalizeForSearch, minus the formatting-tag and typography folding. */
function normalizeForIndex(text: string): string {
  return text.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

/**
 * Why Zotero's content index cannot answer `text`, or null when it can. Mirrors Zotero 11's getWordMatchClause /
 * canSearchContent; used for error messages and as a fallback when Zotero.FullText.canSearchContent is missing.
 */
export function contentTermProblem(text: string): string | null {
  const normalized = normalizeForIndex(text);
  const hasCJK = CJK_CHAR.test(normalized);
  const hasNonCJK = /[\p{L}\p{N}]/u.test(normalized.replace(CJK_RUN, ""));
  if (hasCJK && hasNonCJK) return "mixes CJK characters with Latin letters or digits (search the parts as separate terms)";
  if (hasCJK) {
    const runs = normalized.match(CJK_RUN) ?? [];
    return runs.some((run) => [...run].length >= 2) ? null : "has fewer than 2 adjacent CJK characters";
  }
  const tokens = normalized.match(WORD_TOKEN) ?? [];
  if (tokens.length === 0) return "has no letters or digits";
  if (tokens.length === 1 && [...(tokens[0] ?? "")].length < 3) return "is a single word shorter than 3 letters";
  return null;
}

function unanswerableTermsError(mode: SearchMode, terms: readonly SearchTerm[]): ToolError {
  const listed = terms.map((term) => ({
    term: term.text,
    quoted: term.inQuotes,
    reason: contentTermProblem(term.text) ?? "cannot be matched against Zotero's full-text index",
  }));
  const described = listed.map((entry) => `${JSON.stringify(entry.term)} ${entry.reason}`).join("; ");
  const hint =
    mode === "fulltext"
      ? "Remove these terms and search again (nothing was searched), or use mode 'everything' to also match short words in titles, tags and notes."
      : "Remove the double quotes from these terms (unquoted, they are still matched against titles, creators, tags and notes) or split mixed CJK/Latin terms into separate words.";
  return new ToolError(
    "INVALID_ARGUMENT",
    `Zotero's full-text index cannot answer ${terms.length === 1 ? "this term" : "these terms"}: ${described}. ${hint}`,
    { mode, unsearchableTerms: listed },
  );
}

export interface SortEntry<T> {
  /** Comparable value; "" means unknown and always sorts last. */
  value: string;
  /** Object key, the deterministic tie-breaker. */
  key: string;
  data: T;
}

export function compareCodeUnits(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Stable, deterministic ordering: entries with a value first (ordered by `compare` in `direction`), entries
 * without one last, ties broken by key ascending so pages never overlap between calls.
 */
export function sortEntries<T>(
  entries: readonly SortEntry<T>[],
  direction: SortDirection,
  compare: (a: string, b: string) => number = compareCodeUnits,
): T[] {
  const sign = direction === "asc" ? 1 : -1;
  return [...entries]
    .sort((a, b) => {
      if (a.value === "" || b.value === "") {
        if (a.value !== b.value) return a.value === "" ? 1 : -1;
      } else {
        const primary = compare(a.value, b.value) * sign;
        if (primary !== 0) return primary;
      }
      return compareCodeUnits(a.key, b.key);
    })
    .map((entry) => entry.data);
}

/** Zotero.Date.multipartToSQL yields "" for no date and "0000-00-00" for an unparsable one: both are unknown. */
export function dateSortValue(sqlDate: string): string {
  return /^0000/.test(sqlDate) ? "" : sqlDate;
}
