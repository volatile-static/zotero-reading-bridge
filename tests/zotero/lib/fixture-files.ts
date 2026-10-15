/**
 * Synthetic attachment files on disk for one run (all under the run's fixtures/ directory, whose
 * subdirectories deliberately contain Chinese characters and spaces).
 */
import fs from "node:fs";
import path from "node:path";
import { ATTACHMENT_FILES, type SeedManifest } from "../fixtures/data.js";
import { buildFixturePdf } from "../fixtures/pdf.js";
import type { RunLayout } from "../profile.js";
import type { SeedRequest } from "../seed-api.js";
import { assertTestPath } from "./paths.js";

export function prepareFixtureFiles(layout: RunLayout): SeedRequest["files"] {
  const pdf = buildFixturePdf();
  const files = {} as SeedRequest["files"];
  for (const [name, relative] of Object.entries(ATTACHMENT_FILES) as Array<[keyof SeedRequest["files"], string]>) {
    const target = assertTestPath(path.join(layout.fixturesDir, relative), "fixture file");
    fs.mkdirSync(path.dirname(target), { recursive: true });
    // Every file exists at seed time (Zotero refuses to link or import a missing file); the "missing"
    // ones are deleted afterwards by removeMissingFixtureFiles().
    fs.writeFileSync(target, pdf);
    files[name] = target;
  }
  return files;
}

/**
 * Make the "missing" attachments missing: the linked source in fixtures/ and the stored copy that Zotero
 * made under the test data directory's storage/<KEY>/.
 */
export function removeMissingFixtureFiles(files: SeedRequest["files"], manifest: SeedManifest): string[] {
  const removed: string[] = [];
  const storedCopy = manifest.attachments["att-missing-stored"]?.path;
  if (!storedCopy) throw new Error("Seed manifest has no path for att-missing-stored");
  for (const file of [files.missingLinkedPdf, storedCopy]) {
    const target = assertTestPath(file, "missing-attachment fixture");
    fs.rmSync(target, { force: true });
    removed.push(target);
  }
  return removed;
}

/** Windows paths compare case-insensitively and with either separator. */
export function samePath(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  const norm = (p: string) => path.resolve(p).replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
  return norm(a) === norm(b);
}
