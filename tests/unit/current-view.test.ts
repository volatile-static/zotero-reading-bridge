import assert from "node:assert/strict";
import { afterEach, it } from "node:test";
const viewModule = "../../packages/zotero/src/tools/current-view.js";
const { captureCurrentView, createCurrentViewHandler } = await import(viewModule);
const libraryModule = "../../packages/zotero/src/zotero/library.js";
const { resolveLibrary } = await import(libraryModule);
const refsModule = "../../packages/zotero/src/zotero/refs.js";
const { itemSelectURI } = await import(refsModule);

const context = { protocolVersion: "2025-11-25", endpointPath: "/bridge/mcp" };
const original = (globalThis as any).Zotero;
afterEach(() => { (globalThis as any).Zotero = original; });
function item(id: number, libraryID = 1): any {
  return { id, libraryID, key: `KEY${String(id).padStart(5, "0")}`, getDisplayTitle: () => `Item ${id}` };
}
function setup(type: string, items = [item(3), item(1)]) {
  const row = { id: `${type}:1`, type, getName: () => type };
  const view = { waitForLoad: async () => {}, getSortedItems: () => items };
  const win = { Zotero_Tabs: { selectedType: "library" }, ZoteroPane: { itemsView: view, getCollectionTreeRows: () => [row] } };
  (globalThis as any).Zotero = { getMainWindow: () => win };
  return { win, view, row };
}
for (const type of ["library", "group", "collection", "search", "recentlyRead", "publications", "unfiled", "duplicates", "trash", "feeds", "feed"]) {
  it(`reads ${type} in UI order without requiring selection`, async () => {
    setup(type, [item(3, 12), item(1, 4)]);
    const result = await captureCurrentView();
    assert.deepEqual(result.items.map((i: any) => [i.libraryID, i.id]), [[12, 3], [4, 1]]);
    assert.equal(result.rows[0]?.type, type);
  });
}
it("returns an empty view rather than an unavailable error", async () => {
  setup("feeds", []);
  assert.deepEqual((await captureCurrentView()).items, []);
});
it("rejects hidden library trees and a missing window", async () => {
  const { win } = setup("library");
  win.Zotero_Tabs.selectedType = "reader";
  await assert.rejects(captureCurrentView(), /library tab/);
  (globalThis as any).Zotero.getMainWindow = () => null;
  await assert.rejects(captureCurrentView(), /library tab/);
});
it("rejects a view switch while awaiting load", async () => {
  const { view, row } = setup("collection");
  view.waitForLoad = async () => { row.id = "other"; };
  await assert.rejects(captureCurrentView(), /changed while loading/);
});
it("pins pagination across view switches and expires stale cursors", async () => {
  let clock = 1000;
  setup("recentlyRead");
  const handler = createCurrentViewHandler(captureCurrentView, () => clock);
  const first: any = await handler({ limit: 1 }, context);
  assert.equal(first.data.items[0].itemID, 3);
  assert.equal(first.data.total, 2);
  setup("feed", [item(7, 12)]);
  const next: any = await handler({ cursor: first.data.nextCursor }, context);
  assert.equal(next.data.items[0].itemID, 1);
  assert.equal(next.data.view.rows[0].type, "recentlyRead");
  assert.equal(next.data.nextCursor, null);
  const fresh: any = await handler({}, context);
  assert.equal(fresh.data.items[0].libraryID, 12);
  clock += 120001;
  await assert.rejects(handler({ cursor: first.data.nextCursor }, context), /expired/);
  await assert.rejects(handler({ cursor: "o1" }, context), /Invalid view cursor/);
});
it("allows feed library lookup for follow-up item reads", () => {
  const feed = { libraryID: 12, libraryType: "feed" };
  (globalThis as any).Zotero = { Libraries: { get: () => feed } };
  assert.equal(resolveLibrary(12), feed);
  assert.equal(itemSelectURI(12, "KEY00001"), "");
});
