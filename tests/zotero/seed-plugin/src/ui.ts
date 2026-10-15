/**
 * Drives and reports the Zotero UI for the context-snapshot cases: collection tree / item selection,
 * reader tabs, the reader's page, text selection and annotation selection.
 *
 * Reader internals (_internalReader, views, _state) are private and may change between betas; they are
 * used here only to put the UI into a known state and to report it independently of the bridge.
 */
import type { ReaderUiState, UiAction, UiResult, UiState, WindowState } from "../../seed-api.js";
import { cloneJson, errorMessage, sleep, waitFor } from "./util.js";

const LIBRARY_TAB_ID = "zotero-pane";

function mainWindow(): any {
  const win = Zotero.getMainWindow() as any;
  if (!win?.ZoteroPane || !win.Zotero_Tabs) throw new Error("Zotero main window is not available");
  return win;
}

function readers(): any[] {
  return [...((Zotero.Reader as any)._readers ?? [])];
}

function activeReader(win: any): any | null {
  if (win.Zotero_Tabs.selectedType !== "reader") return null;
  return Zotero.Reader.getByTabID(win.Zotero_Tabs.selectedID) ?? null;
}

function mostRecentWindow(): any | null {
  return (Services.wm.getMostRecentWindow(null as any) as any) ?? null;
}

/** A separate reader window (no tabID) that is the most recently active Zotero window, as the bridge sees it. */
function focusedReaderWindow(): any | null {
  const recent = mostRecentWindow();
  return recent ? (readers().find((reader) => !reader.tabID && reader._window === recent) ?? null) : null;
}

function currentReader(win: any): any | null {
  return focusedReaderWindow() ?? activeReader(win);
}

function internalReader(reader: any): any {
  return reader?._internalReader ? Components.utils.waiveXrays(reader._internalReader) : null;
}

function item(libraryID: number, key: string): Zotero.Item {
  const found = Zotero.Items.getByLibraryAndKey(libraryID, key);
  if (!found) throw new Error(`Item ${libraryID}/${key} not found`);
  return found as Zotero.Item;
}

export function listWindows(): WindowState[] {
  const out: WindowState[] = [];
  const windows = Services.wm.getEnumerator(null as any);
  while (windows.hasMoreElements()) {
    const win = windows.getNext() as any;
    out.push({
      type: win.document?.documentElement?.getAttribute("windowtype") ?? null,
      title: String(win.document?.title ?? ""),
    });
  }
  return out;
}

function selectedText(ir: any, primary: boolean): string | null {
  try {
    const ranges = Array.from((ir._lastView?._selectionRanges ?? []) as any[])
      .filter((range) => !range.collapsed)
      .map((range) => String(range.text ?? ""));
    if (ranges.length && ranges.join("")) return ranges.join("\n");
  } catch {
    // Fall through to the selection popup, which views keep in reader state.
  }
  const popup = cloneJson<any>(ir._state?.[primary ? "primaryViewSelectionPopup" : "secondaryViewSelectionPopup"]);
  return popup?.annotation?.text ?? null;
}

function readerState(reader: any): ReaderUiState {
  const ir = internalReader(reader);
  const primary = ir?._lastViewPrimary !== false;
  const stats = cloneJson<any>(ir?._state?.[primary ? "primaryViewStats" : "secondaryViewStats"]) ?? {};
  const attachment = Zotero.Items.get(reader.itemID) as Zotero.Item | false;
  return {
    tabID: reader.tabID ?? null,
    inWindow: !reader.tabID,
    libraryID: attachment ? attachment.libraryID : null,
    attachmentKey: attachment ? attachment.key : null,
    readerType: reader.type ?? null,
    pageIndex: Number.isInteger(stats.pageIndex) ? stats.pageIndex : null,
    pageLabel: stats.pageLabel ?? null,
    pagesCount: Number.isInteger(stats.pagesCount) ? stats.pagesCount : null,
    selectedText: ir ? selectedText(ir, primary) : null,
    selectedAnnotationKeys: cloneJson<string[]>(ir?._state?.selectedAnnotationIDs) ?? [],
  };
}

export function uiState(): UiState {
  const windows = listWindows();
  const win = Zotero.getMainWindow() as any;
  const mostRecentWindowType = mostRecentWindow()?.document?.documentElement?.getAttribute("windowtype") ?? null;
  if (!win?.ZoteroPane || !win.Zotero_Tabs) {
    return {
      mainWindow: false,
      tab: { id: null, type: null, title: null },
      tabCount: 0,
      treeRows: [],
      selectedItems: [],
      readers: readers().length,
      reader: null,
      mostRecentWindowType,
      windows,
    };
  }
  const tabs = win.Zotero_Tabs;
  const pane = win.ZoteroPane;
  const reader = currentReader(win);
  return {
    mainWindow: true,
    tab: { id: tabs.selectedID ?? null, type: tabs.selectedType ?? null, title: tabs.getTabInfo?.(tabs.selectedID)?.title ?? null },
    tabCount: tabs.numTabs,
    treeRows: (pane.getCollectionTreeRows() as any[]).map((row) => ({
      id: String(row.id),
      type: String(row.type),
      name: String(row.getName()),
    })),
    selectedItems: (pane.getSelectedItems(false, { libraryTabOnly: true }) as Zotero.Item[]).map((i) => ({
      libraryID: i.libraryID,
      key: i.key,
    })),
    readers: readers().length,
    reader: reader ? readerState(reader) : null,
    mostRecentWindowType,
    windows,
  };
}

async function showLibraryTab(win: any): Promise<void> {
  if (win.Zotero_Tabs.selectedID !== LIBRARY_TAB_ID) win.Zotero_Tabs.select(LIBRARY_TAB_ID);
  await waitFor("library tab", () => (win.Zotero_Tabs.selectedType === "library" ? true : null), 5000);
}

async function clearItemSelection(win: any): Promise<void> {
  const view = win.ZoteroPane.itemsView;
  await view.waitForLoad();
  view.selection.clearSelection();
  await waitFor("empty item selection", () => (win.ZoteroPane.getSelectedItems(true, { libraryTabOnly: true }).length === 0 ? true : null), 5000);
}

async function selectTreeRow(win: any, rowID: string): Promise<void> {
  await showLibraryTab(win);
  const selected = await win.ZoteroPane.collectionsView.selectByID(rowID);
  if (selected === false) throw new Error(`Collection tree row ${rowID} not found`);
  await clearItemSelection(win);
}

async function waitForReaderView(reader: any): Promise<any> {
  await reader._initPromise;
  const view = await waitFor("reader view", () => internalReader(reader)?._primaryView ?? null, 20000);
  await view.initializedPromise;
  return view;
}

async function waitForPage(reader: any, pageIndex: number): Promise<void> {
  const deadline = Date.now() + 20000;
  let navigatedAgain = false;
  while (Date.now() < deadline) {
    if (readerState(reader).pageIndex === pageIndex) return;
    // The location passed to open() can be applied before the first render; re-navigate once if needed.
    if (!navigatedAgain && deadline - Date.now() < 17000) {
      await reader.navigate({ pageIndex });
      navigatedAgain = true;
    }
    await sleep(100);
  }
  throw new Error(`Reader did not reach page index ${pageIndex}`);
}

function requireReader(win: any): any {
  const reader = currentReader(win);
  if (!reader) throw new Error("No active reader tab or focused reader window");
  return reader;
}

interface ActionOutcome {
  feasible: boolean;
  reason: string | null;
  method: string | null;
}

const DONE: ActionOutcome = { feasible: true, reason: null, method: null };

/**
 * Programmatic PDF text selection: give the view a minimal anchor/head selection over the page's text
 * characters and let the view rebuild real selection ranges (the same path it uses after semantic text
 * changes), which also opens the selection popup in reader state.
 */
async function setTextSelection(win: any, pageIndex: number, length: number): Promise<ActionOutcome> {
  const reader = requireReader(win);
  if (reader.type !== "pdf") return { feasible: false, reason: `Text selection is only scripted for PDF readers (got ${reader.type})`, method: null };
  const view = await waitForReaderView(reader);
  if (typeof view._syncSelectionAfterSemanticChange !== "function" || typeof view._ensureBasicPageData !== "function") {
    return { feasible: false, reason: "PDF view lacks _syncSelectionAfterSemanticChange/_ensureBasicPageData in this build", method: null };
  }
  await view._ensureBasicPageData(pageIndex);
  const chars = view._pdfPages?.[pageIndex]?.chars;
  if (!chars?.length) return { feasible: false, reason: `No text characters extracted for page index ${pageIndex}`, method: null };
  const headOffset = Math.min(length, chars.length);
  const seedRanges = [{ collapsed: false, anchor: true, head: true, position: { pageIndex, rects: [] }, anchorOffset: 0, headOffset }];
  view._selectionRanges = Components.utils.cloneInto(seedRanges, reader._iframeWindow);
  view._syncSelectionAfterSemanticChange();
  const text = await waitFor("text selection", () => readerState(reader).selectedText || null, 5000);
  return { feasible: true, reason: null, method: `PDFView._syncSelectionAfterSemanticChange (${text.length} chars)` };
}

async function selectAnnotations(win: any, keys: string[]): Promise<ActionOutcome> {
  const reader = requireReader(win);
  await waitForReaderView(reader);
  let method: string;
  const first = keys[0];
  if (keys.length === 1 && first) {
    // Public reader API: navigating to an annotation the reader knows selects it.
    await reader.navigate({ annotationID: first });
    method = "ReaderInstance.navigate({annotationID})";
  } else {
    const ir = internalReader(reader);
    ir.setSelectedAnnotations(Components.utils.cloneInto(keys, reader._iframeWindow));
    method = "internal Reader.setSelectedAnnotations(ids)";
  }
  const wanted = [...keys].sort().join(",");
  await waitFor("annotation selection", () => ([...readerState(reader).selectedAnnotationKeys].sort().join(",") === wanted ? true : null), 10000);
  return { feasible: true, reason: null, method };
}

async function closeReaders(win: any): Promise<void> {
  for (const reader of readers()) reader.close();
  // Note tabs too (openNoteTab); the library tab cannot be closed.
  const otherTabs = ((win.Zotero_Tabs._tabs ?? []) as Array<{ id: string }>).map((tab) => tab.id).filter((id) => id !== LIBRARY_TAB_ID);
  if (otherTabs.length > 0) win.Zotero_Tabs.close(otherTabs);
  await waitFor("readers closed", () => (win.Zotero_Tabs.numTabs === 1 && readers().length === 0 ? true : null), 10000);
  await showLibraryTab(win);
}

/** Open a note in a main-window tab, as double-clicking it does with Zotero 11's default openNoteInNewWindow = false. */
async function openNoteTab(win: any, note: Zotero.Item): Promise<ActionOutcome> {
  await (Zotero as any).Notes.open(note.id, null, { openInWindow: false });
  await waitFor(
    "note tab",
    () => {
      const type = String(win.Zotero_Tabs.selectedType ?? "");
      const info = win.Zotero_Tabs.getTabInfo?.(win.Zotero_Tabs.selectedID);
      return type.startsWith("note") && info?.data?.itemID === note.id ? true : null;
    },
    20000,
  );
  return { feasible: true, reason: null, method: "Zotero.Notes.open(itemID, null, { openInWindow: false })" };
}

/**
 * Open the attachment in a separate ReaderWindow and make it the most recent window. Raising a window can be
 * refused by the OS while another application is in the foreground; that is reported as infeasible.
 */
async function openReaderWindow(attachment: Zotero.Item, pageIndex: number): Promise<ActionOutcome> {
  await Zotero.Reader.open(attachment.id, { pageIndex } as any, { openInWindow: true } as any);
  const reader = await waitFor(
    "reader window",
    () => readers().find((r) => !r.tabID && r.itemID === attachment.id && r._window) ?? null,
    20000,
  );
  await waitForReaderView(reader);
  await waitForPage(reader, pageIndex);
  reader._window.focus();
  try {
    await waitFor("reader window to become the most recent window", () => (mostRecentWindow() === reader._window ? true : null), 5000);
  } catch {
    return { feasible: false, reason: "the reader window did not become the most recent Zotero window (focus refused)", method: null };
  }
  return { feasible: true, reason: null, method: "Zotero.Reader.open(..., { openInWindow: true })" };
}

async function perform(win: any, request: UiAction): Promise<ActionOutcome> {
  switch (request.action) {
    case "report":
      return DONE;
    case "selectLibrary":
      await showLibraryTab(win);
      if (!(await win.ZoteroPane.collectionsView.selectLibrary(request.libraryID))) {
        throw new Error(`Library ${request.libraryID} not in the collection tree`);
      }
      await clearItemSelection(win);
      return DONE;
    case "selectCollection": {
      const col = Zotero.Collections.getByLibraryAndKey(request.libraryID, request.key) as Zotero.Collection | false;
      if (!col) throw new Error(`Collection ${request.key} not found`);
      await selectTreeRow(win, `C${col.id}`);
      return DONE;
    }
    case "selectSavedSearch": {
      const search = Zotero.Searches.getByLibraryAndKey(request.libraryID, request.key) as Zotero.Search | false;
      if (!search) throw new Error(`Saved search ${request.key} not found`);
      await selectTreeRow(win, `S${search.id}`);
      return DONE;
    }
    case "selectItems": {
      const ids = request.keys.map((key) => item(request.libraryID, key).id);
      if (!(await win.ZoteroPane.selectItems(ids))) throw new Error("ZoteroPane.selectItems() found no items");
      await waitFor("item selection", () => (win.ZoteroPane.getSelectedItems(true, { libraryTabOnly: true }).length === ids.length ? true : null), 10000);
      return DONE;
    }
    case "clearItemSelection":
      await showLibraryTab(win);
      await clearItemSelection(win);
      return DONE;
    case "openReader": {
      const attachment = item(request.libraryID, request.key);
      if (request.inWindow) return openReaderWindow(attachment, request.pageIndex);
      await Zotero.Reader.open(attachment.id, { pageIndex: request.pageIndex } as any);
      const reader = await waitFor("reader tab", () => {
        const active = activeReader(win);
        return active && active.itemID === attachment.id ? active : null;
      }, 20000);
      await waitForReaderView(reader);
      await waitForPage(reader, request.pageIndex);
      return DONE;
    }
    case "navigateReader": {
      const reader = requireReader(win);
      await waitForReaderView(reader);
      await reader.navigate({ pageIndex: request.pageIndex });
      await waitForPage(reader, request.pageIndex);
      return DONE;
    }
    case "setTextSelection":
      return setTextSelection(win, request.pageIndex, request.length);
    case "clearTextSelection": {
      const reader = requireReader(win);
      internalReader(reader).setSelectedAnnotations(Components.utils.cloneInto([], reader._iframeWindow));
      await waitFor("text deselection", () => (readerState(reader).selectedText ? null : true), 5000);
      return DONE;
    }
    case "selectAnnotations":
      return selectAnnotations(win, request.keys);
    case "openNoteTab":
      return openNoteTab(win, item(request.libraryID, request.key));
    case "closeReaders":
      await closeReaders(win);
      return DONE;
  }
}

export async function runUiAction(request: UiAction): Promise<UiResult> {
  const started = Date.now();
  await Zotero.uiReadyPromise;
  const win = mainWindow();
  let outcome: ActionOutcome;
  try {
    outcome = await perform(win, request);
  } catch (error) {
    if (request.action === "setTextSelection") {
      outcome = { feasible: false, reason: `Scripted text selection failed: ${errorMessage(error)}`, method: null };
    } else {
      throw error;
    }
  }
  // Let debounced reader state (stats 100 ms, view state 300 ms) settle before reporting.
  await sleep(350);
  return { ok: true, action: request.action, ...outcome, state: uiState(), ms: Date.now() - started };
}
