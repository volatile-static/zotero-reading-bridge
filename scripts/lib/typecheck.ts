/**
 * Concurrent `tsc -p` over the repository's independent tsconfig projects (TYPECHECK_PROJECTS), shared by
 * `npm run typecheck` and the first step of `npm run build`.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

interface TscRun {
  project: string;
  code: number;
  output: string;
  ms: number;
}

function runTsc(root: string, tscPath: string, project: string): Promise<TscRun> {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const child = spawn(process.execPath, [tscPath, "-p", project, "--pretty", "false"], {
      cwd: root,
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const chunks: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => chunks.push(chunk));
    child.on("error", reject);
    child.on("close", (code, signal) => {
      const output = Buffer.concat(chunks).toString("utf8") + (signal ? `\n(tsc terminated by ${signal})` : "");
      resolve({ project, code: code ?? 1, output, ms: Date.now() - started });
    });
  });
}

/** Typecheck every project (root-relative paths); throws with the compiler output of each failed project. */
export async function typecheck(root: string, projects: readonly string[], tscPath: string, log: (line: string) => void): Promise<void> {
  if (projects.length === 0) {
    log("typecheck skipped (no projects configured)");
    return;
  }
  if (!fs.statSync(tscPath, { throwIfNoEntry: false })?.isFile()) throw new Error(`TypeScript compiler not found at ${tscPath} (run npm install)`);
  for (const project of projects) {
    if (!fs.statSync(path.join(root, ...project.split("/")), { throwIfNoEntry: false })?.isFile()) throw new Error(`missing input file ${project}`);
  }
  // Independent projects: run them concurrently, report in a stable order.
  const runs = await Promise.all(projects.map((project) => runTsc(root, tscPath, project)));
  for (const run of runs) log(`typecheck ${run.project}: ${run.code === 0 ? "ok" : "FAILED"} (${run.ms} ms)`);
  const failed = runs.filter((run) => run.code !== 0);
  if (failed.length > 0) {
    throw new Error(`typecheck failed:\n${failed.map((run) => `--- ${run.project}\n${run.output.trimEnd()}`).join("\n")}`);
  }
}
