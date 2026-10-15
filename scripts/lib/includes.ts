/**
 * Expansion of `<!-- @include <repo-relative path> -->` lines in staged Markdown (client skills share the
 * model-facing instructions under shared/instructions/ this way). Pure: file access is injected.
 *
 * Only real HTML comments are directives: inside fenced code blocks and inline code spans the same text is
 * visible documentation of the syntax (e.g. a README explaining the build), so it is left alone.
 */
import path from "node:path";

/** A whole line holding exactly one marker; anything else mentioning "@include" outside code is malformed. */
const INCLUDE_LINE_RE = /^[ \t]*<!--[ \t]*@include[ \t]+(\S(?:.*?\S)?)[ \t]*-->[ \t]*$/;
const INCLUDE_MENTION_RE = /<!--\s*@include\b/;
/** CommonMark fence: up to 3 spaces of indent, then 3+ backticks or tildes. */
const FENCE_RE = /^ {0,3}(`{3,}|~{3,})/;
/** Inline code span: a backtick run closed by a run of the same length. */
const CODE_SPAN_RE = /(`+)[\s\S]*?\1/g;

export class IncludeError extends Error {
  override name = "IncludeError";
}

/** Validate and normalize a marker target to a repo-relative POSIX path. */
export function normalizeIncludePath(target: string, origin: string): string {
  if (target.includes("\\")) throw new IncludeError(`${origin}: include path must use "/" separators: ${target}`);
  if (target.startsWith("/") || /^[A-Za-z]:/.test(target)) {
    throw new IncludeError(`${origin}: include path must be repo-relative: ${target}`);
  }
  const normalized = path.posix.normalize(target);
  if (normalized === "." || normalized === ".." || normalized.startsWith("../")) {
    throw new IncludeError(`${origin}: include path escapes the repository: ${target}`);
  }
  return normalized;
}

/** Per line: the text that can hold a directive (inline code removed), or null for fenced code and fence lines. */
function directiveText(lines: readonly string[]): (string | null)[] {
  let fence: string | null = null;
  return lines.map((line) => {
    const run = FENCE_RE.exec(line)?.[1];
    if (fence === null) {
      if (run !== undefined) {
        fence = run;
        return null;
      }
      return line.replace(CODE_SPAN_RE, "");
    }
    const closes = run !== undefined && run[0] === fence[0] && run.length >= fence.length && line.trim() === run;
    if (closes) fence = null;
    return null;
  });
}

/** 1-based line numbers of every marker-like mention outside code (used to prove nothing was left unexpanded). */
export function findIncludeMarkers(text: string): number[] {
  const lines: number[] = [];
  directiveText(text.split(/\r?\n/)).forEach((active, index) => {
    if (active !== null && INCLUDE_MENTION_RE.test(active)) lines.push(index + 1);
  });
  return lines;
}

/**
 * Replace each marker line with the target file's content (recursively), so the staged file is
 * self-contained. `load` returns the target's text or null when it does not exist.
 * Files without markers are returned unchanged byte-for-byte; expanded files use LF line endings.
 */
export function expandIncludes(
  text: string,
  origin: string,
  load: (repoRelPath: string) => string | null,
  stack: readonly string[] = [origin],
): string {
  if (findIncludeMarkers(text).length === 0) return text;
  const lines = text.split(/\r?\n/);
  const active = directiveText(lines);
  const out: string[] = [];
  for (const [index, line] of lines.entries()) {
    const directive = active[index];
    if (directive === null || directive === undefined || !INCLUDE_MENTION_RE.test(directive)) {
      out.push(line);
      continue;
    }
    const match = INCLUDE_LINE_RE.exec(line);
    if (!match) throw new IncludeError(`${origin}:${index + 1}: malformed include marker (must be a line of its own)`);
    const target = normalizeIncludePath(match[1] ?? "", `${origin}:${index + 1}`);
    if (stack.includes(target)) {
      throw new IncludeError(`include cycle: ${[...stack, target].join(" -> ")}`);
    }
    const content = load(target);
    if (content === null) throw new IncludeError(`${origin}:${index + 1}: include target not found: ${target}`);
    const expanded = expandIncludes(content.replace(/^\uFEFF/, ""), target, load, [...stack, target]);
    // The marker's own line break stays; trailing newlines of the included file would add blank lines.
    out.push(expanded.replace(/\r\n/g, "\n").replace(/\n+$/, ""));
  }
  return out.join("\n");
}
