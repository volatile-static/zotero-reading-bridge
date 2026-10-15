/**
 * HTTP response builders for the MCP endpoint. Pure: no Zotero globals (unit-tested in Node).
 *
 * Zotero's server writes `HTTP/1.0`, our headers verbatim, then the body, and only adds `Content-Length` itself
 * when the body is empty. So non-empty responses carry an explicit length (clients need not rely on
 * close-delimited framing) and empty ones must not, or the header would be sent twice.
 */

export interface BridgeHttpResponse {
  status: number;
  headers: Record<string, string>;
  /** "" = no body. */
  body: string;
}

/** Lowercase on purpose: Codex matches the media type case-sensitively. */
export const JSON_CONTENT_TYPE = "application/json";

/**
 * Escape every non-ASCII UTF-16 code unit as \uXXXX. Valid for any JSON text because non-ASCII can only occur
 * inside string literals. The result is pure ASCII, so its string length is its UTF-8 byte length, and nothing
 * depends on how Zotero's output stream encodes characters.
 */
export function escapeNonAscii(json: string): string {
  return json.replace(/[\u0080-￿]/g, (ch) => `\\u${ch.charCodeAt(0).toString(16).padStart(4, "0")}`);
}

/** Serialize `payload` as ASCII-only JSON with an exact Content-Length. */
export function jsonResponse(status: number, payload: unknown, extraHeaders?: Record<string, string>): BridgeHttpResponse {
  const body = escapeNonAscii(JSON.stringify(payload));
  return {
    status,
    headers: {
      ...extraHeaders,
      "Content-Type": JSON_CONTENT_TYPE,
      "Content-Length": String(body.length),
      Connection: "close",
    },
    body,
  };
}

/** Body-less response (202, ...). Zotero appends `Content-Length: 0` itself. */
export function emptyResponse(status: number, extraHeaders?: Record<string, string>): BridgeHttpResponse {
  return { status, headers: { ...extraHeaders, Connection: "close" }, body: "" };
}
