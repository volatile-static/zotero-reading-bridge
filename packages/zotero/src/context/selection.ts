/**
 * Live capture of the Zotero UI state (Zotero only): active tab, collection tree and item selection, the open note
 * (a note tab or a focused separate note window) and the active reader (a reader tab or a focused separate reader
 * window) with page, selected text and selected annotations. Produces raw CaptureParts; snapshot.ts turns them
 * into a ContextSnapshot.
 *
 * Reader internals (_internalReader, _state, _lastView, ...) are private to the zotero/reader bundle and live in
 * the reader iframe's content compartment: every access is wrapped, Xrays are waived defensively and values are
 * JSON-cloned before use. Nothing here awaits a library's cold item load (the hook has a 5 s budget).
 */
import {
  SNAPSHOT_LIMITS,
  type ActiveTabType,
  type LibraryViewContext,
  type NoteContext,
  type ReaderPage,
  type SnapshotAnnotations,
  type SnapshotItems,
} from "../../../../shared/types/snapshot.js";
import type { AnnotationRef } from "../../../../shared/types/tools.js";
import {
  getLoadedItem,
  withTimeout,
  type ZCollection,
  type ZItem,
  type ZLibrary,
  type ZSearch,
} from "../zotero/library.js";
import { annotationRef, collectionRef, itemRef, libraryRef, safe, savedSearchRef } from "../zotero/refs.js";
import { unavailableParts, type CaptureParts, type RawReaderContext } from "./snapshot.js";

// Narrow views of main-window globals (zoteroPane.js, tabs.js, collectionTreeRow.js); only what is used here.
interface TabEntry {
  id?: string;
  title?: unknown;
  data?: { itemID?: unknown };
}

interface TabsLike {
  readonly selectedID: string;
  readonly selectedType: string;
  getTabInfo(tabID?: string): TabEntry | undefined;
  /** Private tab list; read only when getTabInfo() throws. */
  _tabs?: TabEntry[];
}

interface TreeRowLike {
  type: string;
  ref: unknown;
  isLibrary(includeGlobal?: boolean): boolean;
  isGroup(): boolean;
  isCollection(): boolean;
  isSearch(): boolean;
}

interface PaneLike {
  getCollectionTreeRows(): TreeRowLike[];
  getSelectedItems(asIDs?: boolean, options?: { libraryTabOnly?: boolean }): ZItem[];
}

interface MainWindowLike {
  Zotero_Tabs?: TabsLike;
  ZoteroPane?: PaneLike;
}

/** ReaderTab / ReaderWindow from xpcom/reader.js. */
interface ReaderLike {
  tabID?: string;
  type?: string;
  itemID?: number;
  _item?: ZItem;
  _window?: unknown;
  _internalReader?: unknown;
}

interface ViewStats {
  pageIndex?: unknown;
  pageLabel?: unknown;
  pagesCount?: unknown;
}

interface SelectionPopup {
  annotation?: { text?: unknown };
}

interface ReaderInternals {
  stats: ViewStats | null;
  selectedText: string | null;
  annotationKeys: string[];
  readable: boolean;
}

const NO_INTERNALS: ReaderInternals = { stats: null, selectedText: null, annotationKeys: [], readable: false };

/** Defensive Xray waiver (objects reached through _internalReader are already waived; waiving is idempotent). */
function waive<T>(value: T): T {
  if (value === null || typeof value !== "object") return value;
  try {
    return Components.utils.waiveXrays(value) as T;
  } catch {
    return value;
  }
}

/** Copy a content-compartment value out as plain JSON data (null when absent or not serializable). */
function plain<T>(value: unknown): T | null {
  if (value === null || value === undefined) return null;
  try {
    return JSON.parse(JSON.stringify(value)) as T;
  } catch {
    return null;
  }
}

function intOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) ? value : null;
}

/** "reader-unloaded" -> "reader" etc., like Zotero_Tabs.parseTabType(). */
function activeTabType(type: string | null): ActiveTabType {
  if (!type) return "none";
  const base = type.split("-")[0];
  return base === "library" || base === "reader" || base === "note" ? base : "other";
}

function tabEntry(tabs: TabsLike, tabID: string): TabEntry | null {
  // getTabInfo() also resolves the tab's item, which throws while that library's items are still unloaded
  // (restored reader tabs); the private tab list carries the same title and data without that lookup.
  return (
    safe(() => tabs.getTabInfo(tabID) ?? null, null) ??
    safe(() => tabs._tabs?.find((tab) => tab.id === tabID) ?? null, null)
  );
}

function librarySelection(pane: PaneLike, tabType: ActiveTabType): ZItem[] {
  // Zotero 11 returns the items-tree selection for {libraryTabOnly: true} whatever tab is active. A signature
  // without the option would return the reader's parent item instead, so then trust it only in the library tab.
  const supportsLibraryTabOnly = safe(() => String(pane.getSelectedItems).includes("libraryTabOnly"), false);
  if (supportsLibraryTabOnly) return pane.getSelectedItems(false, { libraryTabOnly: true });
  return tabType === "library" ? pane.getSelectedItems(false) : [];
}

function selectedItems(pane: PaneLike, tabType: ActiveTabType): SnapshotItems {
  const items = librarySelection(pane, tabType);
  const refs = items.slice(0, SNAPSHOT_LIMITS.selectedItems).map(itemRef);
  return { count: items.length, items: refs, truncated: items.length > refs.length };
}

function otherRowKind(row: TreeRowLike): string {
  const type = safe(() => String(row.type), "unknown");
  const libraryID = safe(() => (row.ref as { libraryID?: unknown } | null)?.libraryID, undefined);
  return typeof libraryID === "number" ? `${type}:${libraryID}` : type;
}

function captureLibraryView(pane: PaneLike, tabType: ActiveTabType, warnings: string[]): LibraryViewContext {
  const view: LibraryViewContext = {
    libraries: [],
    collections: [],
    savedSearches: [],
    otherRows: [],
    selectedItems: selectedItems(pane, tabType),
  };
  let omitted = 0;
  const add = <T>(list: T[], make: () => T): void => {
    if (list.length >= SNAPSHOT_LIMITS.treeRows) {
      omitted++;
      return;
    }
    try {
      list.push(make());
    } catch {
      omitted++;
    }
  };
  // Plural getter: the singular ones throw on beta builds and on multi-row selection.
  for (const row of pane.getCollectionTreeRows()) {
    if (!row) continue;
    if (safe(() => row.isCollection(), false)) add(view.collections, () => collectionRef(row.ref as ZCollection));
    else if (safe(() => row.isSearch(), false)) add(view.savedSearches, () => savedSearchRef(row.ref as ZSearch));
    else if (safe(() => row.isLibrary(false) || row.isGroup(), false)) add(view.libraries, () => libraryRef(row.ref as ZLibrary));
    else add(view.otherRows, () => otherRowKind(row));
  }
  if (omitted > 0) warnings.push(`${omitted} selected collection tree row(s) not listed.`);
  return view;
}

/** Item by id without waiting for a cold library load: in-memory object, else primary data from the DB. */
async function loadItem(itemID: unknown): Promise<ZItem | null> {
  if (typeof itemID !== "number") return null;
  const loaded = getLoadedItem(itemID);
  if (loaded) return loaded;
  try {
    return (await Zotero.Items.getAsync(itemID)) || null;
  } catch {
    return null;
  }
}

/** The most recently active Zotero window when it is a separate reader or note window (else both null). */
interface FocusedWindow {
  reader: ReaderLike | null;
  noteItemID: number | null;
}

/** Separate note windows (note.xhtml, windowtype "zotero:note") are named "zotero-note-<itemID>" by note.js. */
function noteWindowItemID(win: unknown): number | null {
  const w = win as { name?: unknown; document?: { documentElement?: { getAttribute(name: string): string | null } | null } };
  const type = safe(() => w.document?.documentElement?.getAttribute("windowtype") ?? null, null);
  if (type !== "zotero:note") return null;
  const match = /^zotero-note-(\d+)$/.exec(safe(() => String(w.name ?? ""), ""));
  return match ? Number(match[1]) : null;
}

/**
 * A separate reader window has no tabID; it, or a separate note window, counts when it is the most recently active
 * Zotero window. Works without the main window (reader and note windows outlive it).
 */
function focusedWindow(): FocusedWindow {
  const wm = Services.wm as unknown as { getMostRecentWindow(type: string | null): unknown };
  const recent = safe(() => wm.getMostRecentWindow(null), null);
  if (!recent) return { reader: null, noteItemID: null };
  const readers = safe(() => (Zotero.Reader as unknown as { _readers: ReaderLike[] })._readers, []);
  const reader = safe(() => readers.find((r) => !r.tabID && r._window === recent) ?? null, null);
  return { reader, noteItemID: reader ? null : noteWindowItemID(recent) };
}

function readSelectedText(view: any, popup: SelectionPopup | null): string | null {
  // PDF: the complete multi-page selection (same as the reader's getTextFromSelectionRanges); the popup
  // annotation only holds the first two pages.
  const fromRanges = safe(() => {
    const ranges = view._selectionRanges;
    const count = Number(ranges?.length) || 0;
    if (!count || ranges[0].collapsed) return "";
    const texts: string[] = [];
    for (let i = 0; i < count; i++) texts.push(String(ranges[i]?.text ?? ""));
    return texts.join("\n");
  }, "");
  if (fromRanges.trim()) return fromRanges;
  const fromPopup = popup?.annotation?.text;
  if (typeof fromPopup === "string" && fromPopup.trim()) return fromPopup;
  // EPUB, snapshot and Reading Mode views keep a real DOM selection in the view's iframe.
  const fromDom = safe(() => String(waive(view._iframeWindow).getSelection()?.toString() ?? ""), "");
  return fromDom.trim() ? fromDom : null;
}

function readInternals(reader: ReaderLike): ReaderInternals {
  // `any`: private, untyped objects of the zotero/reader bundle; their shape can change in any beta.
  const internal: any = safe(() => waive(reader._internalReader), null);
  const state: any = internal ? safe(() => waive(internal._state), null) : null;
  if (!state) return NO_INTERNALS;
  // The split view the user last interacted with (Zotero's own getSelectionPosition() keys on it).
  const prefix = safe(() => internal._lastViewPrimary !== false, true) ? "primary" : "secondary";
  const stats = plain<ViewStats>(safe(() => state[`${prefix}ViewStats`], null));
  const popup = plain<SelectionPopup>(safe(() => state[`${prefix}ViewSelectionPopup`], null));
  const view: any = safe(() => waive(internal._lastView), null);
  // Reader annotation ids are the annotation items' keys.
  const keys = plain<unknown[]>(safe(() => state.selectedAnnotationIDs, null));
  return {
    stats,
    selectedText: readSelectedText(view, popup),
    annotationKeys: Array.isArray(keys) ? keys.filter((key): key is string => typeof key === "string") : [],
    readable: true,
  };
}

function readerPage(stats: ViewStats | null, attachment: ZItem, readerType: string, warnings: string[]): ReaderPage | null {
  const index = intOrNull(stats?.pageIndex);
  const label = typeof stats?.pageLabel === "string" && stats.pageLabel ? stats.pageLabel : null;
  const count = intOrNull(stats?.pagesCount);
  if (index !== null || label !== null || count !== null) return { index, label, count };
  // Only PDFs store a page index as the last position (EPUB stores a CFI, snapshots a scroll percentage).
  if (readerType !== "pdf") return null;
  const last = intOrNull(safe(() => attachment.getAttachmentLastPageIndex() as unknown, null));
  if (last === null) return null;
  warnings.push("Reader page is the last saved reading position, not live view state.");
  return { index: last, label: null, count: null };
}

function selectedAnnotations(attachment: ZItem, keys: string[], warnings: string[]): SnapshotAnnotations {
  const wanted = keys.slice(0, SNAPSHOT_LIMITS.selectedAnnotations);
  const items: AnnotationRef[] = [];
  for (const key of wanted) {
    const annotation = safe(() => Zotero.Items.getByLibraryAndKey(attachment.libraryID, key) as ZItem | false, false);
    if (annotation && safe(() => annotation.isAnnotation(), false)) {
      items.push(annotationRef(annotation, SNAPSHOT_LIMITS.annotationText));
    }
  }
  if (items.length < wanted.length) warnings.push("Some selected annotations could not be resolved.");
  return { count: keys.length, items, truncated: keys.length > items.length };
}

async function readerContext(
  attachment: ZItem,
  readerType: string,
  location: RawReaderContext["location"],
  internals: ReaderInternals,
  warnings: string[],
): Promise<RawReaderContext> {
  const parentID = safe(() => attachment.parentItemID, false);
  const parent = parentID ? await loadItem(parentID) : null;
  return {
    readerType,
    location,
    attachment: { ...itemRef(attachment), contentType: safe(() => attachment.attachmentContentType || null, null) },
    parentItem: parent ? itemRef(parent) : null,
    page: readerPage(internals.stats, attachment, readerType, warnings),
    selectedText: internals.selectedText,
    selectedAnnotations: selectedAnnotations(attachment, internals.annotationKeys, warnings),
  };
}

function readerTypeOf(reader: ReaderLike | null, attachment: ZItem): string {
  return safe(() => reader?.type || attachment.attachmentReaderType || "unknown", "unknown");
}

async function captureReader(
  tabs: TabsLike | null,
  tabID: string | null,
  tabType: ActiveTabType,
  windowReader: ReaderLike | null,
  warnings: string[],
): Promise<RawReaderContext | null> {
  const reader =
    windowReader ??
    (tabType === "reader" && tabID
      ? safe(() => (Zotero.Reader.getByTabID(tabID) as unknown as ReaderLike | undefined) ?? null, null)
      : null);
  const location = windowReader ? "window" : "tab";

  if (reader) {
    const attachment = safe(() => reader._item ?? null, null) ?? (await loadItem(safe(() => reader.itemID, undefined)));
    if (!attachment) {
      warnings.push("The open reader's attachment could not be resolved.");
      return null;
    }
    const internals = readInternals(reader);
    if (!internals.readable) warnings.push("Reader view state was not readable; page, selection and annotations may be missing.");
    return readerContext(attachment, readerTypeOf(reader, attachment), location, internals, warnings);
  }

  // A reader tab that is not loaded yet (e.g. restored at startup): only its attachment is known.
  if (tabType !== "reader" || !tabs || !tabID) return null;
  const attachment = await loadItem(tabEntry(tabs, tabID)?.data?.itemID);
  if (!attachment) return null;
  warnings.push("The reader tab is not loaded yet; selection and annotations are unknown.");
  return readerContext(attachment, readerTypeOf(null, attachment), "tab", NO_INTERNALS, warnings);
}

/**
 * The note of a focused separate note window, else of the active note tab (a reader tab and a note tab are never
 * active together). Zotero 11 opens notes in main-window tabs by default (openNoteInNewWindow = false).
 */
async function captureNote(
  tabs: TabsLike | null,
  tabID: string | null,
  tabType: ActiveTabType,
  windowNoteID: number | null,
  warnings: string[],
): Promise<NoteContext | null> {
  const location = windowNoteID !== null ? "window" : "tab";
  const itemID = windowNoteID ?? (tabType === "note" && tabs && tabID ? tabEntry(tabs, tabID)?.data?.itemID : undefined);
  if (itemID === undefined || itemID === null) return null;
  const note = await loadItem(itemID);
  if (!note || !safe(() => note.isNote(), false)) {
    warnings.push(`The note open in the ${location === "window" ? "focused note window" : "active tab"} could not be resolved.`);
    return null;
  }
  const parentID = safe(() => note.parentItemID, false);
  const parent = parentID ? await loadItem(parentID) : null;
  return { location, item: itemRef(note), parentItem: parent ? itemRef(parent) : null };
}

interface OpenContentParts {
  reader: RawReaderContext | null;
  note: NoteContext | null;
  warnings: string[];
  errors: string[];
}

/** Reader and note lookups: the only part of a capture that may await (item lookups from the database). */
async function captureOpenContent(
  tabs: TabsLike | null,
  tabID: string | null,
  tabType: ActiveTabType,
  focused: FocusedWindow,
): Promise<OpenContentParts> {
  const parts: OpenContentParts = { reader: null, note: null, warnings: [], errors: [] };
  try {
    parts.reader = await captureReader(tabs, tabID, tabType, focused.reader, parts.warnings);
  } catch {
    parts.errors.push("the active reader could not be read");
  }
  try {
    parts.note = await captureNote(tabs, tabID, tabType, focused.noteItemID, parts.warnings);
  } catch {
    parts.errors.push("the open note could not be read");
  }
  return parts;
}

class LookupTimeout extends Error {}

/**
 * Race the reader/note lookups against what is left of the capture budget. On timeout the synchronous parts
 * (active tab, library view) captured before are kept and the lookup is reported as an error; the abandoned
 * lookup only reads and writes into its own arrays, so it cannot change the returned parts later.
 */
async function openContentWithin(
  lookup: Promise<OpenContentParts>,
  deadline: number,
  timeoutMs: number,
): Promise<OpenContentParts> {
  try {
    return await withTimeout(lookup, Math.max(0, deadline - Date.now()), () => new LookupTimeout());
  } catch (error) {
    const reason =
      error instanceof LookupTimeout
        ? `the open reader or note could not be read within ${timeoutMs} ms`
        : "the open reader or note could not be read";
    return { reader: null, note: null, warnings: [], errors: [reason] };
  }
}

/**
 * Capture everything the snapshot needs within `timeoutMs` (only the reader/note lookups can wait). Errors are
 * reported in the parts, never thrown for partial failures.
 */
export async function captureParts(timeoutMs: number): Promise<CaptureParts> {
  const deadline = Date.now() + timeoutMs;
  const focused = focusedWindow();
  const win = safe(() => (Zotero.getMainWindow() as unknown as MainWindowLike | null) ?? null, null);
  if (!win) return captureWithoutMainWindow(focused, deadline, timeoutMs);

  const warnings: string[] = [];
  const errors: string[] = [];
  const tabs = safe(() => win.Zotero_Tabs ?? null, null);
  const tabID = tabs ? safe(() => tabs.selectedID || null, null) : null;
  const tabType = activeTabType(tabs ? safe(() => String(tabs.selectedType), null) : null);
  const title = tabs && tabID ? tabEntry(tabs, tabID)?.title : null;
  const activeTab = { type: tabType, title: typeof title === "string" && title ? title : null };

  const pane = safe(() => win.ZoteroPane ?? null, null);
  const libraryView = pane ? safe(() => captureLibraryView(pane, tabType, warnings), null) : null;
  if (!libraryView) errors.push("the Zotero library pane could not be read");

  const open = await openContentWithin(captureOpenContent(tabs, tabID, tabType, focused), deadline, timeoutMs);
  warnings.push(...open.warnings);
  errors.push(...open.errors);
  return {
    activeTab,
    libraryView,
    reader: open.reader,
    note: open.note,
    warnings,
    error: errors.length ? errors.join("; ") : null,
  };
}

/**
 * Closing the main window does not close separate reader or note windows, and Zotero keeps serving: read the
 * focused one instead of reporting the whole state as unavailable.
 */
async function captureWithoutMainWindow(focused: FocusedWindow, deadline: number, timeoutMs: number): Promise<CaptureParts> {
  if (!focused.reader && focused.noteItemID === null) return unavailableParts("the Zotero main window is not open");
  const open = await openContentWithin(captureOpenContent(null, null, "none", focused), deadline, timeoutMs);
  if (!open.reader && !open.note) {
    return unavailableParts(["the Zotero main window is not open", ...open.errors].join("; "));
  }
  return {
    activeTab: { type: "none", title: null },
    libraryView: null,
    reader: open.reader,
    note: open.note,
    warnings: ["The Zotero main window is closed: only the focused reader or note window was read (no library selection).", ...open.warnings],
    error: open.errors.length ? open.errors.join("; ") : null,
  };
}
