import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveBridgeStatus, type BridgeStatusInputs } from "../../packages/zotero/src/settings/client-config.js";

describe("resolveBridgeStatus", () => {
  const healthy: BridgeStatusInputs = { error: null, port: 23119, loopbackVerified: true };

  it("is running only when every precondition holds", () => {
    assert.equal(resolveBridgeStatus(healthy), "running");
  });

  it("applies precedence: error, server-not-running, loopback-unverified", () => {
    const cases: Array<[Partial<BridgeStatusInputs>, string]> = [
      [{ error: "boom", port: null, loopbackVerified: false }, "error"],
      [{ port: null, loopbackVerified: false }, "server-not-running"],
      [{ loopbackVerified: false }, "loopback-unverified"],
    ];
    for (const [override, expected] of cases) {
      assert.equal(resolveBridgeStatus({ ...healthy, ...override }), expected, JSON.stringify(override));
    }
  });
});
