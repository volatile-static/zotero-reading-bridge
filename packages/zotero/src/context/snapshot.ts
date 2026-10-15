/**
 * Pure snapshot assembly: sequencing, snapshot ids, status / focus rules and the selected-text cap.
 * No Zotero globals here (unit-tested in Node); the live capture that produces CaptureParts is selection.ts.
 */
import {
  SNAPSHOT_LIMITS,
  SNAPSHOT_SCHEMA_VERSION,
  type ActiveTabType,
  type ContextSnapshot,
  type LibraryViewContext,
  type NoteContext,
  type ReaderContext,
  type SnapshotStatus,
  type TruncatedText,
} from "../../../../shared/types/snapshot.js";
import { truncateText } from "../util/text.js";

/** Reader part as captured: the selected text is still the raw string (capped by assembleSnapshot). */
export interface RawReaderContext extends Omit<ReaderContext, "selectedText"> {
  selectedText: string | null;
}

/** Output of the live capture. Any part may be missing after a partial failure. */
export interface CaptureParts {
  activeTab: { type: ActiveTabType; title: string | null };
  libraryView: LibraryViewContext | null;
  reader: RawReaderContext | null;
  note: NoteContext | null;
  warnings: string[];
  /** Why the capture failed or is incomplete. Must never contain library content (it is logged and shown). */
  error: string | null;
}

export interface SnapshotMeta {
  client: string | null;
  sessionId: string | null;
  turnId: string | null;
  promptId: string | null;
  sequence: number;
  /** ISO-8601 UTC time the capture started. */
  capturedAt: string;
  /** Characters of reader-selected text to keep (clamped to [0, SNAPSHOT_LIMITS.selectedTextMax]). */
  maxTextLength: number;
}

/** Process-local, strictly increasing capture counter; distinguishes snapshots taken in the same millisecond. */
export class SnapshotSequencer {
  private last = 0;

  next(): number {
    this.last += 1;
    return this.last;
  }
}

/** Parts for a capture that produced nothing (no Zotero window to read, unexpected exception). */
export function unavailableParts(reason: string): CaptureParts {
  return { activeTab: { type: "none", title: null }, libraryView: null, reader: null, note: null, warnings: [], error: reason };
}

// Client-supplied ids end up in the hook header line: keep only characters that cannot forge markup.
const ID_UNSAFE = /[^A-Za-z0-9._:-]/g;

function idPart(value: string): string {
  return value.replace(ID_UNSAFE, "_");
}

/**
 * Snapshot id: client, then whichever of session / turn (Codex) / prompt (Claude Code) ids are present, then the
 * process-local sequence and the compact capture time (the sequence restarts with Zotero; the time keeps ids
 * distinct across restarts). Example: `codex/s:<session>/t:<turn>/n:12/20261014T221200123Z`.
 */
export function buildSnapshotId(
  client: string | null,
  sessionId: string | null,
  turnId: string | null,
  promptId: string | null,
  sequence: number,
  capturedAt: string,
): string {
  const parts = [idPart(client || "direct")];
  if (sessionId) parts.push(`s:${idPart(sessionId)}`);
  if (turnId) parts.push(`t:${idPart(turnId)}`);
  if (promptId) parts.push(`p:${idPart(promptId)}`);
  parts.push(`n:${sequence}`, idPart(capturedAt.replace(/[-:.]/g, "")));
  return parts.join("/");
}

/** What the capture found open: the active tab type plus the resolved reader and note, if any. */
export interface OpenContent {
  activeTab: { type: ActiveTabType };
  reader: ReaderContext | RawReaderContext | null;
  note: NoteContext | null;
}

/** A note, reader or other non-library tab is in front of the library tab. */
function nonLibraryTabActive(activeTab: { type: ActiveTabType }): boolean {
  return activeTab.type === "note" || activeTab.type === "reader" || activeTab.type === "other";
}

/**
 * "ok": a reader or note is open; or a note, reader or other tab is in front although its content could not be
 * read (something is open: never report "nothing is open" then); or items, collections or saved searches are
 * selected in the library.
 * "unavailable": nothing could be captured (no reader, note or library data) and an error was reported.
 * "empty": anything else (a selected library root, Trash, Unfiled... alone is still empty; libraryView is kept
 * because it says where the user is).
 */
export function snapshotStatus(error: string | null, open: OpenContent, libraryView: LibraryViewContext | null): SnapshotStatus {
  if (open.reader || open.note) return "ok";
  if (!libraryView && error) return "unavailable";
  if (nonLibraryTabActive(open.activeTab)) return "ok";
  if (!libraryView) return "empty";
  const hasSelection =
    libraryView.selectedItems.count > 0 || libraryView.collections.length > 0 || libraryView.savedSearches.length > 0;
  return hasSelection ? "ok" : "empty";
}

/**
 * A focused separate reader or note window first (the user is working in it), then the reader or note of the
 * active tab, then the library's selected items, but only while the library tab is in front: behind a note,
 * reader or other tab, libraryView.selectedItems is the hidden library tab's selection, not what the user sees.
 */
export function snapshotFocus(open: OpenContent, libraryView: LibraryViewContext | null): ContextSnapshot["focus"] {
  if (open.reader?.location === "window") return "reader";
  if (open.note?.location === "window") return "note";
  if (open.reader) return "reader";
  if (open.note) return "note";
  if (!nonLibraryTabActive(open.activeTab) && libraryView && libraryView.selectedItems.count > 0) return "library";
  return "none";
}

export function clampTextLength(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return SNAPSHOT_LIMITS.selectedTextDefault;
  return Math.min(Math.max(Math.floor(value), 0), SNAPSHOT_LIMITS.selectedTextMax);
}

function capSelectedText(raw: string | null, max: number, warnings: string[]): TruncatedText | null {
  const trimmed = raw?.trim() ?? "";
  if (!trimmed) return null;
  const capped = truncateText(trimmed, max);
  if (capped.truncated) {
    warnings.push(`Selected text truncated to ${capped.text.length} of ${capped.length} characters.`);
  }
  return capped;
}

export function assembleSnapshot(parts: CaptureParts, meta: SnapshotMeta): ContextSnapshot {
  const warnings = [...parts.warnings];
  const reader: ReaderContext | null = parts.reader
    ? { ...parts.reader, selectedText: capSelectedText(parts.reader.selectedText, clampTextLength(meta.maxTextLength), warnings) }
    : null;
  const open: OpenContent = { activeTab: parts.activeTab, reader, note: parts.note };
  return {
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    snapshotId: buildSnapshotId(meta.client, meta.sessionId, meta.turnId, meta.promptId, meta.sequence, meta.capturedAt),
    client: meta.client,
    sessionId: meta.sessionId,
    turnId: meta.turnId,
    promptId: meta.promptId,
    sequence: meta.sequence,
    capturedAt: meta.capturedAt,
    status: snapshotStatus(parts.error, open, parts.libraryView),
    unavailableReason: parts.error,
    focus: snapshotFocus(open, parts.libraryView),
    activeTab: parts.activeTab,
    libraryView: parts.libraryView,
    reader,
    note: parts.note,
    warnings,
  };
}
