import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  assembleSnapshot,
  buildSnapshotId,
  clampTextLength,
  SnapshotSequencer,
  unavailableParts,
  type CaptureParts,
  type RawReaderContext,
  type SnapshotMeta,
} from "../../packages/zotero/src/context/snapshot.js";
import type { ItemRef } from "../../shared/types/tools.js";
import { SNAPSHOT_LIMITS, type LibraryViewContext, type NoteContext } from "../../shared/types/snapshot.js";

const AT = "2026-10-14T22:12:00.123Z";

function meta(overrides: Partial<SnapshotMeta> = {}): SnapshotMeta {
  return {
    client: "codex",
    sessionId: "sess-1",
    turnId: "turn-1",
    promptId: null,
    sequence: 1,
    capturedAt: AT,
    maxTextLength: SNAPSHOT_LIMITS.selectedTextDefault,
    ...overrides,
  };
}

function item(n: number): ItemRef {
  return { libraryID: 1, key: `KEY${String(n).padStart(5, "0")}`, itemID: n, itemType: "journalArticle", title: `Paper ${n}` };
}

function libraryView(overrides: Partial<LibraryViewContext> = {}): LibraryViewContext {
  return {
    libraries: [{ libraryID: 1, type: "user", name: "My Library" }],
    collections: [],
    savedSearches: [],
    otherRows: [],
    selectedItems: { count: 0, items: [], truncated: false },
    ...overrides,
  };
}

function reader(overrides: Partial<RawReaderContext> = {}): RawReaderContext {
  return {
    readerType: "pdf",
    location: "tab",
    attachment: { ...item(100), itemType: "attachment", title: "Full Text PDF", contentType: "application/pdf" },
    parentItem: item(1),
    page: { index: 4, label: "5", count: 12 },
    selectedText: null,
    selectedAnnotations: { count: 0, items: [], truncated: false },
    ...overrides,
  };
}

function parts(overrides: Partial<CaptureParts> = {}): CaptureParts {
  return {
    activeTab: { type: "library", title: null },
    libraryView: libraryView(),
    reader: null,
    note: null,
    warnings: [],
    error: null,
    ...overrides,
  };
}

function note(overrides: Partial<NoteContext> = {}): NoteContext {
  return { location: "tab", item: { ...item(200), itemType: "note", title: "Reading notes" }, parentItem: item(1), ...overrides };
}

describe("SnapshotSequencer", () => {
  it("starts at 1 and strictly increases", () => {
    const seq = new SnapshotSequencer();
    const values = Array.from({ length: 1000 }, () => seq.next());
    assert.equal(values[0], 1);
    for (let i = 1; i < values.length; i++) assert.equal(values[i], (values[i - 1] ?? 0) + 1);
  });

  it("is independent per instance (process-local counter)", () => {
    const a = new SnapshotSequencer();
    const b = new SnapshotSequencer();
    a.next();
    a.next();
    assert.equal(b.next(), 1);
    assert.equal(a.next(), 3);
  });
});

describe("buildSnapshotId", () => {
  it("Codex: client + session + turn + sequence + capture time", () => {
    const id = buildSnapshotId("codex", "019a-sess", "019a-turn", null, 7, AT);
    assert.equal(id, "codex/s:019a-sess/t:019a-turn/n:7/20261014T221200123Z");
  });

  it("Claude Code: client + session + prompt id (when present) + sequence + capture time", () => {
    assert.equal(
      buildSnapshotId("claude-code", "sess", null, "prompt-9", 3, AT),
      "claude-code/s:sess/p:prompt-9/n:3/20261014T221200123Z",
    );
    assert.equal(buildSnapshotId("claude-code", "sess", null, null, 4, AT), "claude-code/s:sess/n:4/20261014T221200123Z");
  });

  it("generic and direct calls: client + sequence + capture time", () => {
    assert.equal(buildSnapshotId("other-client", null, null, null, 1, AT), "other-client/n:1/20261014T221200123Z");
    assert.equal(buildSnapshotId(null, null, null, null, 2, AT), "direct/n:2/20261014T221200123Z");
  });

  it("replaces characters that could forge markup in the hook header", () => {
    const id = buildSnapshotId("codex", "a<b>c d", "</zotero_snapshot>", null, 1, AT);
    assert.doesNotMatch(id, /[<> ]/);
    assert.match(id, /^codex\/s:a_b_c_d\/t:__zotero_snapshot_\/n:1\//);
  });

  it("is unique per capture within a session and turn", () => {
    const seq = new SnapshotSequencer();
    const ids = new Set(Array.from({ length: 50 }, () => buildSnapshotId("codex", "s", "t", null, seq.next(), AT)));
    assert.equal(ids.size, 50);
  });
});

describe("clampTextLength", () => {
  it("defaults, clamps and floors", () => {
    assert.equal(clampTextLength(undefined), SNAPSHOT_LIMITS.selectedTextDefault);
    assert.equal(clampTextLength("100"), SNAPSHOT_LIMITS.selectedTextDefault);
    assert.equal(clampTextLength(Number.NaN), SNAPSHOT_LIMITS.selectedTextDefault);
    assert.equal(clampTextLength(-5), 0);
    assert.equal(clampTextLength(10.9), 10);
    assert.equal(clampTextLength(10_000_000), SNAPSHOT_LIMITS.selectedTextMax);
  });
});

describe("assembleSnapshot status and focus", () => {
  it("unavailable when the capture produced nothing", () => {
    const snap = assembleSnapshot(unavailableParts("the Zotero main window is not open"), meta());
    assert.equal(snap.status, "unavailable");
    assert.equal(snap.focus, "none");
    assert.equal(snap.unavailableReason, "the Zotero main window is not open");
    assert.equal(snap.libraryView, null);
    assert.equal(snap.reader, null);
    assert.deepEqual(snap.activeTab, { type: "none", title: null });
  });

  it("empty when only the library root is selected; the library row is kept", () => {
    const snap = assembleSnapshot(parts(), meta());
    assert.equal(snap.status, "empty");
    assert.equal(snap.focus, "none");
    assert.equal(snap.unavailableReason, null);
    assert.deepEqual(snap.libraryView?.libraries, [{ libraryID: 1, type: "user", name: "My Library" }]);
  });

  it("empty for virtual rows (Trash, Unfiled) without selected items", () => {
    const snap = assembleSnapshot(parts({ libraryView: libraryView({ libraries: [], otherRows: ["trash:1"] }) }), meta());
    assert.equal(snap.status, "empty");
  });

  it("empty when nothing was captured but no error was reported", () => {
    const snap = assembleSnapshot(parts({ libraryView: null }), meta());
    assert.equal(snap.status, "empty");
  });

  it("ok with library focus for a single selected item", () => {
    const view = libraryView({ selectedItems: { count: 1, items: [item(1)], truncated: false } });
    const snap = assembleSnapshot(parts({ libraryView: view }), meta());
    assert.equal(snap.status, "ok");
    assert.equal(snap.focus, "library");
  });

  it("ok with library focus for a multi-selection, keeping the exact count", () => {
    const listed = Array.from({ length: SNAPSHOT_LIMITS.selectedItems }, (_, i) => item(i + 1));
    const view = libraryView({ selectedItems: { count: 37, items: listed, truncated: true } });
    const snap = assembleSnapshot(parts({ libraryView: view }), meta());
    assert.equal(snap.status, "ok");
    assert.equal(snap.focus, "library");
    assert.equal(snap.libraryView?.selectedItems.count, 37);
    assert.equal(snap.libraryView?.selectedItems.items.length, SNAPSHOT_LIMITS.selectedItems);
    assert.equal(snap.libraryView?.selectedItems.truncated, true);
  });

  it("ok without focus when only a collection or saved search is selected", () => {
    const collection = { libraryID: 1, key: "COLL0001", collectionID: 5, name: "Reading", parentKey: null };
    const search = { libraryID: 1, key: "SRCH0001", searchID: 2, name: "Unread" };
    for (const view of [libraryView({ libraries: [], collections: [collection] }), libraryView({ libraries: [], savedSearches: [search] })]) {
      const snap = assembleSnapshot(parts({ libraryView: view }), meta());
      assert.equal(snap.status, "ok");
      assert.equal(snap.focus, "none");
    }
  });

  it("reader focus wins over selected items", () => {
    const view = libraryView({ selectedItems: { count: 2, items: [item(1), item(2)], truncated: false } });
    const snap = assembleSnapshot(
      parts({ activeTab: { type: "reader", title: "Paper 1" }, libraryView: view, reader: reader() }),
      meta(),
    );
    assert.equal(snap.status, "ok");
    assert.equal(snap.focus, "reader");
    assert.deepEqual(snap.reader?.page, { index: 4, label: "5", count: 12 });
  });

  it("a separate reader window counts as reader focus", () => {
    const snap = assembleSnapshot(parts({ reader: reader({ location: "window" }) }), meta());
    assert.equal(snap.focus, "reader");
    assert.equal(snap.reader?.location, "window");
  });

  it("a reader alone is ok even when the library pane failed (partial capture keeps the reason)", () => {
    const snap = assembleSnapshot(
      parts({ libraryView: null, reader: reader(), error: "the Zotero library pane could not be read" }),
      meta(),
    );
    assert.equal(snap.status, "ok");
    assert.equal(snap.focus, "reader");
    assert.equal(snap.unavailableReason, "the Zotero library pane could not be read");
  });

  it("a note tab is ok with note focus; the hidden library tab's selection is not the focus", () => {
    const view = libraryView({ selectedItems: { count: 1, items: [item(7)], truncated: false } });
    const snap = assembleSnapshot(parts({ activeTab: { type: "note", title: "Reading notes" }, libraryView: view, note: note() }), meta());
    assert.equal(snap.status, "ok");
    assert.equal(snap.focus, "note");
    assert.equal(snap.note?.item.key, "KEY00200");
    assert.equal(snap.note?.parentItem?.key, "KEY00001");
  });

  it("a note, reader or other tab whose content could not be read is ok with focus none, never 'nothing open'", () => {
    const view = libraryView({ selectedItems: { count: 1, items: [item(7)], truncated: false } });
    for (const type of ["note", "reader", "other"] as const) {
      const selected = assembleSnapshot(parts({ activeTab: { type, title: "x" }, libraryView: view }), meta());
      assert.equal(selected.status, "ok", type);
      assert.equal(selected.focus, "none", `${type}: the library tab's selection must not become the focus`);
      const nothing = assembleSnapshot(parts({ activeTab: { type, title: "x" } }), meta());
      assert.equal(nothing.status, "ok", `${type}: something is open`);
    }
  });

  it("a focused separate window wins: reader window over a note tab, note window over a reader tab", () => {
    const readerWindow = assembleSnapshot(
      parts({ activeTab: { type: "note", title: null }, reader: reader({ location: "window" }), note: note() }),
      meta(),
    );
    assert.equal(readerWindow.focus, "reader");
    const noteWindow = assembleSnapshot(
      parts({ activeTab: { type: "reader", title: null }, reader: reader(), note: note({ location: "window" }) }),
      meta(),
    );
    assert.equal(noteWindow.focus, "note");
    assert.equal(noteWindow.note?.location, "window");
  });

  it("keeps the active tab and library view when only the reader lookup failed or timed out", () => {
    const view = libraryView({ selectedItems: { count: 2, items: [item(1), item(2)], truncated: false } });
    const snap = assembleSnapshot(
      parts({
        activeTab: { type: "reader", title: "Paper 1" },
        libraryView: view,
        error: "the open reader or note could not be read within 2500 ms",
      }),
      meta(),
    );
    assert.equal(snap.status, "ok");
    assert.equal(snap.focus, "none");
    assert.deepEqual(snap.activeTab, { type: "reader", title: "Paper 1" });
    assert.equal(snap.libraryView?.selectedItems.count, 2);
    assert.equal(snap.unavailableReason, "the open reader or note could not be read within 2500 ms");
  });

  it("a reader window read while the main window is closed is ok (library view unknown)", () => {
    const snap = assembleSnapshot(
      parts({
        activeTab: { type: "none", title: null },
        libraryView: null,
        reader: reader({ location: "window" }),
        warnings: ["The Zotero main window is closed: only the focused reader or note window was read (no library selection)."],
      }),
      meta(),
    );
    assert.equal(snap.status, "ok");
    assert.equal(snap.focus, "reader");
    assert.equal(snap.libraryView, null);
  });

  it("no stale reader: a snapshot without reader parts has reader null", () => {
    const withReader = assembleSnapshot(parts({ reader: reader() }), meta({ sequence: 1 }));
    const afterClose = assembleSnapshot(parts(), meta({ sequence: 2 }));
    assert.notEqual(withReader.reader, null);
    assert.equal(afterClose.reader, null);
    assert.notEqual(withReader.snapshotId, afterClose.snapshotId);
  });
});

describe("assembleSnapshot fields and selected text", () => {
  it("copies ids, sequence and capture time and keeps capture warnings", () => {
    const snap = assembleSnapshot(
      parts({ warnings: ["Reader page is the last saved reading position, not live view state."] }),
      meta({ client: "claude-code", sessionId: "s", turnId: null, promptId: "p", sequence: 42 }),
    );
    assert.equal(snap.schemaVersion, 1);
    assert.equal(snap.client, "claude-code");
    assert.equal(snap.sessionId, "s");
    assert.equal(snap.turnId, null);
    assert.equal(snap.promptId, "p");
    assert.equal(snap.sequence, 42);
    assert.equal(snap.capturedAt, AT);
    assert.equal(snap.snapshotId, "claude-code/s:s/p:p/n:42/20261014T221200123Z");
    assert.deepEqual(snap.warnings, ["Reader page is the last saved reading position, not live view state."]);
  });

  it("trims selected text and drops whitespace-only selections", () => {
    const kept = assembleSnapshot(parts({ reader: reader({ selectedText: "  \n quoted passage \n" }) }), meta());
    assert.deepEqual(kept.reader?.selectedText, { text: "quoted passage", length: 14, truncated: false });
    const blank = assembleSnapshot(parts({ reader: reader({ selectedText: " \n\t " }) }), meta());
    assert.equal(blank.reader?.selectedText, null);
  });

  it("truncates selected text to maxTextLength with a marker and a warning", () => {
    const text = "研究".repeat(3000);
    const snap = assembleSnapshot(parts({ reader: reader({ selectedText: text }) }), meta({ maxTextLength: 100 }));
    assert.deepEqual(snap.reader?.selectedText, { text: text.slice(0, 100), length: 6000, truncated: true });
    assert.ok(snap.warnings.some((w) => w.includes("100 of 6000")));
  });

  it("never splits a surrogate pair when truncating", () => {
    const text = "a" + "😀".repeat(10);
    const snap = assembleSnapshot(parts({ reader: reader({ selectedText: text }) }), meta({ maxTextLength: 4 }));
    const kept = snap.reader?.selectedText?.text ?? "";
    assert.equal(kept, "a😀");
    assert.equal(snap.reader?.selectedText?.length, text.length);
  });

  it("maxTextLength 0 reports that a selection exists without its content", () => {
    const snap = assembleSnapshot(parts({ reader: reader({ selectedText: "secret" }) }), meta({ maxTextLength: 0 }));
    assert.deepEqual(snap.reader?.selectedText, { text: "", length: 6, truncated: true });
  });

  it("does not mutate the capture parts", () => {
    const input = parts({ reader: reader({ selectedText: "x".repeat(50) }), warnings: ["w"] });
    const before = JSON.stringify(input);
    assembleSnapshot(input, meta({ maxTextLength: 10 }));
    assert.equal(JSON.stringify(input), before);
  });
});
