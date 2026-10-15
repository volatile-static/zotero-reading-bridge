/**
 * The bridge's result caches and their invalidation (Zotero sandbox only).
 *
 * Paging re-runs a tool call with a new offset; the expensive part (running a search, sorting every match, counting
 * every tag occurrence) is cached per library and request so later pages only slice. The caches hold item ids and
 * tag counts in memory only (nothing is written anywhere) and are enabled only while a Notifier observer clears them
 * on every change to items, collections, saved searches, tags or the trash, including full-text index updates
 * ('index' item events). If the observer cannot be registered the caches stay disabled and every call recomputes.
 */
import { ResultCache } from "../tools/result-cache.js";

/** Expiry is a backstop only: every relevant change clears the caches immediately. */
const CACHE_TTL_MS = 120_000;

/** Sorted item ids of search_items, run_saved_search and get_collection results. */
export const itemListCache = new ResultCache<number[]>(8, CACHE_TTL_MS);

/** Tag counts of list_tags, one entry per library. */
export const tagCountCache = new ResultCache<ReadonlyArray<{ tag: string; type: number; itemCount: number }>>(4, CACHE_TTL_MS);

const CACHES: ReadonlyArray<Pick<ResultCache<unknown>, "clear" | "enable" | "disable">> = [itemListCache, tagCountCache];

const WATCHED_TYPES: _ZoteroTypes.Notifier.Type[] = [
  "item",
  "collection",
  "collection-item",
  "search",
  "item-tag",
  "tag",
  "trash",
  "group",
];

/** Enable the caches while a change observer clears them; the returned function disables them again. */
export function startResultCaching(): () => void {
  let observerID: string;
  try {
    observerID = Zotero.Notifier.registerObserver(
      {
        notify: () => {
          for (const cache of CACHES) cache.clear();
        },
      },
      WATCHED_TYPES,
      "zotero-ai-bridge-result-cache",
    );
  } catch {
    return () => {};
  }
  for (const cache of CACHES) cache.enable();
  return () => {
    for (const cache of CACHES) cache.disable();
    try {
      Zotero.Notifier.unregisterObserver(observerID);
    } catch {
      // Zotero is shutting down; nothing left to notify.
    }
  };
}
