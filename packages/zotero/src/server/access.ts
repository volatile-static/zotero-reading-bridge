/**
 * Request access policy for the MCP endpoint. Pure: no Zotero globals.
 *
 * Zotero (xpcom/server/server.js) answers 400 to non-loopback Host headers and drops most requests that carry an
 * Origin header or a Mozilla/ User-Agent before our endpoint runs, but NOT all of them: a request that also sends
 * X-Zotero-Connector-API-Version or Zotero-Allowed-Request skips that browser check, and Zotero answers the CORS
 * preflight for https://www.zotero.org (ZOTERO_CONFIG.BOOKMARKLET_ORIGIN, allowing Content-Type and
 * X-Zotero-Connector-API-Version). A script on that origin can therefore POST JSON that reaches this endpoint.
 * The Origin rule below is the only barrier for such requests: it is load-bearing and must stay, and the endpoint
 * must never set allowRequestsFromUnsafeWebContent. The Host rule adds the port check Zotero lacks (HTTP/1.0
 * requests skip httpd's own identity check).
 */

export interface AccessDenied {
  status: 403;
  message: string;
}

const LOOPBACK_HOST_RE = /^(127\.0\.0\.1|localhost|\[::1\])(?::([0-9]{1,5}))?$/i;

/**
 * @param headers request headers with lowercase names
 * @param port the port Zotero actually listens on; null skips the port comparison (tests)
 */
export function checkAccess(headers: Record<string, string | undefined>, port: number | null): AccessDenied | null {
  // Any Origin, including "null" or an empty value, means a browser context; no web origin is ever allowed.
  if (headers["origin"] !== undefined) {
    return { status: 403, message: "Forbidden: requests with an Origin header are not accepted" };
  }
  const host = headers["host"]?.trim() ?? "";
  const match = LOOPBACK_HOST_RE.exec(host);
  if (!match) {
    return { status: 403, message: "Forbidden: Host must be a loopback address" };
  }
  if (port !== null) {
    // A missing port means 80, which is never Zotero's port; a mismatch hints at a forwarded or rebound request.
    const hostPort = match[2] === undefined ? 80 : Number(match[2]);
    if (hostPort !== port) {
      return { status: 403, message: "Forbidden: Host port does not match the Zotero server port" };
    }
  }
  return null;
}
