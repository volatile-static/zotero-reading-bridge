/**
 * UI-driving cases (no bridge needed): prove the seed plugin can put Zotero into each state the context
 * cases rely on, and report that state independently of the bridge.
 */
import assert from "node:assert/strict";
import { PDF_FIRST_PAGE_LABEL, PDF_PAGES } from "../fixtures/data.js";
import { pageText } from "../fixtures/pdf.js";
import type { UiResult } from "../seed-api.js";
import { SkipCase, fixtureKey, fixtureKeys, requireManifest, type HarnessContext, type TestCase } from "./types.js";

export function normalizeSpaces(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** Library tab, user library root selected, no items selected, no reader open. */
export async function resetUi(ctx: HarnessContext): Promise<UiResult> {
  await ctx.seed.ui({ action: "closeReaders" });
  return ctx.seed.ui({ action: "selectLibrary", libraryID: requireManifest(ctx).userLibraryID });
}

export async function openFixtureReader(ctx: HarnessContext, pageIndex: number, inWindow = false): Promise<UiResult> {
  const manifest = requireManifest(ctx);
  return ctx.seed.ui({ action: "openReader", libraryID: manifest.userLibraryID, key: fixtureKey(ctx, "att-stored-pdf"), pageIndex, inWindow });
}

/** Separate reader window on page 2, or a skip when the OS would not let it become the active window. */
export async function openFixtureReaderWindow(ctx: HarnessContext): Promise<UiResult> {
  await resetUi(ctx);
  const result = await openFixtureReader(ctx, 1, true);
  if (!result.feasible) {
    await ctx.seed.ui({ action: "closeReaders" });
    throw new SkipCase(result.reason ?? "reader window not feasible");
  }
  return result;
}

/** Selected text must be a run of the page's text layer (PDF.js may join lines with spaces or newlines). */
export function assertSelectionFromPage(selected: string | null | undefined, pageIndex: number): void {
  assert.ok(selected, "no text is selected");
  const page = normalizeSpaces(pageText(pageIndex));
  assert.ok(page.includes(normalizeSpaces(selected)), `selected text ${JSON.stringify(selected)} is not on page ${pageIndex}`);
}

export const uiCases: TestCase[] = [
  {
    id: "ui.library-root",
    title: "Select the user library root with no items selected",
    requires: ["fixtures"],
    async run(ctx) {
      const result = await resetUi(ctx);
      assert.equal(result.state.tab.type, "library");
      assert.equal(result.state.reader, null);
      assert.deepEqual(result.state.selectedItems, []);
      assert.equal(result.state.treeRows[0]?.type, "library", `tree rows ${JSON.stringify(result.state.treeRows)}`);
      return { treeRows: result.state.treeRows, ms: result.ms };
    },
  },
  {
    id: "ui.collection-and-search",
    title: "Select a collection row, then a saved-search row",
    requires: ["fixtures"],
    async run(ctx) {
      const libraryID = requireManifest(ctx).userLibraryID;
      const col = await ctx.seed.ui({ action: "selectCollection", libraryID, key: fixtureKey(ctx, "col-child") });
      assert.deepEqual(col.state.treeRows.map((r) => r.type), ["collection"]);
      const search = await ctx.seed.ui({ action: "selectSavedSearch", libraryID, key: fixtureKey(ctx, "search-fixture-tag") });
      assert.deepEqual(search.state.treeRows.map((r) => r.type), ["search"]);
      return { collectionRow: col.state.treeRows, searchRow: search.state.treeRows };
    },
  },
  {
    id: "ui.select-items",
    title: "Select one item, then three items, in the library tab",
    requires: ["fixtures"],
    async run(ctx) {
      const libraryID = requireManifest(ctx).userLibraryID;
      await resetUi(ctx);
      const one = await ctx.seed.ui({ action: "selectItems", libraryID, keys: fixtureKeys(ctx, ["item-zh-article"]) });
      assert.deepEqual(one.state.selectedItems.map((i) => i.key), fixtureKeys(ctx, ["item-zh-article"]));
      const ids = ["item-zh-article", "item-en-book", "item-mixed"];
      const three = await ctx.seed.ui({ action: "selectItems", libraryID, keys: fixtureKeys(ctx, ids) });
      assert.deepEqual(three.state.selectedItems.map((i) => i.key).sort(), fixtureKeys(ctx, ids).sort());
      return { single: one.state.selectedItems, multi: three.state.selectedItems };
    },
  },
  {
    id: "ui.reader",
    title: "Open the fixture PDF in a reader tab on page 2 and navigate to page 3",
    requires: ["fixtures"],
    timeoutMs: 90000,
    async run(ctx) {
      await resetUi(ctx);
      const opened = await openFixtureReader(ctx, 1);
      const reader = opened.state.reader;
      assert.ok(reader, `no active reader: ${JSON.stringify(opened.state.tab)}`);
      assert.equal(opened.state.tab.type, "reader");
      assert.equal(reader.attachmentKey, fixtureKey(ctx, "att-stored-pdf"));
      assert.equal(reader.readerType, "pdf");
      assert.equal(reader.pageIndex, 1);
      assert.equal(reader.pageLabel, String(PDF_FIRST_PAGE_LABEL + 1));
      assert.equal(reader.pagesCount, PDF_PAGES.length);
      const moved = await ctx.seed.ui({ action: "navigateReader", pageIndex: 2 });
      assert.equal(moved.state.reader?.pageIndex, 2);
      return { opened: reader, openMs: opened.ms, navigated: moved.state.reader };
    },
  },
  {
    id: "ui.text-selection",
    title: "Scripted text selection in the PDF reader",
    requires: ["fixtures"],
    timeoutMs: 90000,
    async run(ctx) {
      await ctx.seed.ui({ action: "closeReaders" });
      await openFixtureReader(ctx, 0);
      const result = await ctx.seed.ui({ action: "setTextSelection", pageIndex: 0, length: 24 });
      if (!result.feasible) throw new SkipCase(result.reason ?? "text selection not feasible");
      assertSelectionFromPage(result.state.reader?.selectedText, 0);
      const cleared = await ctx.seed.ui({ action: "clearTextSelection" });
      assert.equal(cleared.state.reader?.selectedText ?? null, null, "selection not cleared");
      return { method: result.method, selectedText: result.state.reader?.selectedText };
    },
  },
  {
    id: "ui.annotation-selection",
    title: "Select one annotation, then two, in the reader",
    requires: ["fixtures"],
    timeoutMs: 90000,
    async run(ctx) {
      await ctx.seed.ui({ action: "closeReaders" });
      await openFixtureReader(ctx, 0);
      const single = fixtureKeys(ctx, ["ann-highlight"]);
      const one = await ctx.seed.ui({ action: "selectAnnotations", keys: single });
      assert.deepEqual(one.state.reader?.selectedAnnotationKeys, single);
      const pair = fixtureKeys(ctx, ["ann-highlight", "ann-text"]);
      const two = await ctx.seed.ui({ action: "selectAnnotations", keys: pair });
      assert.deepEqual([...(two.state.reader?.selectedAnnotationKeys ?? [])].sort(), [...pair].sort());
      return { singleMethod: one.method, multiMethod: two.method };
    },
  },
  {
    id: "ui.reader-window",
    title: "Open the fixture PDF in a separate reader window that becomes the most recent window",
    requires: ["fixtures"],
    timeoutMs: 90000,
    async run(ctx) {
      const result = await openFixtureReaderWindow(ctx);
      try {
        assert.equal(result.state.mostRecentWindowType, "zotero:reader");
        assert.equal(result.state.reader?.inWindow, true);
        assert.equal(result.state.reader?.attachmentKey, fixtureKey(ctx, "att-stored-pdf"));
        assert.equal(result.state.reader?.pageIndex, 1);
        assert.equal(result.state.tab.type, "library", "the main window keeps its library tab");
        return { method: result.method, windows: result.state.windows };
      } finally {
        await ctx.seed.ui({ action: "closeReaders" });
      }
    },
  },
  {
    id: "ui.close-readers",
    title: "Closing every reader returns to the library tab",
    requires: ["fixtures"],
    async run(ctx) {
      const result = await ctx.seed.ui({ action: "closeReaders" });
      assert.equal(result.state.readers, 0);
      assert.equal(result.state.reader, null);
      assert.equal(result.state.tab.type, "library");
      assert.equal(result.state.tabCount, 1);
      return { tab: result.state.tab };
    },
  },
];
