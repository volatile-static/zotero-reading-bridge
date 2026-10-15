/**
 * Database/file fingerprints for the read-only proof: a fingerprint is taken only once Zotero's own
 * background work (indexing, reader state saves) has gone quiet, so a later difference can be blamed on
 * whatever ran in between.
 */
import type { FingerprintResult } from "../seed-api.js";
import type { SeedClient } from "./seed-client.js";

export function diffFingerprints(before: FingerprintResult, after: FingerprintResult): string[] {
  const diffs: string[] = [];
  for (const [table, old] of Object.entries(before.tables)) {
    const now = after.tables[table];
    if (!now) diffs.push(`table ${table}: missing`);
    else if (now.rows !== old.rows || now.sha256 !== old.sha256) {
      diffs.push(`table ${table}: rows ${old.rows} -> ${now.rows}${now.sha256 === old.sha256 ? "" : ", content changed"}`);
    }
  }
  for (const [name, old] of Object.entries(before.maxima)) {
    if (after.maxima[name] !== old) diffs.push(`${name}: ${String(old)} -> ${String(after.maxima[name])}`);
  }
  for (const old of before.files) {
    const now = after.files.find((f) => f.path === old.path);
    if (!now || now.exists !== old.exists || now.size !== old.size || now.mtimeMs !== old.mtimeMs) {
      diffs.push(`file ${old.path}: ${JSON.stringify(old)} -> ${JSON.stringify(now ?? null)}`);
    }
  }
  return diffs;
}

/** Two consecutive identical fingerprints `gapMs` apart; throws with the last diff if Zotero never settles. */
export async function stableFingerprint(seed: SeedClient, files: string[], attempts = 10, gapMs = 1500): Promise<FingerprintResult> {
  let previous = await seed.fingerprint(files);
  let lastDiff: string[] = [];
  for (let i = 0; i < attempts; i++) {
    await new Promise((resolve) => setTimeout(resolve, gapMs));
    const current = await seed.fingerprint(files);
    lastDiff = diffFingerprints(previous, current);
    if (lastDiff.length === 0) return current;
    previous = current;
  }
  throw new Error(`Zotero data kept changing on its own; last changes: ${lastDiff.join("; ")}`);
}
