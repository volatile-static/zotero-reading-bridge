/**
 * Infrastructure cases (no bridge needed): the test instance is really separate and isolated, the seed
 * plugin's endpoints are token-protected, and the fixture library is created and reads back exactly.
 */
import assert from "node:assert/strict";
import path from "node:path";
import { SEED_ADDON_ID, SEED_PATHS, type FixtureQueryResult } from "../seed-api.js";
import { ZOTERO_ADDON_ID } from "../../../shared/types/bridge.js";
import {
  ANNOTATIONS,
  ATTACHMENTS,
  BULK_ITEM_COUNT,
  COLLECTIONS,
  FIXTURE_TAGGED_LIVE_ITEMS,
  GROUP,
  ITEMS,
  NOTES,
  PDF_FIRST_PAGE_LABEL,
  SAVED_SEARCH,
} from "../fixtures/data.js";
import { getRequest } from "../lib/http.js";
import { prepareFixtureFiles, removeMissingFixtureFiles, samePath } from "../lib/fixture-files.js";
import { REAL_ZOTERO_PORT, isInside } from "../lib/paths.js";
import { processCommandLine, processTree, tcpListeners, visibleWindows } from "../lib/process.js";
import { stableFingerprint } from "../lib/readonly.js";
import { SkipCase, fixtureKey, fixtureKeys, requireManifest, type HarnessContext, type TestCase } from "./types.js";

const MAIN_WINDOW_TYPE = "navigator:browser";

function sorted(values: readonly string[]): string[] {
  return [...values].sort();
}

function observed(ctx: HarnessContext): FixtureQueryResult {
  if (!ctx.observed) throw new Error("Fixtures were not read back (seed.query did not run)");
  return ctx.observed;
}

export const harnessCases: TestCase[] = [
  {
    id: "harness.instance",
    title: "Separate Zotero instance on the test port with the throwaway profile and data directory",
    requires: [],
    async run(ctx) {
      const state = await ctx.seed.state();
      assert.ok(samePath(state.profileDir, ctx.layout.profileDir), `profileDir ${state.profileDir} != ${ctx.layout.profileDir}`);
      assert.ok(samePath(state.dataDir, ctx.layout.dataDir), `dataDir ${state.dataDir} != ${ctx.layout.dataDir}`);
      assert.equal(state.port, ctx.port, "Zotero.Server.port");
      assert.match(state.zoteroVersion, /^11\./, "Zotero version");

      const tree = await processTree(ctx.proc.pid);
      const ours = new Set(tree.map((p) => p.pid));
      const listeners = await tcpListeners(ctx.port);
      assert.ok(listeners.length > 0, `nothing listens on ${ctx.port}`);
      for (const listener of listeners) {
        assert.ok(ours.has(listener.pid), `port ${ctx.port} is owned by PID ${listener.pid}, not by the launched tree`);
        assert.equal(listener.address, "127.0.0.1", `port ${ctx.port} bound to ${listener.address}`);
      }
      const realListeners = await tcpListeners(REAL_ZOTERO_PORT);
      for (const listener of realListeners) {
        assert.ok(!ours.has(listener.pid), `the test instance also listens on ${REAL_ZOTERO_PORT}`);
      }
      const commandLine = (await processCommandLine(ctx.proc.pid)) ?? "";
      assert.ok(commandLine.includes("-no-remote"), `command line lacks -no-remote: ${commandLine}`);
      assert.ok(commandLine.includes("-profile"), `command line lacks -profile: ${commandLine}`);
      assert.ok(commandLine.includes(ctx.layout.profileDir), `command line lacks the profile path: ${commandLine}`);
      return {
        pid: ctx.proc.pid,
        commandLine,
        processTree: tree.map((p) => `${p.pid}:${p.name}`),
        listeners,
        realPortListeners: realListeners,
        zoteroVersion: state.zoteroVersion,
        platformVersion: state.platformVersion,
        locale: state.locale,
      };
    },
  },
  {
    id: "harness.windows",
    title: "Startup reached the main window with no blocking first-run or migration dialog",
    requires: [],
    async run(ctx) {
      const state = await ctx.seed.state();
      assert.ok(state.uiReady, "Zotero.uiReadyPromise has not resolved");
      const mainWindows = state.windows.filter((w) => w.type === MAIN_WINDOW_TYPE);
      assert.equal(mainWindows.length, 1, `main windows: ${JSON.stringify(state.windows)}`);
      const others = state.windows.filter((w) => w.type !== MAIN_WINDOW_TYPE);
      assert.deepEqual(others, [], `unexpected extra windows: ${JSON.stringify(others)}`);
      const visible = await visibleWindows((await processTree(ctx.proc.pid)).map((p) => p.pid));
      return { geckoWindows: state.windows, visibleWin32Windows: visible };
    },
  },
  {
    id: "harness.addons",
    title: "Seed plugin active; bridge add-on active exactly when its XPI was installed",
    requires: [],
    async run(ctx) {
      const state = await ctx.seed.state();
      const seed = state.plugins.find((p) => p.id === SEED_ADDON_ID);
      assert.ok(seed?.isActive, `seed add-on state ${JSON.stringify(seed)}`);
      const bridge = state.plugins.find((p) => p.id === ZOTERO_ADDON_ID);
      if (ctx.bridgeInstalled) {
        assert.ok(bridge?.isActive, `bridge add-on state ${JSON.stringify(bridge ?? null)}`);
        for (const endpoint of ["/bridge/mcp"]) {
          assert.ok(state.endpoints.includes(endpoint), `${endpoint} not registered: ${state.endpoints.join(", ")}`);
        }
      } else {
        assert.equal(bridge, undefined, "bridge add-on present although its XPI was not installed");
      }
      for (const endpoint of Object.values(SEED_PATHS)) {
        assert.ok(state.endpoints.includes(endpoint), `${endpoint} not registered`);
      }
      return { plugins: state.plugins, endpoints: state.endpoints };
    },
  },
  {
    id: "harness.seed-token",
    title: "Seed endpoints refuse requests without the per-run token",
    requires: [],
    async run(ctx) {
      const missing = await ctx.seed.raw(SEED_PATHS.state, {}, null);
      assert.equal(missing.response?.status, 403, `no token: ${missing.response?.status ?? missing.error}`);
      const wrong = await ctx.seed.raw(SEED_PATHS.state, {}, "0".repeat(48));
      assert.equal(wrong.response?.status, 403, `wrong token: ${wrong.response?.status ?? wrong.error}`);
      const quitWithoutToken = await ctx.seed.raw(SEED_PATHS.quit, {}, null);
      assert.equal(quitWithoutToken.response?.status, 403, "quit without token");
      const right = await ctx.seed.state();
      assert.equal(right.ok, true);
      return { missing: missing.response?.status, wrong: wrong.response?.status };
    },
  },
  {
    id: "harness.connector-ping",
    title: "Zotero's own /connector/ping still answers on the test port",
    requires: [],
    async run(ctx) {
      const ping = await getRequest(ctx.port, "/connector/ping");
      assert.equal(ping.response?.status, 200, `ping: ${ping.response?.status ?? ping.error}`);
      return { status: ping.response?.status, ms: ping.ms };
    },
  },
  {
    id: "seed.fixtures",
    title: "Seed the synthetic fixture library through the token-protected seed endpoint",
    requires: [],
    timeoutMs: 180000,
    async run(ctx) {
      const files = prepareFixtureFiles(ctx.layout);
      const result = await ctx.seed.seed({ files });
      const manifest = result.manifest;
      const removed = removeMissingFixtureFiles(files, manifest);
      for (const spec of COLLECTIONS) assert.ok(manifest.collections[spec.id], `collection ${spec.id} not seeded`);
      for (const spec of ITEMS) assert.ok(manifest.items[spec.id], `item ${spec.id} not seeded`);
      for (const spec of NOTES) assert.ok(manifest.notes[spec.id], `note ${spec.id} not seeded`);
      for (const spec of ATTACHMENTS) assert.ok(manifest.attachments[spec.id], `attachment ${spec.id} not seeded`);
      for (const spec of ANNOTATIONS) assert.ok(manifest.annotations[spec.id], `annotation ${spec.id} not seeded`);
      assert.ok(manifest.savedSearches[SAVED_SEARCH.id], "saved search not seeded");
      assert.equal(manifest.bulk.keys.length, BULK_ITEM_COUNT, "bulk items");
      ctx.manifest = manifest;
      return { ms: result.ms, removedFiles: removed, group: manifest.group, groupError: manifest.groupError };
    },
  },
  {
    id: "seed.query",
    title: "Fixtures read back through Zotero's APIs match fixtures/data.ts",
    requires: ["fixtures"],
    timeoutMs: 120000,
    async run(ctx) {
      const manifest = requireManifest(ctx);
      const result = await ctx.seed.query(manifest);
      ctx.observed = result;

      for (const spec of COLLECTIONS) {
        const col = result.collections[spec.id];
        assert.ok(col, `collection ${spec.id} missing`);
        assert.equal(col.name, spec.name, `collection ${spec.id} name`);
        assert.equal(col.parentKey, spec.parent ? fixtureKey(ctx, spec.parent) : null, `collection ${spec.id} parent`);
        const expectedCount =
          ITEMS.filter((item) => !item.deleted && item.collections.includes(spec.id)).length +
          NOTES.filter((note) => !note.parent && note.collections.includes(spec.id)).length +
          (spec.id === "col-bulk" ? BULK_ITEM_COUNT : 0);
        assert.equal(col.itemCount, expectedCount, `collection ${spec.id} item count`);
      }
      for (const spec of ITEMS) {
        const item = result.items[spec.id];
        assert.ok(item, `item ${spec.id} missing`);
        assert.equal(item.title, spec.title, `item ${spec.id} title`);
        assert.equal(item.itemType, spec.itemType, `item ${spec.id} type`);
        assert.equal(item.deleted, spec.deleted === true, `item ${spec.id} deleted flag`);
        assert.deepEqual(item.tags, sorted(spec.tags), `item ${spec.id} tags`);
        assert.deepEqual(item.collections, sorted(fixtureKeys(ctx, spec.collections)), `item ${spec.id} collections`);
        assert.deepEqual(item.creators, spec.creators, `item ${spec.id} creators`);
        for (const [field, value] of Object.entries(spec.fields)) {
          assert.equal(item.fields[field], value, `item ${spec.id} field ${field}`);
        }
      }
      for (const spec of NOTES) {
        const note = result.notes[spec.id];
        assert.ok(note, `note ${spec.id} missing`);
        assert.equal(note.html, spec.html, `note ${spec.id} html`);
        assert.equal(note.parentKey, spec.parent ? fixtureKey(ctx, spec.parent) : null, `note ${spec.id} parent`);
        assert.deepEqual(note.collections, sorted(fixtureKeys(ctx, spec.collections)), `note ${spec.id} collections`);
      }
      const storageRoot = path.join(ctx.layout.dataDir, "storage");
      for (const spec of ATTACHMENTS) {
        const att = result.attachments[spec.id];
        assert.ok(att, `attachment ${spec.id} missing`);
        const stored = spec.kind === "stored" || spec.kind === "missing-stored";
        assert.equal(att.linkMode, stored ? "imported_file" : "linked_file", `attachment ${spec.id} link mode`);
        assert.equal(att.exists, !spec.kind.startsWith("missing"), `attachment ${spec.id} exists`);
        assert.equal(att.contentType, "application/pdf", `attachment ${spec.id} content type`);
        assert.equal(att.parentKey, fixtureKey(ctx, spec.parent), `attachment ${spec.id} parent`);
        assert.equal(att.title, spec.title, `attachment ${spec.id} title`);
        assert.ok(att.path, `attachment ${spec.id} has no path`);
        if (stored) {
          assert.ok(isInside(path.join(storageRoot, att.key), att.path), `stored attachment ${spec.id} path ${att.path}`);
        } else {
          assert.ok(isInside(ctx.layout.fixturesDir, att.path), `linked attachment ${spec.id} path ${att.path}`);
        }
      }
      assert.match(result.attachments["att-linked-pdf"]?.path ?? "", /链接 附件 目录[\\/]测试 文档 linked\.pdf$/, "Chinese + space linked path");
      for (const spec of ANNOTATIONS) {
        const ann = result.annotations[spec.id];
        assert.ok(ann, `annotation ${spec.id} missing`);
        assert.equal(ann.type, spec.type, `annotation ${spec.id} type`);
        assert.equal(ann.parentKey, fixtureKey(ctx, spec.attachment), `annotation ${spec.id} parent`);
        if (spec.text !== undefined) assert.equal(ann.text, spec.text, `annotation ${spec.id} text`);
        assert.equal(ann.comment ?? "", spec.comment, `annotation ${spec.id} comment`);
        assert.equal(ann.color, spec.color, `annotation ${spec.id} color`);
        assert.equal(ann.pageLabel, String(PDF_FIRST_PAGE_LABEL + spec.pageIndex), `annotation ${spec.id} page label`);
        assert.deepEqual(ann.position, spec.position, `annotation ${spec.id} position`);
        assert.deepEqual(ann.tags, sorted(spec.tags), `annotation ${spec.id} tags`);
      }
      assert.ok(result.savedSearch, "saved search missing");
      assert.equal(result.savedSearch.name, SAVED_SEARCH.name, "saved search name");
      assert.deepEqual(result.savedSearch.resultKeys, sorted(fixtureKeys(ctx, FIXTURE_TAGGED_LIVE_ITEMS)), "saved search results");
      assert.equal(result.bulk.collectionItemCount, BULK_ITEM_COUNT, "bulk collection size");
      assert.equal(result.bulk.taggedCount, BULK_ITEM_COUNT, "bulk tag count");
      if (manifest.group) {
        assert.ok(result.group, "group library missing on read-back");
        assert.equal(result.group.name, GROUP.name, "group name");
        assert.deepEqual(result.group.itemKeys, sorted(GROUP.items.map((item) => fixtureKey(ctx, item.id))), "group items");
        assert.deepEqual(result.group.collectionKeys, [fixtureKey(ctx, GROUP.collection.id)], "group collections");
      }
      return {
        libraries: result.libraries,
        attachmentPaths: Object.fromEntries(Object.entries(result.attachments).map(([id, att]) => [id, { path: att.path, exists: att.exists }])),
      };
    },
  },
  {
    id: "seed.group",
    title: "Group library fixture (created locally without a server)",
    requires: ["fixtures"],
    async run(ctx) {
      const manifest = requireManifest(ctx);
      if (!manifest.group) throw new SkipCase(`group library could not be created: ${manifest.groupError ?? "unknown reason"}`);
      const result = observed(ctx);
      assert.ok(result.libraries.some((lib) => lib.libraryID === manifest.group?.libraryID && lib.type === "group"));
      return manifest.group;
    },
  },
  {
    id: "seed.fingerprint",
    title: "Database fingerprint is reproducible once Zotero is idle (baseline for the read-only proof)",
    requires: ["fixtures"],
    timeoutMs: 90000,
    async run(ctx) {
      const result = observed(ctx);
      const files = Object.values(result.attachments).flatMap((att) => (att.path ? [att.path] : []));
      const fingerprint = await stableFingerprint(ctx.seed, files);
      assert.ok((fingerprint.tables.items?.rows ?? 0) >= ITEMS.length + BULK_ITEM_COUNT, "items table row count");
      assert.equal(fingerprint.tables.itemAnnotations?.rows, ANNOTATIONS.length, "annotation rows");
      return { rows: Object.fromEntries(Object.entries(fingerprint.tables).map(([name, t]) => [name, t.rows])) };
    },
  },
];
