/**
 * Lookups shared by the data tools (Zotero sandbox only): library readiness with a bounded wait, live (non-trashed)
 * containers in Zotero's tree order, and item classification.
 */
import { compareCodeUnits } from "../tools/search-plan.js";
import { ToolError } from "../tools/types.js";
import {
  ensureItemsLoaded,
  getCollectionByKey,
  getLoadedItem,
  getSavedSearchByKey,
  resolveLibrary,
  type ZCollection,
  type ZItem,
  type ZLibrary,
  type ZSearch,
} from "./library.js";
import { safe } from "./refs.js";

/**
 * Longest a tool call waits for a cold item load. MCP clients abort tool calls after ~30 s; the load keeps running
 * in the background, so the TIMEOUT error tells the model to retry.
 */
export const ITEM_LOAD_TIMEOUT_MS = 20_000;

/** Resolve the libraryID argument (default: personal library) and make its items available synchronously. */
export async function loadLibrary(libraryID: unknown): Promise<ZLibrary> {
  const lib = resolveLibrary(libraryID);
  await ensureItemsLoaded(lib, ITEM_LOAD_TIMEOUT_MS);
  return lib;
}

export type ItemKind = "regular" | "note" | "attachment" | "annotation";

export function itemKind(item: ZItem): ItemKind {
  if (safe(() => item.isNote(), false)) return "note";
  if (safe(() => item.isAttachment(), false)) return "attachment";
  if (safe(() => item.isAnnotation(), false)) return "annotation";
  return "regular";
}

export function wrongItemType(item: ZItem, expected: string): ToolError {
  return new ToolError("WRONG_ITEM_TYPE", `Item ${item.key} is a ${itemKind(item)} item; expected ${expected}`, {
    libraryID: item.libraryID,
    key: item.key,
    itemType: safe(() => item.itemType as string, "unknown"),
  });
}

export interface ItemTypeInfo {
  id: number;
  name: string;
}

/**
 * Item type by exact internal name. Matched against the type list rather than ItemTypes.getID(), which logs
 * unknown names to Zotero's debug output; unknown names fail with a get_schema hint.
 */
export function findItemType(name: string): ItemTypeInfo {
  const types = safe(() => [...Zotero.ItemTypes.getTypes()] as ItemTypeInfo[], []);
  const type = types.find((entry) => entry.name === name);
  if (type) return type;
  const suggestion = types.find((entry) => entry.name.toLowerCase() === name.toLowerCase())?.name;
  throw new ToolError(
    "INVALID_ARGUMENT",
    `Unknown itemType${suggestion ? ` (did you mean ${suggestion}?)` : ""}; call get_schema without itemType to list valid item type names`,
    suggestion ? { suggestion } : undefined,
  );
}

/** In the trash itself, or a child of a trashed item (isInTrash() is missing from zotero-types). */
export function inTrash(item: ZItem): boolean {
  const deleted = safe(() => item.deleted, false);
  return safe(() => (item as unknown as { isInTrash(): boolean }).isInTrash(), deleted);
}

/** Items for ids, skipping ids that are not (or no longer) registered. */
export function itemsByID(ids: readonly number[]): ZItem[] {
  const items: ZItem[] = [];
  for (const id of ids) {
    const item = getLoadedItem(id);
    if (item) items.push(item);
  }
  return items;
}

/** A collection by key; trashed collections count as not found for every tool. */
export function liveCollection(lib: ZLibrary, key: string): ZCollection {
  const col = getCollectionByKey(lib, key);
  if (safe(() => col.deleted, false)) {
    throw new ToolError("NOT_FOUND", `Collection ${key} is in the trash`, { libraryID: lib.libraryID, key, deleted: true });
  }
  return col;
}

export function liveSavedSearch(lib: ZLibrary, key: string): ZSearch {
  const search = getSavedSearchByKey(lib, key);
  if (safe(() => search.deleted, false)) {
    throw new ToolError("NOT_FOUND", `Saved search ${key} is in the trash`, {
      libraryID: lib.libraryID,
      key,
      deleted: true,
    });
  }
  return search;
}

/** Tree order as in Zotero's collection pane (locale collation by name), with the key as tie-breaker. */
function sortCollections(collections: ZCollection[]): ZCollection[] {
  return collections.sort(
    (a, b) => Zotero.localeCompare(safe(() => a.name, ""), safe(() => b.name, "")) || compareCodeUnits(a.key, b.key),
  );
}

export function topLevelCollections(lib: ZLibrary): ZCollection[] {
  // getByLibrary already excludes trashed collections.
  return sortCollections(safe(() => [...Zotero.Collections.getByLibrary(lib.libraryID)], [] as ZCollection[]));
}

export function childCollections(col: ZCollection): ZCollection[] {
  return sortCollections(safe(() => [...col.getChildCollections(false, false)], [] as ZCollection[]));
}

/** Collection paths are short in practice; the cap only guards against a corrupt parent cycle. */
export const MAX_COLLECTION_DEPTH = 256;

/**
 * Zotero's "Show Items from Subcollections" view option (pref recursiveCollections): when on, a collection's
 * item list in Zotero also shows the items of all its subcollections.
 */
export function showsSubcollectionItems(): boolean {
  return safe(() => Zotero.Prefs.get("recursiveCollections") === true, false);
}

/**
 * Non-trashed top-level items in the collection (needs the library's items loaded): the items filed directly in it,
 * plus, with `includeSubcollections`, those of every non-trashed descendant collection (de-duplicated), which is
 * what Zotero's collection view shows while "Show Items from Subcollections" is on.
 */
export function collectionItems(col: ZCollection, includeSubcollections = false): ZItem[] {
  const direct = (c: ZCollection): ZItem[] => safe(() => [...c.getChildItems(false, false)], [] as ZItem[]);
  if (!includeSubcollections) return direct(col);
  const seen = new Set<number>();
  const items: ZItem[] = [];
  const visit = (c: ZCollection, depth: number): void => {
    for (const item of direct(c)) {
      if (seen.has(item.id)) continue;
      seen.add(item.id);
      items.push(item);
    }
    if (depth < MAX_COLLECTION_DEPTH) for (const child of childCollections(c)) visit(child, depth + 1);
  };
  visit(col, 0);
  return items;
}
