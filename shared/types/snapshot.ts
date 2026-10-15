/**
 * Context snapshot: the live Zotero UI state captured at one instant.
 * Produced by get_current_context (on demand) and capture_prompt_context (per prompt, via client hooks).
 * JSON Schema twin: shared/contracts/context-snapshot.schema.json (keep both in sync; a unit test checks it).
 */
import type { AnnotationRef, CollectionRef, ItemRef, LibraryRef, SavedSearchRef } from "./tools.js";

export const SNAPSHOT_SCHEMA_VERSION = 1;

/**
 * Hard caps that keep a snapshot small enough for a 5 s hook and the clients' additionalContext limits: Claude Code
 * spills more than 10,000 characters to a file; Codex spills more than ~2,500 approximate tokens, counted as UTF-8
 * bytes / 4 (10,000 bytes, i.e. only ~3,300 CJK characters), for mcp_tool hooks without a way to raise it.
 */
export const SNAPSHOT_LIMITS = {
  /** Default and maximum characters of reader-selected text kept in a snapshot. */
  selectedTextDefault: 4000,
  selectedTextMax: 20000,
  /** Selected items listed individually (count is always exact). */
  selectedItems: 10,
  /** Selected annotations listed individually. */
  selectedAnnotations: 5,
  /** Characters kept per annotation text/comment inside a snapshot. */
  annotationText: 500,
  /** Max collections / saved searches / libraries listed from the collection tree selection. */
  treeRows: 10,
  /** Total character (UTF-16 code unit) budget for the hook additionalContext string. */
  hookContextChars: 8000,
  /** UTF-8 byte budget for the hook additionalContext of Codex and unknown clients (Codex spills above 10,000). */
  hookContextUtf8Bytes: 9600,
} as const;

export type SnapshotStatus = "ok" | "empty" | "unavailable";

export type ActiveTabType = "library" | "reader" | "note" | "other" | "none";

export interface TruncatedText {
  text: string;
  /** Length of the original text before truncation. */
  length: number;
  truncated: boolean;
}

export interface SnapshotItems {
  /** Exact number of selected items. */
  count: number;
  items: ItemRef[];
  truncated: boolean;
}

export interface SnapshotAnnotations {
  count: number;
  items: AnnotationRef[];
  truncated: boolean;
}

export interface LibraryViewContext {
  /** Library rows selected in the collection tree (Zotero 11 allows multi-row selection). */
  libraries: LibraryRef[];
  collections: CollectionRef[];
  savedSearches: SavedSearchRef[];
  /** Other selected tree rows (Unfiled, Trash, Duplicates, My Publications, feeds...) by kind. */
  otherRows: string[];
  /** Items selected in the items list of the library tab (independent of which tab is active). */
  selectedItems: SnapshotItems;
}

export interface ReaderPage {
  /** 0-based page index, when the reader exposes it. */
  index: number | null;
  label: string | null;
  count: number | null;
}

export interface ReaderContext {
  /** "pdf" | "epub" | "snapshot" | other reader type reported by Zotero. */
  readerType: string;
  /** Whether the reader is a main-window tab or a separate reader window. */
  location: "tab" | "window";
  attachment: ItemRef & { contentType: string | null };
  parentItem: ItemRef | null;
  page: ReaderPage | null;
  selectedText: TruncatedText | null;
  selectedAnnotations: SnapshotAnnotations;
}

/** A note open in a main-window note tab or in a separate note window. */
export interface NoteContext {
  location: "tab" | "window";
  item: ItemRef;
  /** Parent item of a child note; null for a standalone note. */
  parentItem: ItemRef | null;
}

export interface ContextSnapshot {
  schemaVersion: typeof SNAPSHOT_SCHEMA_VERSION;
  /** Unique within the Zotero process; built from client, session/turn ids and a sequence number. */
  snapshotId: string;
  /** Client name passed by the hook ("codex", "claude-code", ...); null for get_current_context. */
  client: string | null;
  sessionId: string | null;
  /** Codex turn id. */
  turnId: string | null;
  /** Claude Code prompt id (may be null; never assumed to exist). */
  promptId: string | null;
  /** Process-local, strictly increasing capture counter. */
  sequence: number;
  /** ISO-8601 UTC capture time. */
  capturedAt: string;
  status: SnapshotStatus;
  /** Present when status is "unavailable" (or a partial capture hit an error). */
  unavailableReason: string | null;
  /**
   * Which object the user is most likely focused on: a focused separate reader or note window, else the reader or
   * note in the active tab, else the library selection while the library tab is in front.
   */
  focus: "reader" | "note" | "library" | "none";
  activeTab: { type: ActiveTabType; title: string | null };
  libraryView: LibraryViewContext | null;
  reader: ReaderContext | null;
  note: NoteContext | null;
  /** Non-fatal warnings (partial capture, truncation, unloaded library...). */
  warnings: string[];
}
