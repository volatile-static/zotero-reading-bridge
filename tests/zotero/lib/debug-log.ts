/**
 * Privacy check of the bridge's own Zotero debug lines (DESIGN decision 14), run on the debug output of a
 * `--debug-output` harness run after shutdown: every "[Zotero Reading Bridge]" line must be one of the known
 * content-free summaries (method, JSON-RPC method, tool, status, sizes, timing, lifecycle) and must not
 * contain any fixture text. Zotero's own request logging is out of scope (it is documented behaviour).
 */
import { ANNOTATIONS, ATTACHMENTS, COLLECTIONS, ITEMS } from "../fixtures/data.js";

const MARKER = "[Zotero Reading Bridge]";

const ALLOWED: readonly RegExp[] = [
  // endpoint.ts logRequest()
  /^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS|\(other\)) (-|[A-Za-z0-9_./-]{1,64}|\(other\))( [a-z_]+| \(unknown tool\))? -> \d{3} (ok|rpc-error|tool-error|rejected)( \[[A-Za-z0-9_./-]{1,64}\])? \(\d+ bytes, \d+ ms\)$/,
  // endpoint.ts logFilter for Zotero's response logging
  /^response \d{3} \(\d+ bytes, body redacted\)$/,
  /^unexpected [A-Za-z0-9_./-]{1,64} while handling a request$/,
  /^replacing an existing endpoint at \/bridge\/mcp$/,
  // main.ts lifecycle lines
  /^could not verify that Zotero's HTTP server binds 127\.0\.0\.1 only; endpoints stay off$/,
  /^serving \/bridge\/mcp on 127\.0\.0\.1:\d+$/,
  /^endpoints unregistered$/,
  /^shutting down \(reason \d+\)$/,
  /^item pre-warm stopped: [A-Za-z0-9_./-]{1,64}$/,
];

export interface DebugLogCheck {
  bridgeLines: number;
  /** Bridge lines that are not a known summary (at most 20). */
  unexpected: string[];
  /** Bridge lines containing a forbidden (fixture) string (at most 20). */
  leaking: string[];
  /** Distinct summaries with numbers masked, for the report. */
  kinds: string[];
}

/** `lines`: Zotero debug output; `forbidden`: strings that must never appear in a bridge line. */
export function checkBridgeDebugLines(lines: readonly string[], forbidden: readonly string[]): DebugLogCheck {
  const messages = lines.flatMap((line) => {
    const at = line.indexOf(MARKER);
    return at === -1 ? [] : [line.slice(at + MARKER.length).trim()];
  });
  const needles = forbidden.filter((text) => text.trim().length > 0);
  return {
    bridgeLines: messages.length,
    unexpected: messages.filter((m) => !ALLOWED.some((re) => re.test(m))).slice(0, 20),
    leaking: messages.filter((m) => needles.some((text) => m.includes(text))).slice(0, 20),
    kinds: [...new Set(messages.map((m) => m.replace(/\d+/g, "N")))].sort(),
  };
}

/** Library content the harness seeds and queries; none of it may reach a bridge debug line. */
export function fixtureTexts(): string[] {
  return [
    ...ITEMS.map((item) => item.title),
    ...COLLECTIONS.map((col) => col.name),
    ...ATTACHMENTS.map((att) => att.title),
    ...ANNOTATIONS.flatMap((ann) => [ann.text ?? "", ann.comment]),
  ];
}
