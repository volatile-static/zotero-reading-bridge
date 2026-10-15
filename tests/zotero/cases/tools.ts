/**
 * Happy and error paths of the 18 tools against the seeded fixture library (DESIGN 2.C behaviour,
 * shared/types/tools.ts shapes). Expected values come from fixtures/data.ts and the seed manifest.
 */
import assert from "node:assert/strict";
import path from "node:path";
import { ENDPOINT_PATH, PAGE_LIMIT_MAX } from "../../../shared/types/bridge.js";
import { SUPPORTED_PROTOCOL_VERSIONS } from "../../../shared/types/mcp.js";
import {
  ANNOTATIONS,
  BULK_ITEM_COUNT,
  BULK_TAG,
  FIXTURE_TAG,
  FIXTURE_TAGGED_LIVE_ITEMS,
  GROUP,
  GROUP_TAG,
  LONG_NOTE_REPEAT,
  LONG_NOTE_UNIT,
  PDF_FIRST_PAGE_LABEL,
  bulkTitle,
} from "../fixtures/data.js";
import { samePath } from "../lib/fixture-files.js";
import { isInside } from "../lib/paths.js";
import type { McpClient } from "../lib/mcp.js";
import { assertJsonResponse } from "./protocol.js";
import { SkipCase, fixtureKey, fixtureKeys, requireManifest, type HarnessContext, type TestCase } from "./types.js";

const MISSING_KEY = "ZZZZZZZZ";
const NO_SUCH_LIBRARY = 999999;

function sortedKeys(items: Array<{ key: string }>): string[] {
  return items.map((item) => item.key).sort();
}

function assertPage(page: any, what: string): void {
  assert.ok(Array.isArray(page?.items), `${what}: items`);
  for (const field of ["total", "offset", "limit"]) assert.equal(typeof page[field], "number", `${what}: ${field}`);
  assert.ok(page.nextCursor === null || typeof page.nextCursor === "string", `${what}: nextCursor`);
}

/** Every page of a list tool, following nextCursor; checks the envelope on the way. */
async function allPages(client: McpClient, tool: string, args: Record<string, unknown>, pick: (result: any) => any = (r) => r): Promise<any[]> {
  const items: any[] = [];
  let cursor: string | null = null;
  for (let guard = 0; guard < 50; guard++) {
    const page = pick(await client.tool(tool, cursor ? { ...args, cursor } : args));
    assertPage(page, tool);
    items.push(...page.items);
    cursor = page.nextCursor;
    if (!cursor) return items;
  }
  throw new Error(`${tool}: more than 50 pages`);
}

function storagePath(ctx: HarnessContext, key: string): string {
  return path.join(ctx.layout.dataDir, "storage", key);
}

function lib(ctx: HarnessContext): number {
  return requireManifest(ctx).userLibraryID;
}

export const toolCases: TestCase[] = [
  {
    id: "tools.get_status",
    title: "get_status reports bridge, endpoints on the test port, Zotero 11 and the libraries",
    requires: ["bridge", "fixtures"],
    async run(ctx) {
      const status = await ctx.mcp().tool("get_status");
      assert.equal(status.bridge.name, "zotero-ai-bridge");
      assert.equal(status.bridge.status, "running");
      // No "enabled" field: the bridge has no switch of its own (disabling the plugin removes the endpoint).
      assert.deepEqual(Object.keys(status.bridge).sort(), [
        "endpoints",
        "loopbackVerified",
        "name",
        "protocolVersion",
        "protocolVersions",
        "readOnly",
        "requestPath",
        "status",
        "title",
        "version",
      ]);
      assert.equal(status.bridge.readOnly, true);
      assert.equal(status.bridge.loopbackVerified, true);
      assert.deepEqual(status.bridge.protocolVersions, [...SUPPORTED_PROTOCOL_VERSIONS]);
      assert.deepEqual(
        [...status.bridge.endpoints].sort((a: any, b: any) => a.path.localeCompare(b.path)),
        [
          { path: "/bridge/mcp", url: `http://127.0.0.1:${ctx.port}/bridge/mcp` },
          { path: "/codex/mcp", url: `http://127.0.0.1:${ctx.port}/codex/mcp` },
        ],
      );
      assert.equal(status.bridge.requestPath, ENDPOINT_PATH);
      assert.equal(status.zotero.port, ctx.port);
      assert.match(status.zotero.version, /^11\./);
      assert.equal(status.zotero.platform, "windows");
      assert.ok(status.libraries.some((l: any) => l.libraryID === lib(ctx) && l.type === "user"));
      assert.ok(!Number.isNaN(Date.parse(status.time)), "time");
      return { bridge: { version: status.bridge.version, status: status.bridge.status }, zotero: status.zotero };
    },
  },
  {
    id: "tools.list_libraries",
    title: "list_libraries lists the user library (and the fixture group) with pagination",
    requires: ["bridge", "fixtures"],
    async run(ctx) {
      const client = ctx.mcp();
      const page = await client.tool("list_libraries");
      assertPage(page, "list_libraries");
      const user = page.items.find((l: any) => l.libraryID === lib(ctx));
      assert.equal(user?.type, "user");
      // No library-root link: Zotero 11 has no zotero://select route for a library root (it would do nothing).
      assert.equal("uri" in (user ?? {}), false);
      assert.ok(page.items.every((l: any) => l.type !== "feed"), "feeds must be excluded");
      const group = requireManifest(ctx).group;
      if (group) {
        const listed = page.items.find((l: any) => l.libraryID === group.libraryID);
        assert.equal(listed?.type, "group");
        assert.equal(listed?.groupID, group.groupID);
        assert.equal(listed?.name, GROUP.name);
        const first = await client.tool("list_libraries", { limit: 1 });
        assert.equal(first.items.length, 1);
        assert.ok(first.nextCursor, "nextCursor with limit 1");
        const second = await client.tool("list_libraries", { limit: 1, cursor: first.nextCursor });
        assert.notEqual(second.items[0].libraryID, first.items[0].libraryID);
      }
      return { libraries: page.items };
    },
  },
  {
    id: "tools.list_collections",
    title: "list_collections: top level, children, recursive depth, item counts",
    requires: ["bridge", "fixtures"],
    async run(ctx) {
      const client = ctx.mcp();
      const top = await client.tool("list_collections");
      assertPage(top, "list_collections");
      assert.deepEqual(sortedKeys(top.items), fixtureKeys(ctx, ["col-root", "col-bulk", "col-empty"]).sort());
      const byKey = (items: any[], id: string) => items.find((c: any) => c.key === fixtureKey(ctx, id));
      assert.equal(byKey(top.items, "col-bulk")?.itemCount, BULK_ITEM_COUNT);
      assert.equal(byKey(top.items, "col-empty")?.itemCount, 0);
      assert.equal(byKey(top.items, "col-root")?.childCollectionCount, 1);
      assert.equal(byKey(top.items, "col-root")?.name, "中文研究 Root Collection");

      const children = await client.tool("list_collections", { parentKey: fixtureKey(ctx, "col-root") });
      assert.deepEqual(sortedKeys(children.items), [fixtureKey(ctx, "col-child")]);

      const tree = await client.tool("list_collections", { recursive: true });
      const grandchild = byKey(tree.items, "col-grandchild");
      assert.equal(grandchild?.depth, 2);
      assert.equal(grandchild?.parentKey, fixtureKey(ctx, "col-child"));
      assert.equal(tree.total, 5);

      const noCounts = await client.tool("list_collections", { includeItemCounts: false });
      assert.ok(noCounts.items.every((c: any) => !("itemCount" in c)), "itemCount must be omitted");

      const missing = await client.toolError("list_collections", { parentKey: MISSING_KEY });
      assert.equal(missing.code, "NOT_FOUND");
      const badLibrary = await client.toolError("list_collections", { libraryID: NO_SUCH_LIBRARY });
      assert.equal(badLibrary.code, "LIBRARY_NOT_FOUND");
      return { top: top.items.map((c: any) => [c.name, c.itemCount]) };
    },
  },
  {
    id: "tools.get_collection",
    title: "get_collection: path, subcollections, items (trash excluded), >200-item paging",
    requires: ["bridge", "fixtures"],
    async run(ctx) {
      const client = ctx.mcp();
      const grand = await client.tool("get_collection", { key: fixtureKey(ctx, "col-grandchild") });
      assert.deepEqual(grand.path.map((c: any) => c.key), fixtureKeys(ctx, ["col-root", "col-child", "col-grandchild"]));
      assert.deepEqual(grand.items.items.map((i: any) => i.key), [fixtureKey(ctx, "item-mixed")]);
      assert.equal(grand.collection.depth, 2);

      const root = await client.tool("get_collection", { key: fixtureKey(ctx, "col-root") });
      assert.deepEqual(root.subcollections.map((c: any) => c.key), [fixtureKey(ctx, "col-child")]);
      assert.equal(root.subcollectionsTruncated, false);
      assert.equal(root.includesSubcollections, false, "Zotero's 'Show Items from Subcollections' is off by default");
      assert.equal(root.collection.childCollectionCount, 1);
      const rootKeys = root.items.items.map((i: any) => i.key);
      for (const id of ["item-zh-article", "item-pdf-parent"]) assert.ok(rootKeys.includes(fixtureKey(ctx, id)), `${id} in root`);
      assert.ok(!rootKeys.includes(fixtureKey(ctx, "item-trashed")), "trashed item listed in collection");

      const bulkKey = requireManifest(ctx).bulk.collectionKey;
      const first = await client.tool("get_collection", { key: bulkKey, limit: PAGE_LIMIT_MAX });
      assert.equal(first.items.total, BULK_ITEM_COUNT);
      assert.equal(first.items.items.length, PAGE_LIMIT_MAX);
      assert.ok(first.items.nextCursor);
      const second = await client.tool("get_collection", { key: bulkKey, limit: PAGE_LIMIT_MAX, cursor: first.items.nextCursor });
      assert.equal(second.items.items.length, BULK_ITEM_COUNT - PAGE_LIMIT_MAX);
      assert.equal(second.items.nextCursor, null);
      const union = new Set([...first.items.items, ...second.items.items].map((i: any) => i.key));
      assert.deepEqual([...union].sort(), [...requireManifest(ctx).bulk.keys].sort());

      const noItems = await client.tool("get_collection", { key: bulkKey, includeItems: false });
      assert.equal(noItems.items, null);
      assert.equal((await client.toolError("get_collection", { key: MISSING_KEY })).code, "NOT_FOUND");
      return { path: grand.path.map((c: any) => c.name) };
    },
  },
  {
    id: "tools.subcollection-items",
    title: "get_collection, list_collections and search_items(collectionKey) follow 'Show Items from Subcollections' alike",
    requires: ["bridge", "fixtures"],
    async run(ctx) {
      const client = ctx.mcp();
      const rootKey = fixtureKey(ctx, "col-root");
      const direct = await client.tool("get_collection", { key: rootKey, limit: PAGE_LIMIT_MAX });
      const directSearch = await client.tool("search_items", { collectionKey: rootKey, limit: PAGE_LIMIT_MAX });
      assert.equal(direct.includesSubcollections, false);
      assert.deepEqual(sortedKeys(direct.items.items), sortedKeys(directSearch.items), "direct members: get_collection = search_items");
      assert.equal(direct.collection.itemCount, direct.items.total);
      for (const id of ["item-en-book", "item-mixed"]) assert.ok(!sortedKeys(direct.items.items).includes(fixtureKey(ctx, id)), id);
      try {
        const pref = await ctx.seed.pref({ name: "extensions.zotero.recursiveCollections", value: true });
        assert.equal(pref.value, true);
        const all = await client.tool("get_collection", { key: rootKey, limit: PAGE_LIMIT_MAX });
        const allSearch = await client.tool("search_items", { collectionKey: rootKey, limit: PAGE_LIMIT_MAX });
        assert.equal(all.includesSubcollections, true);
        const keys = sortedKeys(all.items.items);
        for (const id of ["item-en-book", "item-mixed"]) assert.ok(keys.includes(fixtureKey(ctx, id)), `${id} from a subcollection`);
        assert.deepEqual(keys, sortedKeys(allSearch.items), "with the option on: get_collection = search_items");
        assert.equal(all.collection.itemCount, all.items.total, "itemCount matches the listed items");
        const top = await client.tool("list_collections");
        assert.equal(top.items.find((c: any) => c.key === rootKey)?.itemCount, all.items.total, "list_collections counts alike");
        return { direct: direct.items.total, withSubcollections: all.items.total };
      } finally {
        await ctx.seed.pref({ name: "extensions.zotero.recursiveCollections", value: null });
      }
    },
  },
  {
    id: "tools.saved_searches",
    title: "list_saved_searches and run_saved_search (trashed results excluded)",
    requires: ["bridge", "fixtures"],
    async run(ctx) {
      const client = ctx.mcp();
      const list = await client.tool("list_saved_searches");
      assertPage(list, "list_saved_searches");
      const search = list.items.find((s: any) => s.key === fixtureKey(ctx, "search-fixture-tag"));
      assert.equal(search?.name, "保存的搜索 Fixture Tag");
      assert.match(search?.conditions ?? "", /tag/i);
      const run = await client.tool("run_saved_search", { key: fixtureKey(ctx, "search-fixture-tag") });
      assertPage(run, "run_saved_search");
      assert.equal(run.search.key, fixtureKey(ctx, "search-fixture-tag"));
      assert.deepEqual(sortedKeys(run.items), fixtureKeys(ctx, FIXTURE_TAGGED_LIVE_ITEMS).sort());
      assert.equal((await client.toolError("run_saved_search", { key: MISSING_KEY })).code, "NOT_FOUND");
      return { conditions: search?.conditions, results: run.total };
    },
  },
  {
    id: "tools.search_items",
    title: "search_items: Chinese query, creator, tags, itemType, collection, modes, parent mapping, errors",
    requires: ["bridge", "fixtures"],
    async run(ctx) {
      const client = ctx.mcp();
      const keys = async (args: Record<string, unknown>) => sortedKeys((await client.tool("search_items", args)).items);
      const has = (list: string[], id: string) => list.includes(fixtureKey(ctx, id));

      assert.ok(has(await keys({ query: "深度学习" }), "item-zh-article"), "Chinese title query");
      assert.ok(has(await keys({ query: "Mixed 标题" }), "item-mixed"), "mixed-script title query");
      assert.ok(has(await keys({ creator: "张" }), "item-zh-article"), "Chinese creator");
      assert.deepEqual(await keys({ tags: ["机器学习"] }), fixtureKeys(ctx, ["item-zh-article"]), "Chinese tag");
      assert.deepEqual(await keys({ itemType: "book", tags: [FIXTURE_TAG] }), fixtureKeys(ctx, ["item-en-book"]), "itemType + tag");
      const inRoot = await keys({ collectionKey: fixtureKey(ctx, "col-root") });
      assert.ok(has(inRoot, "item-zh-article") && has(inRoot, "item-pdf-parent"), "collection filter");
      assert.ok(!has(inRoot, "item-trashed"), "trashed item in collection search");
      assert.deepEqual(await keys({ query: "Trashed Fixture" }), [], "trashed items are excluded from search");
      assert.ok(has(await keys({ query: "计算机学报", mode: "fields" }), "item-zh-article"), "fields mode");
      // Note text matches map to the top-level parent unless child items are requested.
      const noteHit = await keys({ query: "长笔记内容", mode: "everything" });
      assert.ok(has(noteHit, "item-en-book"), "note match mapped to parent");
      assert.ok(!noteHit.includes(fixtureKey(ctx, "note-long")), "child note listed without includeChildItems");
      assert.ok(has(await keys({ query: "长笔记内容", mode: "everything", includeChildItems: true }), "note-long"), "includeChildItems");

      const hit = (await client.tool("search_items", { tags: ["机器学习"] })).items[0];
      assert.equal(hit.title, "深度学习在文献管理中的应用研究");
      // Two creators: Zotero's firstCreator wraps each name in invisible bidi isolates; summaries carry none.
      assert.match(hit.creatorSummary, /^张 \S+ 李$/);
      assert.doesNotMatch(hit.creatorSummary, /[\u2068\u2069]/);
      assert.ok(has(await keys({ creator: hit.creatorSummary.split(" ")[0] }), "item-zh-article"), "creator copied from a summary");
      // A conference paper's venue is proceedingsTitle, mapped to publicationTitle in summaries.
      const mixed = (await client.tool("search_items", { query: "Mixed 标题" })).items.find((i: any) => i.key === fixtureKey(ctx, "item-mixed"));
      assert.equal(mixed?.publicationTitle, "会议论文集 Proceedings");
      assert.equal(mixed?.year, "2021");

      // The full-text index cannot answer short or mixed CJK/Latin terms: named errors instead of a silent drop or a
      // scan of every attachment.
      const shortWord = await client.toolError("search_items", { query: "AI ethics", mode: "fulltext" });
      assert.equal(shortWord.code, "INVALID_ARGUMENT");
      assert.deepEqual((shortWord.details?.["unsearchableTerms"] as any[])?.map((t) => t.term), ["AI"]);
      const mixedTerm = await client.toolError("search_items", { query: '"AI模型"', mode: "fulltext" });
      assert.match(mixedTerm.message, /mixes CJK characters with Latin letters or digits/);
      assert.equal((await client.toolError("search_items", { query: '深度 "AI模型"', mode: "everything" })).code, "INVALID_ARGUMENT");
      await client.tool("search_items", { query: "AI模型", mode: "everything" });
      assert.equal(hit.DOI, "10.1234/zab.2023.001");
      assert.equal(hit.year, "2023");
      assert.equal(hit.uri, `zotero://select/library/items/${fixtureKey(ctx, "item-zh-article")}`);

      assert.equal((await client.toolError("search_items", {})).code, "INVALID_ARGUMENT");
      assert.equal((await client.toolError("search_items", { itemType: "notAType" })).code, "INVALID_ARGUMENT");
      assert.equal((await client.toolError("search_items", { query: "x", libraryID: NO_SUCH_LIBRARY })).code, "LIBRARY_NOT_FOUND");
      assert.equal((await client.toolError("search_items", { query: "x", cursor: "garbage" })).code, "INVALID_ARGUMENT");
    },
  },
  {
    id: "tools.pagination",
    title: "Paging over the 230 bulk items: 200 + 30, disjoint, title order, exact Content-Length",
    requires: ["bridge", "fixtures"],
    async run(ctx) {
      const client = ctx.mcp();
      const args = { tags: [BULK_TAG], sort: "title", direction: "asc", limit: PAGE_LIMIT_MAX };
      const raw = await client.rpc("tools/call", { name: "search_items", arguments: args });
      assertJsonResponse(raw.http, "200-item page");
      const first = JSON.parse(raw.message.result.content[0].text);
      assert.equal(first.total, BULK_ITEM_COUNT);
      assert.equal(first.items.length, PAGE_LIMIT_MAX);
      assert.deepEqual(first.items.map((i: any) => i.title), Array.from({ length: PAGE_LIMIT_MAX }, (_, i) => bulkTitle(i)));
      const second = await client.tool("search_items", { ...args, cursor: first.nextCursor });
      assert.equal(second.items.length, BULK_ITEM_COUNT - PAGE_LIMIT_MAX);
      assert.equal(second.nextCursor, null);
      assert.equal(second.offset, PAGE_LIMIT_MAX);
      const all = [...first.items, ...second.items].map((i: any) => i.key);
      assert.equal(new Set(all).size, BULK_ITEM_COUNT, "pages overlap");
      assert.deepEqual([...all].sort(), [...requireManifest(ctx).bulk.keys].sort());
      const defaultPage = await client.tool("search_items", { tags: [BULK_TAG] });
      assert.equal(defaultPage.items.length, 50, "default limit");
      const desc = await client.tool("search_items", { tags: [BULK_TAG], sort: "title", direction: "desc", limit: 1 });
      assert.equal(desc.items[0].title, bulkTitle(BULK_ITEM_COUNT - 1));
      return { firstPageBytes: raw.http.bodyBytes, ms: raw.ms };
    },
  },
  {
    id: "tools.get_items",
    title: "get_items: fields, creators, tags, collections, children, trashed flag, notFound",
    requires: ["bridge", "fixtures"],
    async run(ctx) {
      const client = ctx.mcp();
      const keys = [...fixtureKeys(ctx, ["item-zh-article", "item-pdf-parent", "item-trashed", "item-mixed"]), MISSING_KEY];
      const result = await client.tool("get_items", { keys });
      assert.deepEqual(result.notFound, [MISSING_KEY]);
      const byId = (id: string) => result.items.find((i: any) => i.key === fixtureKey(ctx, id));
      const zh = byId("item-zh-article");
      assert.equal(zh.title, "深度学习在文献管理中的应用研究");
      assert.equal(zh.itemType, "journalArticle");
      assert.equal(zh.fields.publicationTitle, "计算机学报");
      assert.equal(zh.fields.abstractNote, "本文提出一种用于测试的文献管理方法。");
      assert.deepEqual(zh.creators, [
        { creatorType: "author", lastName: "张", firstName: "伟" },
        { creatorType: "author", lastName: "李", firstName: "娜" },
      ]);
      assert.deepEqual(zh.tags.map((t: any) => t.tag).sort(), ["机器学习", FIXTURE_TAG].sort());
      assert.deepEqual(zh.collections, [fixtureKey(ctx, "col-root")]);
      assert.equal(zh.deleted, false);
      assert.equal(byId("item-trashed").deleted, true);
      assert.equal(byId("item-mixed").title, "混合 Mixed 标题 with spaces & <symbols>");
      assert.deepEqual(byId("item-mixed").creators, [{ creatorType: "author", name: "中国科学院 Fixture Institute" }]);
      // Base-mapped fields and clean creator summaries in the detail view too.
      assert.equal(byId("item-mixed").publicationTitle, "会议论文集 Proceedings");
      assert.equal(byId("item-mixed").fields.proceedingsTitle, "会议论文集 Proceedings");
      assert.doesNotMatch(zh.creatorSummary, /[\u2068\u2069]/);
      const parent = byId("item-pdf-parent");
      assert.deepEqual([parent.children.noteCount, parent.children.attachmentCount, parent.children.truncated], [1, 1, false]);
      assert.deepEqual(parent.children.notes.map((n: any) => n.key), [fixtureKey(ctx, "note-child")]);
      const att = parent.children.attachments[0];
      assert.equal(att.key, fixtureKey(ctx, "att-stored-pdf"));
      assert.equal(att.linkMode, "imported_file");
      assert.equal(att.contentType, "application/pdf");
      assert.equal(att.filename, "fixture.pdf");
      const bare = await client.tool("get_items", { keys: [fixtureKey(ctx, "item-pdf-parent")], includeChildren: false });
      assert.equal(bare.items[0].children, null);
      const annotation = (await client.tool("get_items", { keys: [fixtureKey(ctx, "ann-highlight")] })).items[0];
      assert.equal(annotation.fields.annotationText, "Selection target: alpha beta gamma delta");
      assert.equal((await client.toolError("get_items", { keys: [] })).code, "INVALID_ARGUMENT");
    },
  },
  {
    id: "tools.get_item_children",
    title: "get_item_children: notes + attachments of an item, annotations of an attachment, type filter",
    requires: ["bridge", "fixtures"],
    async run(ctx) {
      const client = ctx.mcp();
      const children = await client.tool("get_item_children", { key: fixtureKey(ctx, "item-pdf-parent") });
      assert.deepEqual(
        children.items.map((c: any) => [c.childType, c.key]),
        [
          ["note", fixtureKey(ctx, "note-child")],
          ["attachment", fixtureKey(ctx, "att-stored-pdf")],
        ],
      );
      const onlyAttachments = await client.tool("get_item_children", { key: fixtureKey(ctx, "item-missing-parent"), types: ["attachment"] });
      assert.deepEqual(sortedKeys(onlyAttachments.items), fixtureKeys(ctx, ["att-missing-linked", "att-missing-stored"]).sort());
      const annotations = await client.tool("get_item_children", { key: fixtureKey(ctx, "att-stored-pdf") });
      assert.equal(annotations.total, ANNOTATIONS.length);
      assert.ok(annotations.items.every((c: any) => c.childType === "annotation"));
      assert.equal((await client.toolError("get_item_children", { key: fixtureKey(ctx, "note-child") })).code, "WRONG_ITEM_TYPE");
      assert.equal((await client.toolError("get_item_children", { key: MISSING_KEY })).code, "NOT_FOUND");
    },
  },
  {
    id: "tools.list_tags",
    title: "list_tags: Chinese substring filter, counts exclude trash, paging",
    requires: ["bridge", "fixtures"],
    async run(ctx) {
      const client = ctx.mcp();
      const zh = await client.tool("list_tags", { query: "机器" });
      assert.deepEqual(zh.items.map((t: any) => [t.tag, t.type, t.itemCount]), [["机器学习", 0, 1]]);
      const bulk = await client.tool("list_tags", { query: BULK_TAG });
      assert.equal(bulk.items.find((t: any) => t.tag === BULK_TAG)?.itemCount, BULK_ITEM_COUNT);
      const fixture = await client.tool("list_tags", { query: FIXTURE_TAG });
      assert.equal(fixture.items.find((t: any) => t.tag === FIXTURE_TAG)?.itemCount, FIXTURE_TAGGED_LIVE_ITEMS.length, "trashed item counted");
      const paged = await client.tool("list_tags", { limit: 2 });
      assert.equal(paged.items.length, 2);
      assert.ok(paged.nextCursor);
      const every = await allPages(client, "list_tags", { limit: 3 });
      assert.equal(every.length, paged.total);
      return { total: paged.total };
    },
  },
  {
    id: "tools.cache-invalidation",
    title: "Cached tag counts and search results follow a library change at once (Notifier invalidation)",
    requires: ["bridge", "fixtures"],
    async run(ctx) {
      const client = ctx.mcp();
      const libraryID = lib(ctx);
      const key = fixtureKey(ctx, "item-linked-parent");
      const probe = "zab-cache-probe";
      const tagged = async () => sortedKeys((await client.tool("search_items", { tags: [probe] })).items);
      // Fill the caches (the second calls are served from them).
      for (let i = 0; i < 2; i++) {
        assert.equal((await client.tool("list_tags", { query: probe })).total, 0);
        assert.deepEqual(await tagged(), []);
      }
      let added: string[] = [];
      try {
        added = (await ctx.seed.tag({ libraryID, key, tag: probe, action: "add" })).tags;
        assert.ok(added.includes(probe));
        const listed = await client.tool("list_tags", { query: probe });
        assert.deepEqual(listed.items.map((t: any) => [t.tag, t.itemCount]), [[probe, 1]], "list_tags after adding a tag");
        assert.deepEqual(await tagged(), [key], "search_items after adding a tag");
      } finally {
        await ctx.seed.tag({ libraryID, key, tag: probe, action: "remove" });
      }
      assert.equal((await client.tool("list_tags", { query: probe })).total, 0, "list_tags after removing the tag");
      assert.deepEqual(await tagged(), [], "search_items after removing the tag");
      return { tagsWhileAdded: added };
    },
  },
  {
    id: "tools.get_notes",
    title: "get_notes: HTML and plain text, regular item -> child notes, truncation, wrong type",
    requires: ["bridge", "fixtures"],
    async run(ctx) {
      const client = ctx.mcp();
      const child = await client.tool("get_notes", { key: fixtureKey(ctx, "note-child") });
      assert.equal(child.items.length, 1);
      const note = child.items[0];
      assert.match(note.html, /<strong>bold<\/strong>/);
      assert.match(note.text, /第一段落/);
      assert.match(note.text, /bold & entity/);
      assert.match(note.text, /列表项一/);
      assert.doesNotMatch(note.text, /<[a-z]/i, "plain text still contains markup");
      assert.equal(note.noteTitle, "笔记标题 Fixture Note");
      assert.equal(note.parentKey, fixtureKey(ctx, "item-pdf-parent"));
      assert.equal(note.truncated, false);

      const viaParent = await client.tool("get_notes", { key: fixtureKey(ctx, "item-pdf-parent") });
      assert.deepEqual(sortedKeys(viaParent.items), [fixtureKey(ctx, "note-child")]);

      const longDefault = (await client.tool("get_notes", { key: fixtureKey(ctx, "note-long") })).items[0];
      assert.equal(longDefault.truncated, true);
      assert.ok(longDefault.length >= LONG_NOTE_UNIT.trim().length * LONG_NOTE_REPEAT, `length ${longDefault.length}`);
      assert.ok(longDefault.text.length <= 20000, `text ${longDefault.text.length} chars`);
      const short = (await client.tool("get_notes", { key: fixtureKey(ctx, "note-long"), maxLength: 100, includeHtml: false })).items[0];
      assert.equal(short.html, null);
      assert.ok(short.text.length <= 100);
      assert.equal(short.truncated, true);

      const standalone = (await client.tool("get_notes", { key: fixtureKey(ctx, "note-standalone") })).items[0];
      assert.match(standalone.text, /深度学习/);
      assert.equal(standalone.parentKey, null);
      // Attachment notes (the attachment pane's note) are reachable; an attachment without one gives an empty page.
      const attachmentNote = await client.tool("get_notes", { key: fixtureKey(ctx, "att-linked-pdf") });
      assert.deepEqual(attachmentNote.items.map((n: any) => n.key), [fixtureKey(ctx, "att-linked-pdf")]);
      assert.match(attachmentNote.items[0].text, /附件笔记 Attachment note on the linked PDF/);
      assert.equal((await client.tool("get_notes", { key: fixtureKey(ctx, "att-stored-pdf") })).items.length, 0);
      assert.equal((await client.toolError("get_notes", { key: fixtureKey(ctx, "ann-ink") })).code, "WRONG_ITEM_TYPE");
      return { text: note.text };
    },
  },
  {
    id: "tools.get_annotations",
    title: "get_annotations: six types, reader order, Chinese text, position, links, filters",
    requires: ["bridge", "fixtures"],
    async run(ctx) {
      const client = ctx.mcp();
      const attKey = fixtureKey(ctx, "att-stored-pdf");
      const all = await client.tool("get_annotations", { key: attKey });
      assert.equal(all.total, ANNOTATIONS.length);
      // Reader order = sortIndex: page 0 (highlight, text), page 1 (underline, note), page 2 (image, ink).
      assert.deepEqual(all.items.map((a: any) => a.key), fixtureKeys(ctx, ["ann-highlight", "ann-text", "ann-underline", "ann-note", "ann-image", "ann-ink"]));
      for (const spec of ANNOTATIONS) {
        const ann = all.items.find((a: any) => a.key === fixtureKey(ctx, spec.id));
        assert.equal(ann.annotationType, spec.type, `${spec.id} type`);
        assert.equal(ann.comment ?? "", spec.comment, `${spec.id} comment`);
        assert.equal(ann.color, spec.color, `${spec.id} color`);
        assert.equal(ann.pageLabel, String(PDF_FIRST_PAGE_LABEL + spec.pageIndex), `${spec.id} pageLabel`);
        assert.equal(ann.pageIndex, spec.pageIndex, `${spec.id} pageIndex`);
        assert.deepEqual(ann.position, spec.position, `${spec.id} position`);
        assert.equal(ann.attachmentKey, attKey);
        assert.equal(ann.parentItemKey, fixtureKey(ctx, "item-pdf-parent"));
        assert.equal(ann.link, `zotero://open-pdf/library/items/${attKey}?page=${spec.pageIndex + 1}&annotation=${ann.key}`);
        if (spec.text !== undefined) assert.equal(ann.text, spec.text, `${spec.id} text`);
      }
      const highlight = all.items[0];
      assert.deepEqual(highlight.tags.map((t: any) => t.tag), ["标注标签"]);

      const filtered = await client.tool("get_annotations", { key: attKey, types: ["highlight", "underline"] });
      assert.deepEqual(sortedKeys(filtered.items), fixtureKeys(ctx, ["ann-highlight", "ann-underline"]).sort());
      const noPosition = await client.tool("get_annotations", { key: attKey, includePosition: false });
      assert.ok(noPosition.items.every((a: any) => !("position" in a)), "position must be omitted");
      const viaParent = await client.tool("get_annotations", { key: fixtureKey(ctx, "item-pdf-parent") });
      assert.equal(viaParent.total, ANNOTATIONS.length);
      const single = await client.tool("get_annotations", { key: fixtureKey(ctx, "ann-ink") });
      assert.equal(single.items.length, 1);
      assert.equal(single.items[0].annotationType, "ink");
      assert.equal((await client.toolError("get_annotations", { key: fixtureKey(ctx, "note-child") })).code, "WRONG_ITEM_TYPE");
    },
  },
  {
    id: "tools.attachments",
    title: "list_attachments / get_attachment_path: stored, linked (Chinese + space path), missing files",
    requires: ["bridge", "fixtures"],
    async run(ctx) {
      const client = ctx.mcp();
      const observed = ctx.observed?.attachments;
      assert.ok(observed, "seed.query results missing");

      const stored = (await client.tool("list_attachments", { key: fixtureKey(ctx, "item-pdf-parent") })).items;
      assert.equal(stored.length, 1);
      const storedKey = fixtureKey(ctx, "att-stored-pdf");
      assert.equal(stored[0].key, storedKey);
      assert.equal(stored[0].linkMode, "imported_file");
      assert.equal(stored[0].exists, true);
      assert.equal(stored[0].note, null);
      assert.ok(samePath(stored[0].storageDirectory, storagePath(ctx, storedKey)), `storageDirectory ${stored[0].storageDirectory}`);
      assert.ok(isInside(storagePath(ctx, storedKey), stored[0].path), `stored path ${stored[0].path}`);

      const linkedRaw = await client.rpc("tools/call", { name: "list_attachments", arguments: { key: fixtureKey(ctx, "item-linked-parent") } });
      assertJsonResponse(linkedRaw.http, "Chinese path response");
      const linked = JSON.parse(linkedRaw.message.result.content[0].text).items[0];
      assert.equal(linked.linkMode, "linked_file");
      assert.equal(linked.exists, true);
      assert.equal(linked.storageDirectory, null);
      assert.ok(samePath(linked.path, observed["att-linked-pdf"]?.path), `linked path ${linked.path}`);
      assert.match(linked.path, /链接 附件 目录[\\/]测试 文档 linked\.pdf$/);

      const missing = (await client.tool("list_attachments", { key: fixtureKey(ctx, "item-missing-parent") })).items;
      assert.equal(missing.length, 2);
      for (const att of missing) {
        assert.equal(att.exists, false, `${att.key} exists`);
        assert.equal(typeof att.note, "string", `${att.key} note`);
        assert.ok(att.path, `${att.key} expected path`);
      }
      const missingLinked = missing.find((a: any) => a.key === fixtureKey(ctx, "att-missing-linked"));
      assert.ok(samePath(missingLinked.path, observed["att-missing-linked"]?.path));

      const single = await client.tool("list_attachments", { key: storedKey });
      assert.equal(single.items[0].key, storedKey);

      const byAttachment = await client.tool("get_attachment_path", { key: fixtureKey(ctx, "att-linked-pdf") });
      assert.ok(samePath(byAttachment.path, linked.path));
      const best = await client.tool("get_attachment_path", { key: fixtureKey(ctx, "item-pdf-parent") });
      assert.equal(best.key, storedKey);
      assert.equal(best.exists, true);
      assert.equal((await client.toolError("get_attachment_path", { key: fixtureKey(ctx, "item-zh-article") })).code, "NOT_FOUND");
      assert.equal((await client.toolError("get_attachment_path", { key: fixtureKey(ctx, "note-child") })).code, "WRONG_ITEM_TYPE");
      return { stored: stored[0].path, linked: linked.path, missingNotes: missing.map((a: any) => a.note) };
    },
  },
  {
    id: "tools.get_library_paths",
    title: "get_library_paths reports the test data directory, storage and database",
    requires: ["bridge", "fixtures"],
    async run(ctx) {
      const paths = await ctx.mcp().tool("get_library_paths");
      assert.ok(samePath(paths.dataDirectory, ctx.layout.dataDir), `dataDirectory ${paths.dataDirectory}`);
      assert.ok(samePath(paths.storageDirectory, path.join(ctx.layout.dataDir, "storage")), `storage ${paths.storageDirectory}`);
      assert.ok(samePath(paths.database, path.join(ctx.layout.dataDir, "zotero.sqlite")), `database ${paths.database}`);
      assert.equal(paths.linkedAttachmentBaseDirectory, null);
      return paths;
    },
  },
  {
    id: "tools.get_schema",
    title: "get_schema: item types, fields with base mapping, creator types",
    requires: ["bridge", "fixtures"],
    async run(ctx) {
      const client = ctx.mcp();
      const all = await client.tool("get_schema");
      const names = all.itemTypes.map((t: any) => t.itemType);
      for (const name of ["journalArticle", "book", "conferencePaper", "report", "thesis"]) assert.ok(names.includes(name), name);
      const article = await client.tool("get_schema", { itemType: "journalArticle" });
      const fields = article.fields.map((f: any) => f.field);
      for (const name of ["title", "publicationTitle", "DOI", "date"]) assert.ok(fields.includes(name), `field ${name}`);
      assert.equal(article.creatorTypes[0].creatorType, "author");
      assert.equal(article.creatorTypes[0].primary, true);
      const report = await client.tool("get_schema", { itemType: "report" });
      assert.equal(report.fields.find((f: any) => f.field === "institution")?.baseField, "publisher");
      assert.equal((await client.toolError("get_schema", { itemType: "notAType" })).code, "INVALID_ARGUMENT");
      return { itemTypes: names.length };
    },
  },
  {
    id: "tools.group_library",
    title: "Group library: listed, searchable and isolated from the user library",
    requires: ["bridge", "fixtures"],
    async run(ctx) {
      const group = requireManifest(ctx).group;
      if (!group) throw new SkipCase(`group library not seeded: ${requireManifest(ctx).groupError ?? "unknown reason"}`);
      const client = ctx.mcp();
      const groupItem = fixtureKey(ctx, "group-item");
      const found = await client.tool("search_items", { libraryID: group.libraryID, tags: [GROUP_TAG] });
      assert.deepEqual(sortedKeys(found.items), [groupItem]);
      assert.ok(found.items.every((i: any) => i.libraryID === group.libraryID));
      assert.equal(found.items[0].uri, `zotero://select/groups/${group.groupID}/items/${groupItem}`);
      const cols = await client.tool("list_collections", { libraryID: group.libraryID });
      assert.deepEqual(sortedKeys(cols.items), [fixtureKey(ctx, "group-col")]);
      const inUser = await client.tool("get_items", { keys: [groupItem] });
      assert.deepEqual(inUser.notFound, [groupItem], "group item must not resolve in the user library");
      const userSearch = await client.tool("search_items", { tags: [GROUP_TAG] });
      assert.equal(userSearch.total, 0);
    },
  },
];
