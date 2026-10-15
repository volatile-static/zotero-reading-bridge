/**
 * Case model shared by the live harness orchestrator (run.ts) and the case files.
 */
import type { SeedManifest } from "../fixtures/data.js";
import type { RunLayout } from "../profile.js";
import type { FixtureQueryResult } from "../seed-api.js";
import type { McpClient } from "../lib/mcp.js";
import type { ZoteroProcess } from "../lib/process.js";
import type { SeedClient } from "../lib/seed-client.js";

/**
 * What a case needs before it can run. "fixtures": the seed case produced a manifest. "bridge": the
 * bridge XPI was installed into the test profile.
 */
export type Requirement = "fixtures" | "bridge";

export interface HarnessContext {
  port: number;
  layout: RunLayout;
  seed: SeedClient;
  proc: ZoteroProcess;
  bridgeInstalled: boolean;
  /** Set by the seeding case. */
  manifest: SeedManifest | null;
  /** Fixtures as read back through Zotero's own APIs (seed /query). */
  observed: FixtureQueryResult | null;
  /** New raw MCP client for a bridge path (default /bridge/mcp) and protocol version. */
  mcp(path?: string, protocolVersion?: string): McpClient;
}

export interface TestCase {
  /** "<group>.<name>", stable across runs (report.json consumers key on it). */
  id: string;
  title: string;
  requires: Requirement[];
  /** Per-case timeout; the default suits a few round trips. */
  timeoutMs?: number;
  /** Returned details are stored in report.json next to the result. */
  run(ctx: HarnessContext): Promise<unknown>;
}

/** Thrown by a case that cannot run in this environment; a skip is reported, not counted as a failure. */
export class SkipCase extends Error {
  override name = "SkipCase";
}

export function requireManifest(ctx: HarnessContext): SeedManifest {
  if (!ctx.manifest) throw new Error("Fixtures were not seeded");
  return ctx.manifest;
}

/** Zotero key of a seeded fixture object (any kind), by fixture id. */
export function fixtureKey(ctx: HarnessContext, id: string): string {
  const manifest = requireManifest(ctx);
  const found =
    manifest.items[id] ??
    manifest.collections[id] ??
    manifest.notes[id] ??
    manifest.attachments[id] ??
    manifest.annotations[id] ??
    manifest.savedSearches[id];
  if (!found) throw new Error(`Unknown fixture id ${id}`);
  return found.key;
}

export function fixtureKeys(ctx: HarnessContext, ids: readonly string[]): string[] {
  return ids.map((id) => fixtureKey(ctx, id));
}
