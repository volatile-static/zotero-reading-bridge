import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { createUpdateManifest, ZOTERO_UPDATE_URL } from "../../scripts/lib/updates.js";
import { ZOTERO_ADDON_ID } from "../../shared/types/bridge.js";

const manifest = {
  version: "0.2.2",
  applications: { zotero: {
    id: ZOTERO_ADDON_ID, update_url: ZOTERO_UPDATE_URL,
    strict_min_version: "10.0", strict_max_version: "11.*",
  } },
};

test("update feed identifies the plugin and binds compatibility and hash to its XPI", () => {
  const bytes = Buffer.from("release asset");
  const update = createUpdateManifest(manifest, bytes).addons[ZOTERO_ADDON_ID]!.updates[0]!;
  assert.equal(update.version, "0.2.2");
  assert.equal(update.update_link, "https://github.com/volatile-static/zotero-reading-bridge/releases/download/v0.2.2/zotero-reading-bridge.xpi");
  assert.equal(update.update_hash, `sha256:${createHash("sha256").update(bytes).digest("hex")}`);
  assert.deepEqual(update.applications.zotero, { strict_min_version: "10.0", strict_max_version: "11.*" });
  assert.notEqual(createUpdateManifest(manifest, Buffer.from("changed")).addons[ZOTERO_ADDON_ID]!.updates[0]!.update_hash, update.update_hash);
});

test("release tags support both documented forms and reject mismatched versions", () => {
  const update = createUpdateManifest(manifest, Buffer.alloc(0), "0.2.2").addons[ZOTERO_ADDON_ID]!.updates[0]!;
  assert.ok(update.update_link.includes("/download/0.2.2/"));
  assert.throws(() => createUpdateManifest(manifest, Buffer.alloc(0), "v0.2.1"), /tag must match/);
  assert.throws(() => createUpdateManifest({ ...manifest, applications: {} }, Buffer.alloc(0)), /Invalid Zotero manifest/);
});
