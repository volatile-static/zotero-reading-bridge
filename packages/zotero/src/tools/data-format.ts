/**
 * Pure shaping of Zotero data into tool results (no Zotero globals; unit-tested in Node).
 * Inputs are plain values already read from Zotero objects (toJSON output, getTags(), saved-search conditions).
 */
import type { CreatorInfo, TagInfo } from "../../../../shared/types/tools.js";
import { truncateText } from "../util/text.js";

/** Characters kept of an annotation's text or comment (get_annotations and get_items alike). */
export const ANNOTATION_TEXT_MAX = 50_000;

/**
 * Free-text fields capped in get_items `fields` (annotation items only): a pathological highlight cannot flood a
 * 50-key response. A cut value ends with "…"; get_annotations returns the same text under the same cap.
 */
const CAPPED_FIELDS: Readonly<Record<string, number>> = {
  annotationText: ANNOTATION_TEXT_MAX,
  annotationComment: ANNOTATION_TEXT_MAX,
};

/**
 * toJSON keys that are not bibliographic fields: identity/bookkeeping, structures returned separately, and bulky
 * content served by dedicated tools (note and attachment-note HTML via get_notes, annotation positions via
 * get_annotations).
 */
const NON_FIELD_KEYS = new Set([
  "key",
  "version",
  "itemType",
  "parentItem",
  "creators",
  "tags",
  "collections",
  "relations",
  "deleted",
  "inPublications",
  "dateAdded",
  "dateModified",
  "note",
  "annotationPosition",
]);

/** Non-empty scalar fields of an item's toJSON() output, stringified (annotation text and comment capped). */
export function itemFieldsFromJSON(json: Record<string, unknown>): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const [name, value] of Object.entries(json)) {
    if (NON_FIELD_KEYS.has(name)) continue;
    if (typeof value === "string") {
      const cap = CAPPED_FIELDS[name];
      if (value === "") continue;
      fields[name] = cap !== undefined && value.length > cap ? `${truncateText(value, cap - 1).text}…` : value;
    } else if (typeof value === "number" || typeof value === "boolean") {
      fields[name] = String(value);
    }
  }
  return fields;
}

/** Creators from toJSON() ({creatorType, firstName, lastName} or {creatorType, name}). */
export function creatorInfos(value: unknown): CreatorInfo[] {
  if (!Array.isArray(value)) return [];
  const creators: CreatorInfo[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object") continue;
    const raw = entry as Record<string, unknown>;
    const creator: CreatorInfo = { creatorType: typeof raw.creatorType === "string" ? raw.creatorType : "author" };
    if (typeof raw.name === "string") {
      creator.name = raw.name;
    } else {
      if (typeof raw.firstName === "string") creator.firstName = raw.firstName;
      if (typeof raw.lastName === "string") creator.lastName = raw.lastName;
    }
    creators.push(creator);
  }
  return creators;
}

/** Relations from toJSON() ({predicate: uri | uri[]}), dropping malformed entries. */
export function relationsFromJSON(value: unknown): Record<string, string | string[]> {
  const relations: Record<string, string | string[]> = {};
  if (!value || typeof value !== "object" || Array.isArray(value)) return relations;
  for (const [predicate, target] of Object.entries(value as Record<string, unknown>)) {
    if (typeof target === "string") {
      relations[predicate] = target;
    } else if (Array.isArray(target)) {
      const uris = target.filter((uri): uri is string => typeof uri === "string");
      if (uris.length > 0) relations[predicate] = uris;
    }
  }
  return relations;
}

/** item.getTags() entries; Zotero omits `type` for manual tags and may store it as a string. */
export function tagInfos(tags: ReadonlyArray<{ tag: string; type?: number | string }>): TagInfo[] {
  return tags.map((entry) => ({ tag: entry.tag, type: Number(entry.type) === 1 ? 1 : 0 }));
}

/**
 * 0-based page index of an annotation: from a PDF position's pageIndex, else from a PDF sortIndex
 * ("PPPPP|OOOOOO|TTTTT"). EPUB and snapshot annotations have no page index.
 */
export function annotationPageIndex(position: unknown, sortIndex: string | null): number | null {
  if (position && typeof position === "object") {
    const pageIndex = (position as { pageIndex?: unknown }).pageIndex;
    if (typeof pageIndex === "number" && Number.isInteger(pageIndex) && pageIndex >= 0) return pageIndex;
  }
  const match = sortIndex ? /^(\d{5})\|\d{6}\|\d{5}$/.exec(sortIndex) : null;
  return match?.[1] !== undefined ? Number(match[1]) : null;
}

/** Case-insensitive substring match (NFC + lowercase, so composed/decomposed accents compare equal). */
export function containsFolded(haystack: string, needle: string): boolean {
  return haystack.normalize("NFC").toLowerCase().includes(needle.normalize("NFC").toLowerCase());
}

/** A saved-search condition as returned by Zotero.Search#getConditions(). */
export interface SearchConditionLike {
  condition: string;
  mode?: string | false | null;
  operator: string;
  value?: unknown;
}

/** Special conditions that toggle search behaviour (operator "true"/"false") rather than match a value. */
const FLAG_CONDITIONS = new Set([
  "deleted",
  "includeDeleted",
  "noChildren",
  "unfiled",
  "retracted",
  "publications",
  "feed",
  "includeParentsAndChildren",
  "includeParents",
  "includeChildren",
  "recursive",
]);

const VALUELESS_OPERATORS = new Set(["isEmpty", "isNotEmpty"]);

interface ConditionGroup {
  join: "AND" | "OR";
  joinSet: boolean;
  level: string | null;
  parts: string[];
}

function newGroup(): ConditionGroup {
  return { join: "AND", joinSet: false, level: null, parts: [] };
}

function renderGroup(group: ConditionGroup): string {
  const body = group.parts.join(` ${group.join} `);
  if (!body) return "";
  return group.level ? `[${group.level} level] ${body}` : body;
}

/**
 * Readable one-line summary of saved-search conditions, using Zotero's internal (English) condition names:
 * `title contains "x" AND (tag is "a" OR tag is "b") [recursive]`. Mirrors Zotero 11 semantics: the first
 * joinMode in a group decides AND/OR, groupStart/groupEnd nest, resultLevel tags a group's item level.
 */
export function summarizeSearchConditions(conditions: readonly SearchConditionLike[], maxLength = 1000): string {
  const root = newGroup();
  const stack: ConditionGroup[] = [root];
  const flags: string[] = [];
  const closeGroup = (): void => {
    const done = stack.pop();
    const parent = stack[stack.length - 1];
    if (!done || !parent) return;
    const text = renderGroup(done);
    if (text) parent.parts.push(done.parts.length > 1 || done.level ? `(${text})` : text);
  };

  for (const condition of conditions) {
    const group = stack[stack.length - 1] ?? root;
    switch (condition.condition) {
      case "groupStart":
        stack.push(newGroup());
        continue;
      case "groupEnd":
        if (stack.length > 1) closeGroup();
        continue;
      case "joinMode":
        if (!group.joinSet) {
          group.join = condition.operator === "any" ? "OR" : "AND";
          group.joinSet = true;
        }
        continue;
      case "resultLevel":
        group.level = condition.operator;
        continue;
    }
    if (FLAG_CONDITIONS.has(condition.condition)) {
      if (condition.operator === "true" && !flags.includes(condition.condition)) flags.push(condition.condition);
      continue;
    }
    const name = condition.mode ? `${condition.condition}/${condition.mode}` : condition.condition;
    group.parts.push(
      VALUELESS_OPERATORS.has(condition.operator)
        ? `${name} ${condition.operator}`
        : `${name} ${condition.operator} ${JSON.stringify(String(condition.value ?? ""))}`,
    );
  }
  while (stack.length > 1) closeGroup();

  let summary = renderGroup(root) || "(no conditions: matches all items)";
  if (flags.length > 0) summary += ` [${flags.join(", ")}]`;
  if (summary.length <= maxLength) return summary;
  return `${truncateText(summary, Math.max(0, maxLength - 1)).text}…`;
}
