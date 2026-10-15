/**
 * Loopback-only verification (DESIGN decision 11): the fail-closed rules over Zotero's server sources.
 * Samples follow Zotero 11.0-beta.1 xpcom/server/server.js (Zotero.Server.init) and Gecko httpd.sys.mjs.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { loopbackSourcesVerified } from "../../packages/zotero/src/server/loopback.js";

const ZOTERO_INIT = `async function (port) {
    if (serv) { Zotero.debug("Already listening on port " + serv.port); return; }
    await Zotero.Server.LocalAPI.init();
    port = port || Zotero.Prefs.get('httpServer.port');
    try {
      serv = new HttpServer();
      serv.registerPrefixHandler('/', this.handleRequest);
      serv.start(port);
      Zotero.debug(\`HTTP server listening on 127.0.0.1:\${serv.identity.primaryPort}\`);
    } catch (e) { Zotero.logError(e); }
  }`;
const HTTPD_START = `start(port) {
    this._start(port, "localhost");
  }`;

describe("loopbackSourcesVerified", () => {
  it("accepts Zotero 11's start(port) with httpd binding \"localhost\"", () => {
    assert.equal(loopbackSourcesVerified(ZOTERO_INIT, HTTPD_START), true);
    assert.equal(loopbackSourcesVerified(ZOTERO_INIT, "start(port) { this._start(port, 'localhost'); }"), true);
  });

  it("rejects a server that starts dual-stack, IPv6 or on 0.0.0.0", () => {
    for (const replacement of ["serv.start_dualStack(port);", "serv.start_ipv6(port);", 'serv.start(port, "0.0.0.0");']) {
      const init = ZOTERO_INIT.replace("serv.start(port);", replacement);
      assert.equal(loopbackSourcesVerified(init, HTTPD_START), false, replacement);
    }
  });

  it("rejects an init that no longer calls start() at all", () => {
    assert.equal(loopbackSourcesVerified(ZOTERO_INIT.replace("serv.start(port);", "serv.listen(port);"), HTTPD_START), false);
    assert.equal(loopbackSourcesVerified("", HTTPD_START), false);
  });

  it("rejects an httpd whose start() no longer binds \"localhost\"", () => {
    for (const start of ['start(port) { this._start(port, "[::1]"); }', "start(port) { this._start(port, host); }", ""]) {
      assert.equal(loopbackSourcesVerified(ZOTERO_INIT, start), false, start);
    }
  });
});
