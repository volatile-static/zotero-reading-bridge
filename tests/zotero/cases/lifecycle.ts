/**
 * Read-only proof and lifecycle (DESIGN 2.G): a full battery of tool calls leaves the database and the
 * attachment files byte-for-byte unchanged; add-on disable/enable (the bridge's only off switch) unregisters
 * and registers the endpoints live without disturbing Zotero's own connector endpoints; the preferences pane
 * loads with its Fluent strings, status and address.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  BRIDGE_TITLE,
  ENDPOINT_ALIAS_PATH,
  ENDPOINT_PATH,
  ENDPOINT_PATHS,
  ZOTERO_ADDON_ID,
  endpointUrl,
} from "../../../shared/types/bridge.js";
import { TOOL_NAMES } from "../../../shared/types/tool-names.js";
import { BULK_TAG } from "../fixtures/data.js";
import { readBridgeFtl, renderFtlValue, stripIsolationMarks, type FtlMessage } from "../lib/ftl.js";
import { getRequest } from "../lib/http.js";
import { REPO_ROOT } from "../lib/paths.js";
import type { PaneState } from "../seed-api.js";
import type { McpClient } from "../lib/mcp.js";
import { diffFingerprints, stableFingerprint } from "../lib/readonly.js";
import { captureHook } from "./context.js";
import { assertReasonPhrase } from "./protocol.js";
import { fixtureKey, fixtureKeys, requireManifest, type HarnessContext, type TestCase } from "./types.js";
import { openFixtureReader, resetUi } from "./ui.js";

const ENDPOINT_TIMEOUT_MS = 15000;

/** Every tool at least once, including paging, Chinese queries and error paths. Returns the call count. */
async function toolBattery(ctx: HarnessContext, client: McpClient): Promise<number> {
  const k = (id: string) => fixtureKey(ctx, id);
  const calls: Array<[string, Record<string, unknown>]> = [
    ["get_status", {}],
    ["get_current_context", {}],
    ["get_current_context", { maxTextLength: 0 }],
    ["capture_prompt_context", { client: "codex", session_id: "ro", turn_id: "ro-1" }],
    ["capture_prompt_context", { client: "claude-code", session_id: "ro", prompt_id: "" }],
    ["list_libraries", {}],
    ["list_collections", { recursive: true }],
    ["get_collection", { key: requireManifest(ctx).bulk.collectionKey, limit: 200 }],
    ["list_saved_searches", {}],
    ["run_saved_search", { key: k("search-fixture-tag") }],
    ["search_items", { query: "深度学习" }],
    ["search_items", { query: "长笔记内容", mode: "everything" }],
    ["search_items", { query: "fixture", mode: "fulltext" }],
    ["search_items", { tags: [BULK_TAG], limit: 200, sort: "title" }],
    ["get_items", { keys: fixtureKeys(ctx, ["item-zh-article", "item-trashed", "item-pdf-parent"]) }],
    ["get_item_children", { key: k("item-pdf-parent") }],
    ["get_item_children", { key: k("att-stored-pdf") }],
    ["list_tags", {}],
    ["get_notes", { key: k("item-en-book") }],
    ["get_notes", { key: k("note-child") }],
    ["get_annotations", { key: k("item-pdf-parent") }],
    ["list_attachments", { key: k("item-missing-parent") }],
    ["list_attachments", { key: k("item-linked-parent") }],
    ["get_attachment_path", { key: k("item-pdf-parent") }],
    ["get_attachment_path", { key: k("att-missing-stored") }],
    ["get_fulltext", { key: k("item-pdf-parent") }],
    ["get_fulltext", { key: k("att-missing-stored") }],
    ["get_library_paths", {}],
    ["get_schema", {}],
    ["get_schema", { itemType: "journalArticle" }],
    ["get_notes", { key: "ZZZZZZZZ" }],
    ["search_items", { itemType: "notAType" }],
  ];
  for (const [name, args] of calls) await client.callTool(name, args);
  return calls.length;
}

async function waitForEndpoints(ctx: HarnessContext, present: boolean): Promise<string[]> {
  const deadline = Date.now() + ENDPOINT_TIMEOUT_MS;
  let endpoints: string[] = [];
  while (Date.now() < deadline) {
    endpoints = (await ctx.seed.state()).endpoints;
    if (ENDPOINT_PATHS.every((p) => endpoints.includes(p) === present)) return endpoints;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`Bridge endpoints ${present ? "not registered" : "still registered"} after ${ENDPOINT_TIMEOUT_MS} ms: ${endpoints.join(", ")}`);
}

/** With the bridge off, its paths are unknown to Zotero (404) and Zotero's connector still answers. */
async function assertBridgeOff(ctx: HarnessContext): Promise<Record<string, number | string>> {
  const seen: Record<string, number | string> = {};
  for (const path of ENDPOINT_PATHS) {
    const result = await ctx.mcp(path).post({ jsonrpc: "2.0", id: 1, method: "ping" });
    assert.equal(result.response?.status, 404, `${path} while disabled: ${result.response?.status ?? result.error}`);
    seen[path] = result.response?.status ?? "none";
  }
  const ping = await getRequest(ctx.port, "/connector/ping");
  assert.equal(ping.response?.status, 200, "connector ping while the bridge is off");
  return seen;
}

async function assertBridgeOn(ctx: HarnessContext): Promise<void> {
  for (const path of ENDPOINT_PATHS) {
    const init = await ctx.mcp(path).initialize("zab-lifecycle");
    assert.equal(init.message.result.serverInfo.name, "zotero-ai-bridge");
  }
  const status = await ctx.mcp(ENDPOINT_ALIAS_PATH).tool("get_status");
  assert.equal(status.bridge.status, "running");
  const found = await ctx.mcp().tool("search_items", { query: "深度学习" });
  assert.ok(found.items.some((i: any) => i.key === fixtureKey(ctx, "item-zh-article")), "search after re-enable");
  // The reason phrases removed on shutdown must be back after a restart of the bridge.
  const accepted = await ctx.mcp().post({ jsonrpc: "2.0", method: "notifications/initialized" });
  assert.ok(accepted.response, "notification after re-enable");
  assertReasonPhrase(accepted.response, "Accepted");
  const ping = await getRequest(ctx.port, "/connector/ping");
  assert.equal(ping.response?.status, 200, "connector ping with the bridge on");
}

const STATUS_RUNNING = "zotero-ai-bridge-pref-status-running";

/** Fluent ids written statically in the shipped pane markup (the status id is set by the pane script). */
function staticPaneL10nIds(): string[] {
  const markup = fs.readFileSync(path.join(REPO_ROOT, "packages", "zotero", "content", "preferences.xhtml"), "utf8");
  return [...markup.matchAll(/data-l10n-id="([^"]+)"/g)].map((m) => m[1]!);
}

function ftlMessage(ftl: Map<string, FtlMessage>, id: string, locale: string): FtlMessage {
  const message = ftl.get(id);
  if (!message) throw new Error(`${id} is missing from locale/${locale}/zotero-ai-bridge.ftl`);
  return message;
}

/** Status text the pane must show, rendered from the en-US source. */
function expectedStatus(en: Map<string, FtlMessage>, id: string, port: number): string {
  const value = ftlMessage(en, id, "en-US").value;
  if (value === null) throw new Error(`${id} has no value`);
  return renderFtlValue(value, { port: String(port), error: "" });
}

/** Every localized element shows its en-US message (value as text, `.label` as the label attribute). */
function assertPaneTranslated(pane: PaneState, en: Map<string, FtlMessage>, port: number): number {
  const shown = new Set(pane.elements.map((el) => el.l10nId));
  for (const id of staticPaneL10nIds()) assert.ok(shown.has(id), `pane element with data-l10n-id ${id} not rendered`);
  for (const el of pane.elements) {
    const message = ftlMessage(en, el.l10nId, "en-US");
    const label = message.attributes.label;
    if (label !== undefined) {
      assert.equal(el.label, label, `${el.l10nId} .label`);
    } else {
      assert.equal(stripIsolationMarks(el.text), renderFtlValue(message.value ?? "", { port: String(port), error: "" }), `${el.l10nId} text`);
    }
  }
  return pane.elements.length;
}

export const lifecycleCases: TestCase[] = [
  {
    id: "lifecycle.read-only",
    title: "A full battery of tool calls (reader open, items selected) leaves DB tables and files unchanged",
    requires: ["bridge", "fixtures"],
    timeoutMs: 180000,
    async run(ctx) {
      const libraryID = requireManifest(ctx).userLibraryID;
      await resetUi(ctx);
      await ctx.seed.ui({ action: "selectItems", libraryID, keys: fixtureKeys(ctx, ["item-zh-article", "item-pdf-parent"]) });
      await openFixtureReader(ctx, 0);
      await ctx.seed.ui({ action: "selectAnnotations", keys: fixtureKeys(ctx, ["ann-highlight"]) });
      const files = Object.values(ctx.observed?.attachments ?? {}).flatMap((att) => (att.path ? [att.path] : []));
      const before = await stableFingerprint(ctx.seed, files);
      const client = ctx.mcp();
      const count = (await toolBattery(ctx, client)) + (await toolBattery(ctx, ctx.mcp(ENDPOINT_ALIAS_PATH, "2025-06-18")));
      await captureHook(client, { client: "codex", session_id: "ro", turn_id: "ro-final" });
      // Give any deferred write (debounced saves, notifier-triggered work) time to land before comparing.
      await new Promise((resolve) => setTimeout(resolve, 3000));
      const after = await ctx.seed.fingerprint(files);
      const diffs = diffFingerprints(before, after);
      assert.deepEqual(diffs, [], `data changed during read-only calls: ${diffs.join("; ")}`);
      await ctx.seed.ui({ action: "closeReaders" });
      return { toolCalls: count + 1, tables: Object.keys(before.tables).length, files: files.length, maxima: after.maxima };
    },
  },
  {
    id: "lifecycle.addon-toggle",
    title: "Disabling the add-on removes its endpoints; enabling it again serves all tools",
    requires: ["bridge", "fixtures"],
    timeoutMs: 120000,
    async run(ctx) {
      let disabled = false;
      try {
        const off = await ctx.seed.addon({ id: ZOTERO_ADDON_ID, action: "disable" });
        disabled = true;
        assert.equal(off.addon?.isActive, false);
        await waitForEndpoints(ctx, false);
        const statuses = await assertBridgeOff(ctx);
        const on = await ctx.seed.addon({ id: ZOTERO_ADDON_ID, action: "enable" });
        disabled = false;
        assert.equal(on.addon?.isActive, true);
        await waitForEndpoints(ctx, true);
        await assertBridgeOn(ctx);
        const tools = await ctx.mcp().rpc("tools/list");
        assert.equal(tools.message.result.tools.length, TOOL_NAMES.length);
        return { whileDisabled: statuses, disableMs: off.ms, enableMs: on.ms };
      } finally {
        if (disabled) await ctx.seed.addon({ id: ZOTERO_ADDON_ID, action: "enable" }).catch(() => undefined);
      }
    },
  },
  {
    // Runs after the add-on toggle, so it also covers the pane re-registered by the re-enabled add-on.
    id: "lifecycle.prefs-pane",
    title: "Preferences pane loads with en-US Fluent strings (zh-CN registered too), running status and address",
    requires: ["bridge"],
    timeoutMs: 120000,
    async run(ctx) {
      const locales = { "en-US": readBridgeFtl("en-US"), "zh-CN": readBridgeFtl("zh-CN") };
      const en = locales["en-US"];
      // Value-only messages without variables format identically outside the pane.
      const probeIds = [...en].filter(([, m]) => m.value !== null && !m.value.includes("{")).map(([id]) => id);
      try {
        const opened = await ctx.seed.prefsPane({
          action: "open",
          pluginID: ZOTERO_ADDON_ID,
          messages: { locales: Object.keys(locales), ids: probeIds },
        });
        assert.equal(opened.l10nSourceRegistered, true, "Zotero's merged plugin Fluent source is registered");
        assert.equal(opened.registered?.label, BRIDGE_TITLE, "pane label");
        assert.ok((opened.registered?.imageBytes ?? 0) > 0, `pane icon ${opened.registered?.image ?? "(none)"} is readable`);
        for (const [locale, ftl] of Object.entries(locales)) {
          const formatted = opened.messages[locale];
          assert.ok(formatted, `Zotero ships no ${locale} locale (available: ${opened.availableLocales.join(", ")})`);
          for (const id of probeIds) {
            assert.equal(stripIsolationMarks(formatted[id] ?? "(missing)"), ftlMessage(ftl, id, locale).value, `${locale} ${id}`);
          }
        }
        const pane = opened.pane;
        assert.ok(pane?.loaded && pane.shown, "pane loaded and shown");
        assert.equal(pane.heading, BRIDGE_TITLE, "pane heading");
        const translated = assertPaneTranslated(pane, en, ctx.port);
        assert.equal(pane.status?.l10nId, STATUS_RUNNING, "status message");
        assert.equal(stripIsolationMarks(pane.status.text), expectedStatus(en, STATUS_RUNNING, ctx.port), "status text");
        assert.equal(pane.address, endpointUrl(ctx.port, ENDPOINT_PATH));
        assert.equal(pane.alias, endpointUrl(ctx.port, ENDPOINT_ALIAS_PATH));
        assert.deepEqual(Object.entries(pane.buttonsDisabled).filter(([, disabled]) => disabled), [], "copy buttons enabled");

        const closed = await ctx.seed.prefsPane({ action: "close", pluginID: ZOTERO_ADDON_ID });
        assert.equal(closed.windowOpen, false, "preferences window closed");
        return {
          paneID: opened.registered?.paneID,
          translatedElements: translated,
          formattedMessages: probeIds.length,
          status: pane.status,
          address: pane.address,
          openMs: opened.ms,
        };
      } finally {
        // Closing is a no-op when the window is already gone (also covers a pane that never finished loading).
        await ctx.seed.prefsPane({ action: "close", pluginID: ZOTERO_ADDON_ID }).catch(() => undefined);
      }
    },
  },
];
