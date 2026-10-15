/**
 * Pure part of the loopback-only verification (DESIGN decision 11). Pure: no Zotero globals (unit-tested in Node);
 * endpoint.ts reads the two function sources inside Zotero and passes them here.
 *
 * Zotero exposes no bind address, so the code path is checked instead: Zotero.Server.init must call
 * HttpServer.start(port), never start_ipv6/start_dualStack or an explicit 0.0.0.0, and httpd's start() must pass
 * "localhost", which makes nsIServerSocket listen on 127.0.0.1 only. Anything else fails closed: the bridge then
 * registers no endpoint and reports the status "loopback-unverified".
 */

/** Calls that would bind something other than IPv4 loopback. */
const NON_LOOPBACK_BIND = /start_dualStack|start_ipv6|0\.0\.0\.0/;

/**
 * @param initSource source text of Zotero.Server.init
 * @param startSource source text of HttpServer.prototype.start from httpd.sys.mjs
 */
export function loopbackSourcesVerified(initSource: string, startSource: string): boolean {
  if (!initSource.includes(".start(") || NON_LOOPBACK_BIND.test(initSource)) return false;
  return /["']localhost["']/.test(startSource);
}
