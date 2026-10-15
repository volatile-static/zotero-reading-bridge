/**
 * Context tools: get_current_context (on demand, for the model) and capture_prompt_context (once per prompt,
 * called by the Codex / Claude Code UserPromptSubmit hooks; output contract in shared/types/hook.ts).
 * Neither ever fails with isError for "nothing selected" or "Zotero unavailable": that is snapshot status.
 */
import contextPolicy from "../../../../shared/instructions/context-policy.md";
import { extractSection } from "../../../../shared/instructions/sections.js";
import { SNAPSHOT_LIMITS, type ContextSnapshot } from "../../../../shared/types/snapshot.js";
import type { ToolName } from "../../../../shared/types/tool-names.js";
import { formatHookContext, hookContextLimits, hookOutputJson } from "../context/hook-output.js";
import { captureParts } from "../context/selection.js";
import {
  assembleSnapshot,
  clampTextLength,
  SnapshotSequencer,
  unavailableParts,
  type CaptureParts,
  type SnapshotMeta,
} from "../context/snapshot.js";
import { sanitizeIdentifier } from "../util/text.js";
import { withTimeout } from "../zotero/library.js";
import { json, text, type ToolHandler } from "./types.js";

/** Model-facing rules injected with every hook snapshot. */
const HOOK_RULES = extractSection(contextPolicy, "hook-rules");

/**
 * Well inside the hooks' 5 s timeout, leaving time for HTTP and the client's own processing. captureParts races its
 * reader/note lookups against this budget itself and keeps the active tab and library view on a timeout; the outer
 * guard only catches a capture that hangs somewhere else.
 */
const CAPTURE_TIMEOUT_MS = 2500;
const CAPTURE_GUARD_MS = CAPTURE_TIMEOUT_MS + 500;

const sequencer = new SnapshotSequencer();

class CaptureTimeout extends Error {}

/** Error kind only: messages of Zotero exceptions can quote library content, which must not be echoed. */
function errorKind(error: unknown): string {
  try {
    const name = (error as { name?: unknown } | null)?.name;
    return typeof name === "string" && name ? name : "Error";
  } catch {
    return "Error";
  }
}

async function takeSnapshot(request: Omit<SnapshotMeta, "sequence" | "capturedAt">): Promise<ContextSnapshot> {
  const sequence = sequencer.next();
  const capturedAt = new Date().toISOString();
  let parts: CaptureParts;
  try {
    // On timeout the capture keeps running in the background; it only reads, so abandoning it is harmless.
    parts = await withTimeout(captureParts(CAPTURE_TIMEOUT_MS), CAPTURE_GUARD_MS, () => new CaptureTimeout());
  } catch (error) {
    parts = unavailableParts(
      error instanceof CaptureTimeout
        ? `capture timed out after ${CAPTURE_GUARD_MS} ms`
        : `capture failed (${errorKind(error)})`,
    );
  }
  return assembleSnapshot(parts, { ...request, sequence, capturedAt });
}

function optionalId(value: unknown): string | null {
  // sanitizeIdentifier maps "" (Claude Code's ${prompt_id} before the first prompt) to null.
  return typeof value === "string" ? sanitizeIdentifier(value) : null;
}

const getCurrentContext: ToolHandler = async (args) => {
  const snapshot = await takeSnapshot({
    client: null,
    sessionId: null,
    turnId: null,
    promptId: null,
    maxTextLength: clampTextLength(args.maxTextLength),
  });
  return json(snapshot);
};

const capturePromptContext: ToolHandler = async (args) => {
  const snapshot = await takeSnapshot({
    client: optionalId(args.client) ?? "unknown",
    sessionId: optionalId(args.session_id),
    turnId: optionalId(args.turn_id),
    promptId: optionalId(args.prompt_id),
    maxTextLength: SNAPSHOT_LIMITS.selectedTextDefault,
  });
  // Per-client budget: Codex (and unknown clients) also get the UTF-8 byte limit Codex measures hook context by.
  return text(hookOutputJson(formatHookContext(snapshot, HOOK_RULES, hookContextLimits(snapshot.client))));
};

export const contextHandlers: Record<Extract<ToolName, "get_current_context" | "capture_prompt_context">, ToolHandler> = {
  get_current_context: getCurrentContext,
  capture_prompt_context: capturePromptContext,
};
