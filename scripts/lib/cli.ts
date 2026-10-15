/**
 * Small CLI helpers shared by scripts/build.ts and scripts/verify-package.ts.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

function canonicalPath(p: string): string {
  let resolved = path.resolve(p);
  try {
    resolved = fs.realpathSync.native(resolved);
  } catch {
    // Keep the resolved path when it cannot be canonicalized; the comparison then stays literal.
  }
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

/** True when the module at `importMetaUrl` is the script node/tsx was started with (not an import). */
export function isMainModule(importMetaUrl: string): boolean {
  const entry = process.argv[1];
  return entry !== undefined && canonicalPath(fileURLToPath(importMetaUrl)) === canonicalPath(entry);
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Repo root for scripts living in <root>/scripts. */
export function repoRootFrom(importMetaUrl: string): string {
  return path.resolve(path.dirname(fileURLToPath(importMetaUrl)), "..");
}

/** Left-aligned text table; the last column is not padded so long details do not create trailing spaces. */
export function formatTable(header: readonly string[], rows: readonly (readonly string[])[]): string {
  const widths = header.map((title, column) =>
    Math.max(title.length, ...rows.map((row) => (row[column] ?? "").length)),
  );
  const render = (cells: readonly string[]): string =>
    cells
      .map((cell, column) => (column === cells.length - 1 ? cell : cell.padEnd(widths[column] ?? 0)))
      .join("  ")
      .trimEnd();
  const rule = widths.map((width) => "-".repeat(width)).join("  ");
  return [render(header), rule, ...rows.map(render)].join("\n");
}
