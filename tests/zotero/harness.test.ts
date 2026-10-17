/**
 * Offline tests of the live harness's own machinery (no Zotero needed):
 *   node --import tsx --test tests/zotero/harness.test.ts
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { after, describe, test } from "node:test";
import { PAGE_LIMIT_MAX } from "../../shared/types/bridge.js";
import { allCases } from "./cases/index.js";
import {
  ANNOTATIONS,
  ATTACHMENTS,
  BULK_ITEM_COUNT,
  COLLECTIONS,
  FIXTURE_TAGGED_LIVE_ITEMS,
  ITEMS,
  NOTES,
  PDF_PAGES,
  type SeedManifest,
} from "./fixtures/data.js";
import { buildFixturePdf } from "./fixtures/pdf.js";
import { checkBridgeDebugLines, fixtureTexts } from "./lib/debug-log.js";
import { prepareFixtureFiles, removeMissingFixtureFiles, samePath } from "./lib/fixture-files.js";
import { parseFtl, readBridgeFtl, renderFtlValue, stripIsolationMarks } from "./lib/ftl.js";
import { asciiJson, buildHeaders, postJson, rawRequest } from "./lib/http.js";
import { TEST_PORT, TEST_ROOT, assertTestPath, isInside, realZoteroLocations } from "./lib/paths.js";
import { diffFingerprints } from "./lib/readonly.js";
import { diffRealProfileState, testProfilePrefs, writeUserJs, type RunLayout } from "./profile.js";
import type { FingerprintResult } from "./seed-api.js";

const scratchRoot = path.join(TEST_ROOT, `unit-${process.pid}-${Date.now()}`);
after(() => fs.rmSync(assertTestPath(scratchRoot, "unit scratch"), { recursive: true, force: true }));

function scratchLayout(): RunLayout {
  const runDir = path.join(scratchRoot, "run");
  const layout: RunLayout = {
    runId: "unit",
    runDir,
    profileDir: path.join(runDir, "profile"),
    dataDir: path.join(runDir, "data"),
    fixturesDir: path.join(runDir, "fixtures"),
    addonsDir: path.join(runDir, "addons"),
    logsDir: path.join(runDir, "logs"),
    token: "ab".repeat(24),
  };
  for (const dir of [layout.profileDir, layout.dataDir, layout.fixturesDir]) fs.mkdirSync(dir, { recursive: true });
  return layout;
}

describe("path safety", () => {
  test("isInside is strict and case-insensitive on Windows", () => {
    assert.equal(isInside(TEST_ROOT, path.join(TEST_ROOT, "a", "b")), true);
    assert.equal(isInside(TEST_ROOT, TEST_ROOT), false);
    assert.equal(isInside(TEST_ROOT, path.join(TEST_ROOT, "..", "elsewhere")), false);
    assert.equal(isInside(TEST_ROOT, `${TEST_ROOT}-sibling`), false);
    if (process.platform === "win32") assert.equal(isInside(TEST_ROOT.toUpperCase(), path.join(TEST_ROOT, "x")), true);
  });

  test("assertTestPath refuses anything outside work/zotero-test and every real Zotero location", () => {
    assert.ok(assertTestPath(path.join(TEST_ROOT, "run", "profile"), "profile"));
    const real = realZoteroLocations();
    for (const forbidden of [real.appDataDir, real.dataDir, path.join(real.appDataDir, "Profiles", "x.default"), TEST_ROOT, "C:/Windows/Temp/x"]) {
      assert.throws(() => assertTestPath(forbidden, "test"), /Refusing/, forbidden);
    }
    assert.throws(() => assertTestPath(path.join(TEST_ROOT, "..", "..", "outputs"), "escape"), /Refusing/);
  });

  test("samePath follows platform case and separator rules and ignores trailing slashes", () => {
    assert.equal(samePath("C:\\A\\b\\", "c:/a/B"), process.platform === "win32");
    assert.equal(samePath("/tmp/A", "/tmp/a"), process.platform === "win32");
    assert.equal(samePath("/tmp/a/", "/tmp/a"), true);
    assert.equal(samePath(null, "x"), false);
  });
});

describe("profile", () => {
  test("test prefs pin the port, data dir, token and disable first-run, updates and Word/LibreOffice installers", () => {
    const layout = scratchLayout();
    const prefs = testProfilePrefs(layout);
    assert.equal(prefs["extensions.zotero.httpServer.port"], TEST_PORT);
    assert.notEqual(TEST_PORT, 23119);
    assert.equal(prefs["extensions.zotero.dataDir"], layout.dataDir);
    assert.equal(prefs["extensions.zotero.useDataDir"], true);
    assert.equal(prefs["extensions.zotero.firstRun2"], false);
    assert.equal(prefs["extensions.zoteroWinWordIntegration.skipInstallation"], true);
    assert.equal(prefs["extensions.zoteroOpenOfficeIntegration.skipInstallation"], true);
    assert.equal(prefs["extensions.autoDisableScopes"], 0);
    assert.equal(prefs["extensions.zab-test.token"], layout.token);
  });

  test("user.js is written inside the throwaway profile with JSON-quoted values", () => {
    const layout = scratchLayout();
    const file = writeUserJs(layout, { "a.b": "C:\\x \"y\"", "c.d": 3, "e.f": false });
    assert.ok(isInside(layout.profileDir, file));
    const text = fs.readFileSync(file, "utf8");
    assert.match(text, /user_pref\("a\.b", "C:\\\\x \\"y\\""\);/);
    assert.match(text, /user_pref\("c\.d", 3\);/);
    assert.match(text, /user_pref\("e\.f", false\);/);
  });

  test("real-profile diff reports every changed field", () => {
    const stamp = { path: "p", exists: true, sha256: "a", size: 1, mtimeMs: 1 };
    assert.deepEqual(diffRealProfileState({ files: [stamp] }, { files: [{ ...stamp }] }), []);
    const diffs = diffRealProfileState({ files: [stamp] }, { files: [{ ...stamp, sha256: "b", mtimeMs: 2 }] });
    assert.equal(diffs.length, 2);
    assert.deepEqual(diffRealProfileState({ files: [stamp] }, { files: [] }), ["p: no longer tracked"]);
  });
});

describe("fingerprints", () => {
  const base: FingerprintResult = {
    ok: true,
    tables: { items: { rows: 2, sha256: "x" } },
    maxima: { "items.maxVersion": 3 },
    files: [{ path: "f", exists: true, size: 10, mtimeMs: 5 }],
  };
  test("identical fingerprints have no diff; table, maximum and file changes are named", () => {
    assert.deepEqual(diffFingerprints(base, structuredClone(base)), []);
    const changed: FingerprintResult = {
      ...structuredClone(base),
      tables: { items: { rows: 2, sha256: "y" } },
      maxima: { "items.maxVersion": 4 },
      files: [{ path: "f", exists: true, size: 10, mtimeMs: 6 }],
    };
    const diffs = diffFingerprints(base, changed);
    assert.equal(diffs.length, 3);
    assert.match(diffs[0] ?? "", /table items: rows 2 -> 2, content changed/);
  });
});

describe("fixtures", () => {
  test("fixture graph is consistent", () => {
    const collections = new Set(COLLECTIONS.map((c) => c.id));
    const items = new Set(ITEMS.map((i) => i.id));
    for (const c of COLLECTIONS) if (c.parent) assert.ok(collections.has(c.parent), c.id);
    for (const i of ITEMS) for (const c of i.collections) assert.ok(collections.has(c), `${i.id} -> ${c}`);
    for (const n of NOTES) if (n.parent) assert.ok(items.has(n.parent), n.id);
    for (const a of ATTACHMENTS) assert.ok(items.has(a.parent), a.id);
    const attachments = new Set(ATTACHMENTS.map((a) => a.id));
    for (const a of ANNOTATIONS) {
      assert.ok(attachments.has(a.attachment), a.id);
      assert.ok(a.pageIndex < PDF_PAGES.length, a.id);
      assert.equal(a.position.pageIndex, a.pageIndex, a.id);
    }
    assert.ok(BULK_ITEM_COUNT > PAGE_LIMIT_MAX, "bulk items must need a second page");
    assert.ok(!FIXTURE_TAGGED_LIVE_ITEMS.includes("item-trashed"));
    assert.equal(new Set([...collections, ...items, ...attachments]).size, collections.size + items.size + attachments.size, "ids unique");
  });

  test("fixture PDF is ASCII with a correct xref table", () => {
    const bytes = buildFixturePdf();
    const text = Buffer.from(bytes).toString("latin1");
    assert.ok(/^[\x00-\x7f]*$/.test(text));
    assert.ok(text.startsWith("%PDF-1.4\n") && text.endsWith("%%EOF\n"));
    const startxref = Number(/startxref\n(\d+)\n/.exec(text)?.[1]);
    assert.ok(text.startsWith("xref\n", startxref), "startxref points at xref");
    const offsets = [...text.slice(startxref).matchAll(/^(\d{10}) 00000 n $/gm)].map((m) => Number(m[1]));
    offsets.forEach((offset, i) => assert.ok(text.startsWith(`${i + 1} 0 obj\n`, offset), `object ${i + 1} offset`));
    assert.match(text, new RegExp(`/Count ${PDF_PAGES.length} `));
  });

  test("fixture files land under the run's fixture directory; missing ones are removed afterwards", () => {
    const layout = scratchLayout();
    const files = prepareFixtureFiles(layout);
    for (const file of Object.values(files)) {
      assert.ok(isInside(layout.fixturesDir, file), file);
      assert.ok(fs.existsSync(file), file);
    }
    assert.match(files.linkedPdf, /链接 附件 目录[\\/]测试 文档 linked\.pdf$/);
    const storedCopy = path.join(layout.dataDir, "storage", "ABCD2345", "missing stored.pdf");
    fs.mkdirSync(path.dirname(storedCopy), { recursive: true });
    fs.writeFileSync(storedCopy, "x");
    const manifest = { attachments: { "att-missing-stored": { libraryID: 1, key: "ABCD2345", id: 1, path: storedCopy } } } as unknown as SeedManifest;
    removeMissingFixtureFiles(files, manifest);
    assert.equal(fs.existsSync(files.missingLinkedPdf), false);
    assert.equal(fs.existsSync(storedCopy), false);
    assert.equal(fs.existsSync(files.linkedPdf), true);
  });
});

describe("raw HTTP client", () => {
  test("asciiJson escapes every non-ASCII code unit and stays parseable", () => {
    const value = { t: "中文 😀 é" };
    const json = asciiJson(value);
    assert.ok(/^[\x00-\x7f]*$/.test(json));
    assert.deepEqual(JSON.parse(json), value);
  });

  test("buildHeaders replaces and removes defaults by lowercase name", () => {
    const headers = buildHeaders(1, "{}", { override: { accept: null, host: "evil:1" }, extraHeaders: [["Origin", "x"]] });
    assert.equal(headers.find(([n]) => n === "Accept"), undefined);
    assert.deepEqual(headers.find(([n]) => n === "Host"), ["Host", "evil:1"]);
    assert.deepEqual(headers.at(-1), ["Origin", "x"]);
    assert.deepEqual(headers.find(([n]) => n === "Content-Length"), ["Content-Length", "2"]);
  });

  test("responses are parsed with raw headers; a silent close is reported as dropped", async () => {
    const server = http.createServer((req, res) => {
      if (req.headers.origin) {
        req.socket.destroy();
        return;
      }
      const body = JSON.stringify({ ok: "中" });
      res.writeHead(200, { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body), Connection: "close" });
      res.end(body);
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as AddressInfo).port;
    try {
      const ok = await postJson(port, "/x", { a: 1 });
      assert.equal(ok.response?.status, 200);
      assert.deepEqual(JSON.parse(ok.response?.body ?? ""), { ok: "中" });
      assert.equal(ok.response?.bodyBytes, Buffer.byteLength(JSON.stringify({ ok: "中" })));
      assert.ok(ok.response?.rawHeaders.some(([n, v]) => n === "Content-Type" && v === "application/json"));
      const dropped = await postJson(port, "/x", {}, { extraHeaders: [["Origin", "http://evil"]] });
      assert.equal(dropped.dropped, true);
      assert.equal(dropped.response, null);
      const refused = await rawRequest({ port: 1, method: "GET", path: "/", headers: [], timeoutMs: 2000 });
      assert.equal(refused.dropped, false);
      assert.ok(refused.error);
    } finally {
      server.close();
    }
  });
});

describe("preferences pane expectations", () => {
  test("parseFtl reads values, .attributes and skips comments; rejects unsupported syntax", () => {
    const parsed = parseFtl("# comment\n\na-b = Value { $port }\nc =\n    .label = Label\n");
    assert.deepEqual(parsed.get("a-b"), { value: "Value { $port }", attributes: {} });
    assert.deepEqual(parsed.get("c"), { value: null, attributes: { label: "Label" } });
    assert.throws(() => parseFtl("a =\n    continued text"), /Unsupported FTL line/);
  });

  test("shipped en-US and zh-CN files parse to the same message ids and attributes", () => {
    const en = readBridgeFtl("en-US");
    const zh = readBridgeFtl("zh-CN");
    assert.deepEqual([...zh.keys()].sort(), [...en.keys()].sort());
    for (const [id, message] of en) {
      assert.ok(id.startsWith("zotero-reading-bridge-"), id);
      assert.deepEqual(Object.keys(zh.get(id)!.attributes), Object.keys(message.attributes), id);
    }
    assert.equal(renderFtlValue(en.get("zotero-reading-bridge-pref-status-running")!.value!, { port: "23139" }), "Running on 127.0.0.1:23139");
    assert.throws(() => renderFtlValue("{ $port }"), /No value/);
    assert.equal(stripIsolationMarks("\u2068x\u2069"), "x");
  });
});

describe("debug log privacy check", () => {
  const prefix = "zotero(3)(+0000001): [Zotero Reading Bridge] ";
  test("accepts the bridge's summary lines and ignores other Zotero lines", () => {
    const check = checkBridgeDebugLines(
      [
        "zotero(3)(+0000000): Installing translator 'x'",
        `${prefix}serving /bridge/mcp on 127.0.0.1:23139`,
        `${prefix}POST tools/call get_status -> 200 ok (954 bytes, 0 ms)`,
        `${prefix}POST tools/call (unknown tool) -> 200 rpc-error (120 bytes, 1 ms)`,
        `${prefix}POST tools/call search_items -> 200 tool-error [TypeError] (90 bytes, 2 ms)`,
        `${prefix}GET - -> 405 rejected (143 bytes, 0 ms)`,
        "zotero(5)(+0000000): [Zotero Reading Bridge] response 202 (0 bytes, body redacted)",
        `${prefix}shutting down (reason 2)`,
      ],
      fixtureTexts(),
    );
    assert.equal(check.bridgeLines, 7);
    assert.deepEqual(check.unexpected, []);
    assert.deepEqual(check.leaking, []);
  });

  test("flags unknown formats and fixture text", () => {
    const title = ITEMS[0]!.title;
    const check = checkBridgeDebugLines([`${prefix}POST tools/call get_items -> 200 ok (1 bytes, 1 ms) ${title}`, `${prefix}args {"query":"${title}"}`], fixtureTexts());
    assert.equal(check.unexpected.length, 2);
    assert.equal(check.leaking.length, 2);
  });
});

describe("case catalogue", () => {
  test("ids are unique, grouped, and every bridge-dependent group declares the bridge requirement", () => {
    const ids = allCases.map((c) => c.id);
    assert.equal(new Set(ids).size, ids.length);
    for (const c of allCases) {
      assert.match(c.id, /^(harness|seed|ui|protocol|tools|context|downloads|lifecycle)\.[\w.-]+$/, c.id);
      const needsBridge = /^(protocol|tools|context|downloads|lifecycle)\./.test(c.id);
      assert.equal(c.requires.includes("bridge"), needsBridge, c.id);
    }
    const order = (prefix: string) => ids.findIndex((id) => id.startsWith(prefix));
    assert.ok(order("seed.fixtures") < order("ui."), "seeding precedes UI cases");
    assert.ok(order("lifecycle.read-only") > order("context."), "read-only proof runs after the context cases");
    assert.equal(ids.at(-1)?.startsWith("lifecycle."), true, "lifecycle cases run last");
  });
});
