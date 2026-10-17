/**
 * Library / object lookup helpers over the Zotero JS API (Zotero sandbox only).
 *
 * Zotero 11 loads libraries, collections and saved searches at startup but loads ITEMS lazily per library,
 * so every item access first awaits `ensureItemsLoaded` (same approach as Zotero's own local API).
 */
import { ToolError } from "../tools/types.js";

export type ZLibrary = Zotero.Library;
export type ZItem = Zotero.Item;
export type ZCollection = Zotero.Collection;
export type ZSearch = Zotero.Search;

export function isFeedLibrary(lib: { libraryType: string }): boolean {
  return lib.libraryType === "feed";
}

/** All non-feed libraries: personal library first, then groups (Zotero's order). */
export function listNonFeedLibraries(): ZLibrary[] {
  return (Zotero.Libraries.getAll() as ZLibrary[]).filter((lib) => !isFeedLibrary(lib));
}

/** Resolve an optional libraryID argument (default: personal library). Feed libraries are supported too. */
export function resolveLibrary(libraryID?: unknown): ZLibrary {
  const id = typeof libraryID === "number" ? libraryID : Zotero.Libraries.userLibraryID;
  const lib = Zotero.Libraries.get(id) as ZLibrary | false;
  if (!lib) {
    throw new ToolError("LIBRARY_NOT_FOUND", `No library with libraryID ${id}`, { libraryID: id });
  }
  return lib;
}

export function withTimeout<T>(promise: Promise<T>, ms: number, onTimeout: () => Error): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(onTimeout()), ms);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer !== undefined) clearTimeout(timer);
  });
}

/**
 * Make sure all item data of `lib` is in memory. Optional timeout (ms) turns a slow cold load into a TIMEOUT
 * ToolError; the load itself keeps running in the background and later calls will find it finished.
 */
export async function ensureItemsLoaded(lib: ZLibrary, timeoutMs?: number): Promise<void> {
  if (lib.getDataLoaded("item")) return;
  const load = lib.waitForDataLoad("item");
  if (!timeoutMs) {
    await load;
    return;
  }
  await withTimeout(
    load,
    timeoutMs,
    () =>
      new ToolError("TIMEOUT", `Zotero is still loading items for library ${lib.libraryID}; retry shortly`, {
        libraryID: lib.libraryID,
      }),
  );
}

export function itemsLoaded(lib: ZLibrary): boolean {
  try {
    return !!lib.getDataLoaded("item");
  } catch {
    return false;
  }
}

/** Look up an item by key (items loaded first). Trashed items are returned; callers expose `deleted`. */
export async function getItemByKey(lib: ZLibrary, key: string): Promise<ZItem> {
  await ensureItemsLoaded(lib);
  const item = Zotero.Items.getByLibraryAndKey(lib.libraryID, key) as ZItem | false;
  if (!item) {
    throw new ToolError("NOT_FOUND", `No item with key ${key} in library ${lib.libraryID}`, { libraryID: lib.libraryID, key });
  }
  return item;
}

/** Synchronous item fetch by id for an already-loaded library; returns null when unknown. */
export function getLoadedItem(id: number): ZItem | null {
  try {
    const item = Zotero.Items.get(id) as ZItem | false;
    return item || null;
  } catch {
    return null;
  }
}

export function getCollectionByKey(lib: ZLibrary, key: string): ZCollection {
  const col = Zotero.Collections.getByLibraryAndKey(lib.libraryID, key) as ZCollection | false;
  if (!col) {
    throw new ToolError("NOT_FOUND", `No collection with key ${key} in library ${lib.libraryID}`, {
      libraryID: lib.libraryID,
      key,
    });
  }
  return col;
}

export function getSavedSearchByKey(lib: ZLibrary, key: string): ZSearch {
  const search = Zotero.Searches.getByLibraryAndKey(lib.libraryID, key) as ZSearch | false;
  if (!search) {
    throw new ToolError("NOT_FOUND", `No saved search with key ${key} in library ${lib.libraryID}`, {
      libraryID: lib.libraryID,
      key,
    });
  }
  return search;
}
