/**
 * Live context capture (DESIGN 2.D): snapshots for each UI state the seed plugin can produce, the exact
 * hook output contract (shared/types/hook.ts), id/sequence composition and capture latency.
 */
import assert from "node:assert/strict";
import { SNAPSHOT_LIMITS, SNAPSHOT_SCHEMA_VERSION, type ContextSnapshot } from "../../../shared/types/snapshot.js";
import { PDF_FIRST_PAGE_LABEL, PDF_PAGES } from "../fixtures/data.js";
import type { McpClient } from "../lib/mcp.js";
import { SkipCase, fixtureKey, fixtureKeys, requireManifest, type HarnessContext, type TestCase } from "./types.js";
import { assertSelectionFromPage, normalizeSpaces, openFixtureReader, openFixtureReaderWindow, resetUi } from "./ui.js";

const SNAPSHOT_OPEN = "<zotero_snapshot>";
const SNAPSHOT_CLOSE = "</zotero_snapshot>";
/** DESIGN 2.G performance target for one capture on the fixture library. */
const CAPTURE_BUDGET_MS = 1000;

async function snapshot(ctx: HarnessContext, args: Record<string, unknown> = {}): Promise<ContextSnapshot> {
  const snap = (await ctx.mcp().tool("get_current_context", args)) as ContextSnapshot;
  assert.equal(snap.schemaVersion, SNAPSHOT_SCHEMA_VERSION);
  assert.equal(snap.client, null);
  assert.ok(!Number.isNaN(Date.parse(snap.capturedAt)), "capturedAt");
  assert.ok(Array.isArray(snap.warnings), "warnings");
  assert.notEqual(snap.status, "unavailable", `capture unavailable: ${snap.unavailableReason}`);
  return snap;
}

interface HookCapture {
  additionalContext: string;
  snapshot: ContextSnapshot;
  ms: number;
}

/** Calls capture_prompt_context and checks the exact single-key hook JSON (Codex deny_unknown_fields). */
export async function captureHook(client: McpClient, args: Record<string, unknown>): Promise<HookCapture> {
  const call = await client.callTool("capture_prompt_context", args);
  assert.equal(call.isError, false, `capture_prompt_context isError: ${call.text.slice(0, 300)}`);
  const output = call.json;
  assert.deepEqual(Object.keys(output ?? {}), ["hookSpecificOutput"], "hook output keys");
  assert.deepEqual(Object.keys(output.hookSpecificOutput).sort(), ["additionalContext", "hookEventName"], "hookSpecificOutput keys");
  assert.equal(output.hookSpecificOutput.hookEventName, "UserPromptSubmit");
  const additionalContext: string = output.hookSpecificOutput.additionalContext;
  assert.equal(typeof additionalContext, "string");
  assert.ok(additionalContext.length <= SNAPSHOT_LIMITS.hookContextChars, `additionalContext ${additionalContext.length} chars`);
  // Codex (and unknown clients) count UTF-8 bytes: their budget is checked too.
  if (args["client"] !== "claude-code") {
    const bytes = Buffer.byteLength(additionalContext, "utf8");
    assert.ok(bytes <= SNAPSHOT_LIMITS.hookContextUtf8Bytes, `additionalContext ${bytes} UTF-8 bytes`);
  }
  // The rules and notice may mention the tag names; the data block is the trailing open tag/JSON/close tag.
  const open = `\n${SNAPSHOT_OPEN}\n`;
  const close = `\n${SNAPSHOT_CLOSE}`;
  const start = additionalContext.lastIndexOf(open);
  assert.ok(start >= 0 && additionalContext.endsWith(close), "snapshot block missing at the end of additionalContext");
  const snap = JSON.parse(additionalContext.slice(start + open.length, additionalContext.length - close.length)) as ContextSnapshot;
  assert.ok(additionalContext.slice(0, start).includes(snap.snapshotId), "header must name this snapshot");
  return { additionalContext, snapshot: snap, ms: call.ms };
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

export const contextCases: TestCase[] = [
  {
    id: "context.empty",
    title: "Library root selected, nothing else: status empty, focus none, no reader",
    requires: ["bridge", "fixtures"],
    async run(ctx) {
      await resetUi(ctx);
      const snap = await snapshot(ctx);
      assert.equal(snap.status, "empty");
      assert.equal(snap.focus, "none");
      assert.equal(snap.reader, null);
      assert.equal(snap.activeTab.type, "library");
      assert.equal(snap.libraryView?.selectedItems.count, 0);
      assert.ok(snap.libraryView?.libraries.some((l) => l.libraryID === requireManifest(ctx).userLibraryID), "selected library row");
      return snap;
    },
  },
  {
    id: "context.single-item",
    title: "One selected item: status ok, focus library, exact item ref",
    requires: ["bridge", "fixtures"],
    async run(ctx) {
      await resetUi(ctx);
      await ctx.seed.ui({ action: "selectItems", libraryID: requireManifest(ctx).userLibraryID, keys: fixtureKeys(ctx, ["item-zh-article"]) });
      const snap = await snapshot(ctx);
      assert.equal(snap.status, "ok");
      assert.equal(snap.focus, "library");
      const selected = snap.libraryView?.selectedItems;
      assert.equal(selected?.count, 1);
      assert.equal(selected?.truncated, false);
      assert.equal(selected?.items[0]?.key, fixtureKey(ctx, "item-zh-article"));
      assert.equal(selected?.items[0]?.title, "深度学习在文献管理中的应用研究");
      return selected;
    },
  },
  {
    id: "context.multi-select",
    title: "Three selected items listed; twelve selected items capped with an exact count",
    requires: ["bridge", "fixtures"],
    async run(ctx) {
      const libraryID = requireManifest(ctx).userLibraryID;
      await resetUi(ctx);
      const three = fixtureKeys(ctx, ["item-zh-article", "item-en-book", "item-mixed"]);
      await ctx.seed.ui({ action: "selectItems", libraryID, keys: three });
      const small = await snapshot(ctx);
      assert.equal(small.libraryView?.selectedItems.count, 3);
      assert.deepEqual(small.libraryView?.selectedItems.items.map((i) => i.key).sort(), [...three].sort());

      const twelve = requireManifest(ctx).bulk.keys.slice(0, 12);
      await ctx.seed.ui({ action: "selectCollection", libraryID, key: requireManifest(ctx).bulk.collectionKey });
      await ctx.seed.ui({ action: "selectItems", libraryID, keys: twelve });
      const large = await snapshot(ctx);
      assert.equal(large.libraryView?.selectedItems.count, 12);
      assert.equal(large.libraryView?.selectedItems.items.length, SNAPSHOT_LIMITS.selectedItems);
      assert.equal(large.libraryView?.selectedItems.truncated, true);
      return { small: small.libraryView?.selectedItems.count, large: large.libraryView?.selectedItems.count };
    },
  },
  {
    id: "context.tree-rows",
    title: "Selected collection and saved-search rows appear in libraryView",
    requires: ["bridge", "fixtures"],
    async run(ctx) {
      const libraryID = requireManifest(ctx).userLibraryID;
      await resetUi(ctx);
      await ctx.seed.ui({ action: "selectCollection", libraryID, key: fixtureKey(ctx, "col-child") });
      const col = await snapshot(ctx);
      assert.deepEqual(col.libraryView?.collections.map((c) => c.key), [fixtureKey(ctx, "col-child")]);
      assert.equal(col.libraryView?.collections[0]?.parentKey, fixtureKey(ctx, "col-root"));
      assert.equal(col.status, "ok");
      await ctx.seed.ui({ action: "selectSavedSearch", libraryID, key: fixtureKey(ctx, "search-fixture-tag") });
      const search = await snapshot(ctx);
      assert.deepEqual(search.libraryView?.savedSearches.map((s) => s.key), [fixtureKey(ctx, "search-fixture-tag")]);
      const group = requireManifest(ctx).group;
      if (group) {
        await ctx.seed.ui({ action: "selectLibrary", libraryID: group.libraryID });
        const groupSnap = await snapshot(ctx);
        assert.ok(groupSnap.libraryView?.libraries.some((l) => l.libraryID === group.libraryID && l.type === "group"), "group row");
      }
      return { collection: col.libraryView?.collections, search: search.libraryView?.savedSearches };
    },
  },
  {
    id: "context.reader",
    title: "Reader tab open on page 2: focus reader with attachment, parent item and page",
    requires: ["bridge", "fixtures"],
    timeoutMs: 90000,
    async run(ctx) {
      await resetUi(ctx);
      await openFixtureReader(ctx, 1);
      const snap = await snapshot(ctx);
      assert.equal(snap.status, "ok");
      assert.equal(snap.focus, "reader");
      assert.equal(snap.activeTab.type, "reader");
      const reader = snap.reader;
      assert.ok(reader, "reader missing");
      assert.equal(reader.readerType, "pdf");
      assert.equal(reader.location, "tab");
      assert.equal(reader.attachment.key, fixtureKey(ctx, "att-stored-pdf"));
      assert.equal(reader.attachment.contentType, "application/pdf");
      assert.equal(reader.parentItem?.key, fixtureKey(ctx, "item-pdf-parent"));
      assert.deepEqual(reader.page, { index: 1, label: String(PDF_FIRST_PAGE_LABEL + 1), count: PDF_PAGES.length });
      assert.equal(reader.selectedText, null);
      assert.equal(reader.selectedAnnotations.count, 0);
      await ctx.seed.ui({ action: "navigateReader", pageIndex: 2 });
      const moved = await snapshot(ctx);
      assert.equal(moved.reader?.page?.index, 2, "page after navigation");
      return reader;
    },
  },
  {
    id: "context.reader-text-selection",
    title: "Selected reader text is captured, truncated by maxTextLength and carried in the hook snapshot",
    requires: ["bridge", "fixtures"],
    timeoutMs: 90000,
    async run(ctx) {
      await ctx.seed.ui({ action: "closeReaders" });
      await openFixtureReader(ctx, 0);
      const ui = await ctx.seed.ui({ action: "setTextSelection", pageIndex: 0, length: 24 });
      if (!ui.feasible) throw new SkipCase(ui.reason ?? "text selection not feasible");
      const uiText = ui.state.reader?.selectedText ?? "";
      assertSelectionFromPage(uiText, 0);
      const snap = await snapshot(ctx);
      const selected = snap.reader?.selectedText;
      assert.ok(selected, "selectedText missing from snapshot");
      assert.equal(normalizeSpaces(selected.text), normalizeSpaces(uiText));
      assert.equal(selected.truncated, false);
      const cut = await snapshot(ctx, { maxTextLength: 5 });
      assert.equal(cut.reader?.selectedText?.text.length, 5);
      assert.equal(cut.reader?.selectedText?.truncated, true);
      assert.equal(cut.reader?.selectedText?.length, selected.length);
      const hook = await captureHook(ctx.mcp(), { client: "codex", session_id: "sel-session", turn_id: "sel-turn" });
      assert.equal(normalizeSpaces(hook.snapshot.reader?.selectedText?.text ?? ""), normalizeSpaces(uiText));
      await ctx.seed.ui({ action: "clearTextSelection" });
      const cleared = await snapshot(ctx);
      assert.equal(cleared.reader?.selectedText ?? null, null, "stale selected text after clearing");
      return { method: ui.method, selected };
    },
  },
  {
    id: "context.reader-annotation-selection",
    title: "Selected annotations (one, then two) are captured with type and Chinese comment",
    requires: ["bridge", "fixtures"],
    timeoutMs: 90000,
    async run(ctx) {
      await ctx.seed.ui({ action: "closeReaders" });
      await openFixtureReader(ctx, 0);
      await ctx.seed.ui({ action: "selectAnnotations", keys: fixtureKeys(ctx, ["ann-highlight"]) });
      const one = await snapshot(ctx);
      const anns = one.reader?.selectedAnnotations;
      assert.equal(anns?.count, 1);
      assert.equal(anns?.items[0]?.key, fixtureKey(ctx, "ann-highlight"));
      assert.equal(anns?.items[0]?.annotationType, "highlight");
      assert.equal(anns?.items[0]?.comment, "高亮评论 highlight comment");
      assert.equal(anns?.items[0]?.text, "Selection target: alpha beta gamma delta");
      const pair = fixtureKeys(ctx, ["ann-highlight", "ann-text"]);
      await ctx.seed.ui({ action: "selectAnnotations", keys: pair });
      const two = await snapshot(ctx);
      assert.equal(two.reader?.selectedAnnotations.count, 2);
      assert.deepEqual(two.reader?.selectedAnnotations.items.map((a) => a.key).sort(), [...pair].sort());
      return anns;
    },
  },
  {
    id: "context.reader-window",
    title: "A focused separate reader window is captured with location 'window'",
    requires: ["bridge", "fixtures"],
    timeoutMs: 90000,
    async run(ctx) {
      await openFixtureReaderWindow(ctx);
      try {
        const snap = await snapshot(ctx);
        assert.equal(snap.focus, "reader");
        assert.equal(snap.reader?.location, "window");
        assert.equal(snap.reader?.attachment.key, fixtureKey(ctx, "att-stored-pdf"));
        assert.equal(snap.reader?.parentItem?.key, fixtureKey(ctx, "item-pdf-parent"));
        assert.equal(snap.reader?.page?.index, 1);
        return { activeTab: snap.activeTab, reader: snap.reader };
      } finally {
        await ctx.seed.ui({ action: "closeReaders" });
      }
    },
  },
  {
    id: "context.note-tab",
    title: "A note open in a tab (Zotero 11's default) is the focus, not the hidden library tab's selection",
    requires: ["bridge", "fixtures"],
    timeoutMs: 90000,
    async run(ctx) {
      const libraryID = requireManifest(ctx).userLibraryID;
      await resetUi(ctx);
      // A different item stays selected in the (now hidden) library tab.
      await ctx.seed.ui({ action: "selectItems", libraryID, keys: fixtureKeys(ctx, ["item-en-book"]) });
      const ui = await ctx.seed.ui({ action: "openNoteTab", libraryID, key: fixtureKey(ctx, "note-child") });
      assert.match(ui.state.tab.type ?? "", /^note/, `active tab ${ui.state.tab.type}`);
      try {
        const snap = await snapshot(ctx);
        assert.equal(snap.status, "ok");
        assert.equal(snap.focus, "note");
        assert.equal(snap.activeTab.type, "note");
        assert.equal(snap.reader, null);
        assert.equal(snap.note?.location, "tab");
        assert.equal(snap.note?.item.key, fixtureKey(ctx, "note-child"));
        assert.equal(snap.note?.item.itemType, "note");
        assert.equal(snap.note?.parentItem?.key, fixtureKey(ctx, "item-pdf-parent"));
        assert.deepEqual(snap.libraryView?.selectedItems.items.map((i) => i.key), [fixtureKey(ctx, "item-en-book")]);
        const hook = await captureHook(ctx.mcp(), { client: "claude-code", session_id: "note-tab" });
        assert.equal(hook.snapshot.focus, "note");
        assert.match(hook.additionalContext, /Focus: the note open in Zotero/);
        assert.doesNotMatch(hook.additionalContext, /Nothing is selected or open/);
        return { activeTab: snap.activeTab, note: snap.note, hiddenSelection: snap.libraryView?.selectedItems.count };
      } finally {
        await ctx.seed.ui({ action: "closeReaders" });
      }
    },
  },
  {
    id: "context.reader-closed",
    title: "After closing the reader no stale reader context remains",
    requires: ["bridge", "fixtures"],
    async run(ctx) {
      await ctx.seed.ui({ action: "closeReaders" });
      const snap = await snapshot(ctx);
      assert.equal(snap.reader, null);
      assert.notEqual(snap.focus, "reader");
      assert.equal(snap.activeTab.type, "library");
      const hook = await captureHook(ctx.mcp(), { client: "claude-code", session_id: "closed" });
      assert.equal(hook.snapshot.reader, null);
      return { focus: snap.focus, status: snap.status };
    },
  },
  {
    id: "context.hook-codex",
    title: "Codex hook arguments produce the exact hook JSON with session/turn ids",
    requires: ["bridge", "fixtures"],
    async run(ctx) {
      const hook = await captureHook(ctx.mcp("/codex/mcp", "2025-06-18"), { client: "codex", session_id: "thread-123", turn_id: "turn-456" });
      const snap = hook.snapshot;
      assert.equal(snap.client, "codex");
      assert.equal(snap.sessionId, "thread-123");
      assert.equal(snap.turnId, "turn-456");
      assert.equal(snap.promptId, null);
      assert.ok(snap.snapshotId.startsWith(`codex/s:thread-123/t:turn-456/n:${snap.sequence}/`), snap.snapshotId);
      assert.match(hook.additionalContext, /untrusted/i, "untrusted-data notice");
      return { snapshotId: snap.snapshotId, chars: hook.additionalContext.length };
    },
  },
  {
    id: "context.hook-claude-code",
    title: "Claude Code hook arguments: empty prompt_id is absent, a real prompt_id is kept",
    requires: ["bridge", "fixtures"],
    async run(ctx) {
      const client = ctx.mcp();
      const first = await captureHook(client, { client: "claude-code", session_id: "cc-session", prompt_id: "" });
      assert.equal(first.snapshot.client, "claude-code");
      assert.equal(first.snapshot.promptId, null);
      assert.equal(first.snapshot.turnId, null);
      assert.ok(first.snapshot.snapshotId.startsWith("claude-code/s:cc-session/n:"), first.snapshot.snapshotId);
      const second = await captureHook(client, { client: "claude-code", session_id: "cc-session", prompt_id: "prompt-7" });
      assert.equal(second.snapshot.promptId, "prompt-7");
      assert.ok(second.snapshot.snapshotId.includes("/p:prompt-7/"), second.snapshot.snapshotId);
      const invalid = await client.toolError("capture_prompt_context", { client: "Not Valid!" });
      assert.equal(invalid.code, "INVALID_ARGUMENT");
      const missing = await client.toolError("capture_prompt_context", {});
      assert.equal(missing.code, "INVALID_ARGUMENT");
      return { first: first.snapshot.snapshotId, second: second.snapshot.snapshotId };
    },
  },
  {
    id: "context.hook-sequence",
    title: "Snapshot sequence numbers strictly increase and ids are unique across both tools",
    requires: ["bridge", "fixtures"],
    async run(ctx) {
      const client = ctx.mcp();
      const sequences: number[] = [];
      const ids = new Set<string>();
      for (let i = 0; i < 4; i++) {
        const hook = await captureHook(client, { client: "codex", session_id: "seq", turn_id: `turn-${i}` });
        sequences.push(hook.snapshot.sequence);
        ids.add(hook.snapshot.snapshotId);
        const direct = await snapshot(ctx);
        sequences.push(direct.sequence);
        ids.add(direct.snapshotId);
      }
      for (let i = 1; i < sequences.length; i++) {
        assert.ok((sequences[i] ?? 0) > (sequences[i - 1] ?? 0), `sequence not increasing: ${sequences.join(",")}`);
      }
      assert.equal(ids.size, sequences.length, "snapshot ids repeat");
      return { sequences };
    },
  },
  {
    id: "context.performance",
    title: `Capture with a reader and a selection stays under ${CAPTURE_BUDGET_MS} ms`,
    requires: ["bridge", "fixtures"],
    timeoutMs: 120000,
    async run(ctx) {
      const libraryID = requireManifest(ctx).userLibraryID;
      await resetUi(ctx);
      await ctx.seed.ui({ action: "selectItems", libraryID, keys: fixtureKeys(ctx, ["item-zh-article", "item-en-book", "item-mixed"]) });
      await openFixtureReader(ctx, 0);
      await ctx.seed.ui({ action: "selectAnnotations", keys: fixtureKeys(ctx, ["ann-highlight"]) });
      const client = ctx.mcp();
      const hookMs: number[] = [];
      const directMs: number[] = [];
      for (let i = 0; i < 10; i++) {
        hookMs.push((await captureHook(client, { client: "codex", session_id: "perf", turn_id: `t${i}` })).ms);
        const started = Date.now();
        await snapshot(ctx);
        directMs.push(Date.now() - started);
      }
      const worst = Math.max(...hookMs, ...directMs);
      assert.ok(worst < CAPTURE_BUDGET_MS, `slowest capture ${worst} ms (hook ${hookMs.join(",")}; direct ${directMs.join(",")})`);
      await ctx.seed.ui({ action: "closeReaders" });
      return { hookMedianMs: median(hookMs), hookMaxMs: Math.max(...hookMs), directMedianMs: median(directMs), directMaxMs: Math.max(...directMs) };
    },
  },
];
