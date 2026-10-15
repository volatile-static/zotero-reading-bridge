import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { checkAccess } from "../../packages/zotero/src/server/access.js";

const PORT = 23119;

describe("checkAccess", () => {
  it("allows loopback hosts on the Zotero port", () => {
    for (const host of ["127.0.0.1:23119", "localhost:23119", "LOCALHOST:23119", "[::1]:23119", " 127.0.0.1:23119 "]) {
      assert.equal(checkAccess({ host }, PORT), null, host);
    }
  });

  it("rejects any Origin header, including null and empty values", () => {
    for (const origin of ["https://evil.example", "null", "", "http://127.0.0.1:23119"]) {
      const denied = checkAccess({ host: "127.0.0.1:23119", origin }, PORT);
      assert.equal(denied?.status, 403, JSON.stringify(origin));
      assert.match(denied?.message ?? "", /Origin/);
    }
  });

  it("rejects missing and non-loopback hosts", () => {
    for (const host of [undefined, "", "example.com:23119", "127.0.0.2:23119", "localhost.evil.com:23119", "0.0.0.0:23119", "::1", "127.0.0.1:23119/x"]) {
      assert.equal(checkAccess({ host }, PORT)?.status, 403, String(host));
    }
  });

  it("requires the Host port to equal the Zotero port", () => {
    assert.equal(checkAccess({ host: "127.0.0.1:8080" }, PORT)?.status, 403);
    assert.equal(checkAccess({ host: "127.0.0.1" }, PORT)?.status, 403, "no port means 80");
    assert.equal(checkAccess({ host: "127.0.0.1" }, 80), null);
    assert.match(checkAccess({ host: "localhost:1" }, PORT)?.message ?? "", /port/);
  });

  it("skips only the port comparison when the port is unknown", () => {
    assert.equal(checkAccess({ host: "127.0.0.1:1" }, null), null);
    assert.equal(checkAccess({ host: "127.0.0.1" }, null), null);
    assert.equal(checkAccess({ host: "evil.example" }, null)?.status, 403);
  });
});
