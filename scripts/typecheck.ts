/**
 * Typecheck every tsconfig project of the repository:
 *
 *   npm run typecheck     (tsx scripts/typecheck.ts)
 */
import path from "node:path";
import { errorMessage, isMainModule, repoRootFrom } from "./lib/cli.js";
import { TSC_ENTRY, TYPECHECK_PROJECTS } from "./lib/layout.js";
import { typecheck } from "./lib/typecheck.js";

if (isMainModule(import.meta.url)) {
  const root = repoRootFrom(import.meta.url);
  try {
    await typecheck(root, TYPECHECK_PROJECTS, path.join(root, ...TSC_ENTRY.split("/")), (line) => console.log(`[typecheck] ${line}`));
  } catch (error) {
    console.error(`[typecheck] FAILED: ${errorMessage(error)}`);
    process.exitCode = 1;
  }
}
