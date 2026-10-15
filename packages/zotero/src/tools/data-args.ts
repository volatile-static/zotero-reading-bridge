/**
 * Pure argument readers for the data tools (no Zotero globals; unit-tested in Node).
 * Arguments are schema-validated and defaulted before handlers run; these readers still check types so a
 * contract/validator drift degrades to a clear INVALID_ARGUMENT instead of a Zotero exception.
 */
import { stripBidiIsolates } from "../util/text.js";
import type { ToolArgs } from "./types.js";
import { ToolError } from "./types.js";

/** Zotero object keys: 8 chars from Zotero's key alphabet (no 0, 1, O). */
export const OBJECT_KEY_RE = /^[23456789ABCDEFGHIJKLMNPQRSTUVWXYZ]{8}$/;

export function requireKey(args: ToolArgs, name = "key"): string {
  const value = args[name];
  if (typeof value !== "string" || !OBJECT_KEY_RE.test(value)) {
    throw new ToolError("INVALID_ARGUMENT", `${name} must be an 8-character Zotero key`, { argument: name });
  }
  return value;
}

export function optionalKey(args: ToolArgs, name: string): string | null {
  return args[name] === undefined ? null : requireKey(args, name);
}

/** De-duplicated list of object keys, in request order. */
export function keyList(args: ToolArgs, name: string, max: number): string[] {
  const value = args[name];
  if (!Array.isArray(value) || value.length === 0 || value.length > max) {
    throw new ToolError("INVALID_ARGUMENT", `${name} must be a list of 1-${max} Zotero keys`, { argument: name });
  }
  const keys: string[] = [];
  for (const entry of value) {
    if (typeof entry !== "string" || !OBJECT_KEY_RE.test(entry)) {
      throw new ToolError("INVALID_ARGUMENT", `${name} must contain only 8-character Zotero keys`, { argument: name });
    }
    if (!keys.includes(entry)) keys.push(entry);
  }
  return keys;
}

export function boolArg(args: ToolArgs, name: string, fallback: boolean): boolean {
  const value = args[name];
  return typeof value === "boolean" ? value : fallback;
}

/** Integer argument clamped to [min, max]; non-integers fall back to the default. */
export function intArg(args: ToolArgs, name: string, fallback: number, min: number, max: number): number {
  const value = args[name];
  if (typeof value !== "number" || !Number.isInteger(value)) return fallback;
  return Math.min(Math.max(value, min), max);
}

/** Trimmed non-empty string or null. */
export function textArg(args: ToolArgs, name: string): string | null {
  const value = args[name];
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

/** Subset of `allowed` named in a string-array argument; null when the argument is absent (= no filter). */
export function enumSet<T extends string>(args: ToolArgs, name: string, allowed: readonly T[]): Set<T> | null {
  const value = args[name];
  if (value === undefined) return null;
  if (!Array.isArray(value)) {
    throw new ToolError("INVALID_ARGUMENT", `${name} must be a list`, { argument: name });
  }
  const result = new Set<T>();
  for (const entry of value) {
    if (typeof entry !== "string" || !(allowed as readonly string[]).includes(entry)) {
      throw new ToolError("INVALID_ARGUMENT", `${name} may only contain: ${allowed.join(", ")}`, { argument: name });
    }
    result.add(entry as T);
  }
  return result;
}

function enumArg<T extends string>(args: ToolArgs, name: string, allowed: readonly T[], fallback: T): T {
  const value = args[name];
  return typeof value === "string" && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

export const SEARCH_MODES = ["titleCreatorYear", "fields", "everything", "fulltext"] as const;
export type SearchMode = (typeof SEARCH_MODES)[number];

export const SORT_FIELDS = ["dateModified", "dateAdded", "title", "date"] as const;
export type SortField = (typeof SORT_FIELDS)[number];

export const SORT_DIRECTIONS = ["asc", "desc"] as const;
export type SortDirection = (typeof SORT_DIRECTIONS)[number];

/** search_items arguments after normalization. */
export interface SearchRequest {
  query: string | null;
  mode: SearchMode;
  /** Exact tag names; every one must match. */
  tags: string[];
  creator: string | null;
  itemType: string | null;
  collectionKey: string | null;
  includeChildItems: boolean;
  sort: SortField;
  direction: SortDirection;
}

/**
 * Search text without invisible bidi isolates: Zotero's own creator summaries contain them, so text a model copies
 * from one (e.g. a last name) would otherwise match nothing.
 */
function searchText(args: ToolArgs, name: string): string | null {
  const value = args[name];
  return typeof value === "string" ? textArg({ [name]: stripBidiIsolates(value) }, name) : null;
}

export function hasSearchFilters(request: SearchRequest): boolean {
  return request.tags.length > 0 || request.creator !== null || request.itemType !== null || request.collectionKey !== null;
}

export function normalizeSearchArgs(args: ToolArgs): SearchRequest {
  const tags: string[] = [];
  if (Array.isArray(args.tags)) {
    for (const entry of args.tags) {
      // Zotero trims tag names on save, so surrounding whitespace can never match.
      const tag = typeof entry === "string" ? entry.trim() : "";
      if (tag && !tags.includes(tag)) tags.push(tag);
    }
  }
  const request: SearchRequest = {
    query: searchText(args, "query"),
    mode: enumArg(args, "mode", SEARCH_MODES, "titleCreatorYear"),
    tags,
    creator: searchText(args, "creator"),
    itemType: textArg(args, "itemType"),
    collectionKey: optionalKey(args, "collectionKey"),
    includeChildItems: boolArg(args, "includeChildItems", false),
    sort: enumArg(args, "sort", SORT_FIELDS, "dateModified"),
    direction: enumArg(args, "direction", SORT_DIRECTIONS, "desc"),
  };
  if (request.query === null && !hasSearchFilters(request)) {
    throw new ToolError(
      "INVALID_ARGUMENT",
      "Provide a query or at least one filter (tags, creator, itemType, collectionKey)",
    );
  }
  return request;
}
