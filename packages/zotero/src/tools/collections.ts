/**
 * Collections and saved searches (Zotero sandbox only): list_collections, get_collection, list_saved_searches,
 * run_saved_search. Trashed collections and searches are never listed and count as not found.
 */
import type { ToolName } from "../../../../shared/types/tool-names.js";
import type { CollectionInfo, CollectionRef, SavedSearchRef } from "../../../../shared/types/tools.js";
import { ensureItemsLoaded, resolveLibrary, type ZCollection, type ZLibrary, type ZSearch } from "../zotero/library.js";
import {
  childCollections,
  collectionItems,
  ITEM_LOAD_TIMEOUT_MS,
  liveCollection,
  liveSavedSearch,
  loadLibrary,
  MAX_COLLECTION_DEPTH,
  showsSubcollectionItems,
  topLevelCollections,
} from "../zotero/lookup.js";
import {
  collectionRef,
  collectionSelectURI,
  itemSummary,
  libraryPrefix,
  safe,
  savedSearchRef,
} from "../zotero/refs.js";
import { cachedItemList, savedSearchItems, sortItems } from "../zotero/search.js";
import { boolArg, optionalKey, requireKey } from "./data-args.js";
import { summarizeSearchConditions, type SearchConditionLike } from "./data-format.js";
import { paginateMapped, parsePageArgs } from "./pagination.js";
import { compareCodeUnits } from "./search-plan.js";
import { json, type ToolArgs, type ToolHandler, type ToolOutput } from "./types.js";

/**
 * get_collection lists at most this many direct subcollections (each with its own counts); the collection's
 * childCollectionCount has the total and list_collections(parentKey) pages through all of them.
 */
const SUBCOLLECTIONS_LIMIT = 50;

interface SavedSearchInfo extends SavedSearchRef {
  /** Readable summary of the search conditions (Zotero's internal condition names). */
  conditions: string;
  uri: string;
}

/**
 * `itemCount` counts what Zotero's collection view shows: direct members, plus the items of every subcollection
 * while "Show Items from Subcollections" is on (`includeSubcollections`), like search_items(collectionKey).
 */
function collectionInfo(col: ZCollection, depth: number, itemCount: { includeSubcollections: boolean } | null): CollectionInfo {
  const info: CollectionInfo = {
    ...collectionRef(col),
    depth,
    childCollectionCount: childCollections(col).length,
    uri: collectionSelectURI(col.libraryID, col.key),
  };
  if (itemCount) info.itemCount = collectionItems(col, itemCount.includeSubcollections).length;
  return info;
}

/** Depth-first flattening in tree order; depth is relative to the listing's starting point. */
function flatten(roots: readonly ZCollection[], recursive: boolean): Array<{ col: ZCollection; depth: number }> {
  const out: Array<{ col: ZCollection; depth: number }> = [];
  const visit = (col: ZCollection, depth: number): void => {
    out.push({ col, depth });
    if (recursive && depth < MAX_COLLECTION_DEPTH) {
      for (const child of childCollections(col)) visit(child, depth + 1);
    }
  };
  for (const root of roots) visit(root, 0);
  return out;
}

/** Ancestors from the library root down to `col` (inclusive). */
function collectionPath(lib: ZLibrary, col: ZCollection): CollectionRef[] {
  const path: ZCollection[] = [col];
  let current = col;
  while (path.length < MAX_COLLECTION_DEPTH) {
    const parentKey = safe(() => (current.parentKey as string | false) || null, null);
    const parent = parentKey ? (Zotero.Collections.getByLibraryAndKey(lib.libraryID, parentKey) as ZCollection | false) : false;
    if (!parent) break;
    path.unshift(parent);
    current = parent;
  }
  return path.map(collectionRef);
}

async function listCollections(args: ToolArgs): Promise<ToolOutput> {
  const page = parsePageArgs(args);
  const lib = resolveLibrary(args.libraryID);
  const parentKey = optionalKey(args, "parentKey");
  const withItemCounts = boolArg(args, "includeItemCounts", true);
  const roots = parentKey === null ? topLevelCollections(lib) : childCollections(liveCollection(lib, parentKey));
  const entries = flatten(roots, boolArg(args, "recursive", false));
  // Collection membership resolves item objects, which exist only once the library's items are loaded.
  if (withItemCounts) await ensureItemsLoaded(lib, ITEM_LOAD_TIMEOUT_MS);
  const counts = withItemCounts ? { includeSubcollections: showsSubcollectionItems() } : null;
  return json(await paginateMapped(entries, page, (entry) => collectionInfo(entry.col, entry.depth, counts)));
}

async function getCollection(args: ToolArgs): Promise<ToolOutput> {
  const page = parsePageArgs(args);
  const lib = await loadLibrary(args.libraryID);
  const col = liveCollection(lib, requireKey(args));
  const path = collectionPath(lib, col);
  const depth = path.length - 1;
  // Same item set as Zotero's collection view and search_items(collectionKey): follows the view option.
  const includeSubcollections = showsSubcollectionItems();
  const counts = { includeSubcollections };
  let items = null;
  if (boolArg(args, "includeItems", true)) {
    const key = ["collection", lib.libraryID, col.key, includeSubcollections].join("\u0000");
    const sorted = await cachedItemList(key, async () =>
      sortItems(collectionItems(col, includeSubcollections), "dateModified", "desc"),
    );
    items = await paginateMapped(sorted, page, (item) => itemSummary(item, { childCounts: true }));
  }
  const children = childCollections(col);
  return json({
    collection: collectionInfo(col, depth, counts),
    path,
    includesSubcollections: includeSubcollections,
    subcollections: children.slice(0, SUBCOLLECTIONS_LIMIT).map((child) => collectionInfo(child, depth + 1, counts)),
    subcollectionsTruncated: children.length > SUBCOLLECTIONS_LIMIT,
    items,
  });
}

/** Name of the collection or saved search a condition refers to by key, or null. */
function referencedName(libraryID: number, condition: string, key: string): string | null {
  const target =
    condition === "collection"
      ? (Zotero.Collections.getByLibraryAndKey(libraryID, key) as ZCollection | false)
      : condition === "savedSearch"
        ? (Zotero.Searches.getByLibraryAndKey(libraryID, key) as ZSearch | false)
        : false;
  return target ? target.name : null;
}

/** Condition list with collection/saved-search keys expanded to "Name (KEY)" for readability. */
function searchConditions(search: ZSearch): SearchConditionLike[] {
  const conditions = safe(() => Object.values(search.getConditions()) as unknown as SearchConditionLike[], []);
  return conditions.map((condition) => {
    const key = typeof condition.value === "string" ? condition.value : "";
    const name = key ? safe(() => referencedName(search.libraryID, condition.condition, key), null) : null;
    return name === null ? condition : { ...condition, value: `${name} (${key})` };
  });
}

function savedSearchInfo(search: ZSearch): SavedSearchInfo {
  return {
    ...savedSearchRef(search),
    conditions: summarizeSearchConditions(searchConditions(search)),
    uri: `zotero://select/${libraryPrefix(search.libraryID)}/searches/${search.key}`,
  };
}

async function listSavedSearches(args: ToolArgs): Promise<ToolOutput> {
  const page = parsePageArgs(args);
  const lib = resolveLibrary(args.libraryID);
  // Searches.getByLibrary (sync, includes trashed) is missing from zotero-types.
  const searches = safe(
    () => (Zotero.Searches as unknown as { getByLibrary(libraryID: number): ZSearch[] }).getByLibrary(lib.libraryID),
    [] as ZSearch[],
  )
    .filter((search) => !safe(() => search.deleted, false))
    // Collection-pane order (locale collation by name); the key breaks ties so pages never overlap.
    .sort((a, b) => Zotero.localeCompare(safe(() => a.name, ""), safe(() => b.name, "")) || compareCodeUnits(a.key, b.key));
  return json(await paginateMapped(searches, page, savedSearchInfo));
}

async function runSavedSearch(args: ToolArgs): Promise<ToolOutput> {
  const page = parsePageArgs(args);
  const lib = await loadLibrary(args.libraryID);
  const search = liveSavedSearch(lib, requireKey(args));
  const items = await savedSearchItems(search);
  return json({
    search: savedSearchRef(search),
    ...(await paginateMapped(items, page, (item) => itemSummary(item, { childCounts: true }))),
  });
}

export const collectionHandlers = {
  list_collections: listCollections,
  get_collection: getCollection,
  list_saved_searches: listSavedSearches,
  run_saved_search: runSavedSearch,
} satisfies Partial<Record<ToolName, ToolHandler>>;
