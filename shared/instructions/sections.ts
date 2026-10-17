/**
 * Named sections inside instruction Markdown, delimited by `<!-- BEGIN:<name> -->` / `<!-- END:<name> -->`.
 * HTML-comment markers keep the whole file readable when the build includes it in a SKILL.md, while the
 * Zotero plugin pulls exact model-facing texts (MCP server instructions, per-prompt hook rules) out of it.
 */

/** Character budgets for the sections the Zotero plugin embeds (checked by tests/unit/sections.test.ts). */
export const SECTION_CHAR_LIMITS = {
  /** Injected with every per-prompt snapshot, so it must stay small. */
  "hook-rules": 1200,
  /** MCP initialize `instructions`; clients cap or truncate long instructions (Claude Code at 4096 chars). */
  "server-instructions": 3500,
} as const;

const SECTION_NAME_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * Return the trimmed text between the BEGIN/END markers of `name`.
 * Throws when the name is malformed, a marker is missing or repeated, or END precedes BEGIN, so a broken
 * instruction file fails the build instead of shipping an empty prompt.
 */
export function extractSection(markdown: string, name: string): string {
  if (!SECTION_NAME_RE.test(name)) {
    throw new Error(`Invalid section name: ${JSON.stringify(name)}`);
  }
  // Windows checkouts may convert to CRLF; the embedded text must be identical on every platform.
  const text = markdown.replace(/\r\n?/g, "\n");
  const begin = `<!-- BEGIN:${name} -->`;
  const end = `<!-- END:${name} -->`;
  const start = uniqueIndex(text, begin, name);
  const stop = uniqueIndex(text, end, name);
  if (stop < start) {
    throw new Error(`Section "${name}": END marker precedes BEGIN marker`);
  }
  return text.slice(start + begin.length, stop).trim();
}

function uniqueIndex(text: string, marker: string, name: string): number {
  const index = text.indexOf(marker);
  if (index === -1) {
    throw new Error(`Section "${name}": missing marker ${marker}`);
  }
  if (text.indexOf(marker, index + marker.length) !== -1) {
    throw new Error(`Section "${name}": marker ${marker} appears more than once`);
  }
  return index;
}
