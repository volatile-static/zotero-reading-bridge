/**
 * Item searches over Zotero 11's search engine (Zotero sandbox only). Builds Zotero.Search objects from the pure
 * plan in tools/search-plan.ts and turns raw result ids into a de-duplicated, sorted item list.
 *
 * Zotero.Search#search() only reads: besides SELECTs it creates and drops connection-local TEMPORARY tables
 * when a scope is set (xpcom/data/search.js).
 */
import { hasSearchFilters, type SearchRequest, type SortDirection, type SortField } from "../tools/data-args.js";
import {
  contentTermProblem,
  dateSortValue,
  filterConditions,
  queryConditions,
  sortEntries,
  type SearchCondition,
  type SearchTerm,
} from "../tools/search-plan.js";
import { ToolError } from "../tools/types.js";
import { getLoadedItem, type ZItem, type ZLibrary, type ZSearch } from "./library.js";
import { findItemType, inTrash, itemsByID, liveCollection, showsSubcollectionItems } from "./lookup.js";
import { safe } from "./refs.js";
import { itemListCache } from "./result-caches.js";

/**
 * Zotero 11 search APIs that zotero-types lacks or types too narrowly (condition/operator unions predate
 * resultLevel and the new quicksearch modes).
 */
interface ConditionTarget {
  addCondition(condition: string, operator: string, value?: string): unknown;
}
interface Z11SearchApis {
  SearchConditions: { parseSearchString(text: string): SearchTerm[] };
  FullText: { canSearchContent(text: string): boolean };
}
const z11 = (): Z11SearchApis => Zotero as unknown as Z11SearchApis;

function newSearch(libraryID: number, conditions: readonly SearchCondition[]): ZSearch {
  // Always library-scoped: a library-less Zotero.Search spans every library, feeds included.
  const search = new Zotero.Search({ libraryID });
  const target = search as unknown as ConditionTarget;
  for (const condition of conditions) {
    target.addCondition(condition.condition, condition.operator, condition.value);
  }
  return search;
}

/**
 * Result rows -> items: drop unregistered and trashed rows, report child matches (notes, attachments,
 * annotations) under their top-level item unless `includeChildItems`, and de-duplicate (search() may repeat ids).
 */
export function resultItems(ids: readonly number[], includeChildItems: boolean): ZItem[] {
  const seen = new Set<number>();
  const items: ZItem[] = [];
  for (const id of ids) {
    const row = getLoadedItem(id);
    if (!row || inTrash(row)) continue;
    const item = includeChildItems ? row : safe(() => row.topLevelItem, row);
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    items.push(item);
  }
  return items;
}

function sortValue(item: ZItem, sort: SortField): string {
  switch (sort) {
    case "dateAdded":
      return safe(() => item.dateAdded, "");
    case "dateModified":
      return safe(() => item.dateModified, "");
    case "title":
      return safe(() => Zotero.Items.getSortTitle(item.getDisplayTitle()), "");
    case "date":
      return dateSortValue(safe(() => Zotero.Date.multipartToSQL(item.getField("date", true, true)), ""));
  }
}

/** Sort like Zotero's local API (dates as SQL strings, titles via getSortTitle + locale collation). */
export function sortItems(items: readonly ZItem[], sort: SortField, direction: SortDirection): ZItem[] {
  const entries = items.map((item) => ({ value: sortValue(item, sort), key: item.key, data: item }));
  return sortEntries(entries, direction, sort === "title" ? (a, b) => Zotero.localeCompare(a, b) : undefined);
}

/**
 * A sorted item list through the result cache (src/zotero/result-caches.ts): later pages of the same request reuse
 * the ids instead of re-running the search and sort. `key` must identify everything the list depends on.
 */
export async function cachedItemList(key: string, compute: () => Promise<ZItem[]>): Promise<ZItem[]> {
  if (!itemListCache.enabled) return compute();
  const ids = await itemListCache.getOrCompute(key, async () => (await compute()).map((item) => item.id));
  return itemsByID(ids);
}

/**
 * search_items: filters go into a scope search (top-level rows), the text query into an outer search whose scope
 * also admits the scope items' children, which is how Zotero's own items list combines a collection with a quick
 * search (xpcom/collectionTreeRow.js getSearchObject). The library's items must be loaded.
 */
export async function searchLibraryItems(lib: ZLibrary, request: SearchRequest): Promise<ZItem[]> {
  const recursiveCollections = showsSubcollectionItems();
  const key = ["search", lib.libraryID, recursiveCollections, JSON.stringify(request)].join("\u0000");
  return cachedItemList(key, () => runSearch(lib, request, recursiveCollections));
}

async function runSearch(lib: ZLibrary, request: SearchRequest, recursiveCollections: boolean): Promise<ZItem[]> {
  // Validate up front: an unknown type or trashed collection would otherwise just match nothing.
  if (request.itemType !== null) findItemType(request.itemType);
  if (request.collectionKey !== null) liveCollection(lib, request.collectionKey);

  const scope = hasSearchFilters(request)
    ? newSearch(lib.libraryID, filterConditions(request, recursiveCollections))
    : null;
  const query =
    request.query === null
      ? []
      : queryConditions(
          request.mode,
          request.query,
          z11().SearchConditions.parseSearchString(request.query),
          // Zotero's own predicate decides; the pure mirror only stands in if the API is missing in this build.
          (text) => safe(() => z11().FullText.canSearchContent(text), contentTermProblem(text) === null),
        );

  let ids: number[];
  if (query.length > 0) {
    const search = newSearch(lib.libraryID, query);
    if (scope) search.setScope(scope, true);
    ids = await search.search();
  } else if (scope) {
    ids = await scope.search();
  } else {
    throw new ToolError("INVALID_ARGUMENT", "The query contains no searchable words");
  }
  return sortItems(resultItems(ids, request.includeChildItems), request.sort, request.direction);
}

/**
 * Run a saved search as Zotero defines it; child matches are reported under their top-level item. Sorted by
 * dateModified, newest first, and cached like search_items.
 */
export async function savedSearchItems(search: ZSearch): Promise<ZItem[]> {
  const key = ["savedSearch", search.libraryID, search.key].join("\u0000");
  return cachedItemList(key, async () => {
    let ids: number[];
    try {
      ids = await search.search();
    } catch {
      throw new ToolError("UNAVAILABLE", `Zotero could not run saved search ${search.key}`, {
        libraryID: search.libraryID,
        key: search.key,
      });
    }
    return sortItems(resultItems(ids, false), "dateModified", "desc");
  });
}
