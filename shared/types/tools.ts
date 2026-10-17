/**
 * Result payload shapes returned by the read-only tools (serialized as JSON text content).
 * Host-agnostic: no Zotero or Node types here.
 */

/** Stable error codes carried in tool-execution errors (CallToolResult.isError = true). */
export type ToolErrorCode =
  | "INVALID_ARGUMENT"
  | "LIBRARY_NOT_FOUND"
  | "NOT_FOUND"
  | "WRONG_ITEM_TYPE"
  | "PERMISSION_DENIED"
  | "UNAVAILABLE"
  | "TIMEOUT"
  | "INTERNAL";

export interface ToolErrorPayload {
  error: {
    code: ToolErrorCode;
    message: string;
    details?: Record<string, unknown>;
  };
}

/** Uniform paginated list envelope. `nextCursor` is opaque; pass it back unchanged. */
export interface Page<T> {
  items: T[];
  total: number;
  offset: number;
  limit: number;
  nextCursor: string | null;
}

export type LibraryType = "user" | "group" | "feed";

export interface LibraryRef {
  libraryID: number;
  type: LibraryType;
  name: string;
  /** Present for group libraries. */
  groupID?: number;
}

export interface LibraryInfo extends LibraryRef {
  editable: boolean;
  filesEditable: boolean;
  /** Whether Zotero has finished loading this library's items into memory. */
  itemsLoaded: boolean;
}

export interface CollectionRef {
  libraryID: number;
  key: string;
  collectionID: number;
  name: string;
  parentKey: string | null;
}

export interface CollectionInfo extends CollectionRef {
  /** Depth below the starting point when listed recursively (0 = direct). */
  depth: number;
  childCollectionCount: number;
  /**
   * Number of non-deleted top-level items Zotero's collection view shows: the items filed directly in the
   * collection, plus those of all its subcollections while Zotero's "Show Items from Subcollections" option is on
   * (omitted when not requested).
   */
  itemCount?: number;
  uri: string;
}

export interface SavedSearchRef {
  libraryID: number;
  key: string;
  searchID: number;
  name: string;
}

/** Minimal pointer to an item, used everywhere an item is referenced. */
export interface ItemRef {
  libraryID: number;
  key: string;
  itemID: number;
  itemType: string;
  title: string;
}

/** Compact bibliographic summary used in list results. */
export interface ItemSummary extends ItemRef {
  /** e.g. "Smith, Jones, and Lee" or "Smith et al." */
  creatorSummary: string;
  year: string | null;
  date: string | null;
  publicationTitle: string | null;
  DOI: string | null;
  parentKey: string | null;
  dateAdded: string;
  dateModified: string;
  /** zotero://select URI for the item; empty for feeds (cite libraryID + key instead). */
  uri: string;
  childCounts?: { notes: number; attachments: number };
}

export interface CreatorInfo {
  creatorType: string;
  firstName?: string;
  lastName?: string;
  /** Single-field name (institutions etc.). */
  name?: string;
}

export interface TagInfo {
  tag: string;
  /** 0 = manual, 1 = automatic. */
  type: number;
}

/** Full item detail returned by get_items. */
export interface ItemDetail extends ItemSummary {
  /** All non-empty fields from item.toJSON() except bookkeeping keys. */
  fields: Record<string, string>;
  creators: CreatorInfo[];
  tags: TagInfo[];
  collections: string[];
  relations: Record<string, string | string[]>;
  deleted: boolean;
  /** Child notes and attachments of a regular item (null otherwise or when not requested). */
  children: {
    /** Exact numbers of non-trashed child notes / attachments. */
    noteCount: number;
    attachmentCount: number;
    /** The first notes / attachments in Zotero's item-pane order (see `truncated`). */
    notes: Array<ItemRef>;
    attachments: Array<AttachmentSummary>;
    /** True when a list was cut; get_item_children pages through every child. */
    truncated: boolean;
  } | null;
}

export type AttachmentLinkMode = "imported_file" | "imported_url" | "linked_file" | "linked_url" | "embedded_image" | "unknown";

export interface AttachmentSummary extends ItemRef {
  parentKey: string | null;
  contentType: string | null;
  linkMode: AttachmentLinkMode;
  filename: string | null;
}

export interface AttachmentPathInfo extends AttachmentSummary {
  /** Absolute local path resolved through the Zotero API, or null (linked URL, unresolvable). */
  path: string | null;
  /** Whether the file exists on disk right now. False also covers "synced but not downloaded". */
  exists: boolean;
  /** For linked_url attachments. */
  url: string | null;
  /** Item storage directory for stored attachments (storage/<KEY>), else null. */
  storageDirectory: string | null;
  /** Human-readable explanation when path is null or the file is missing. */
  note: string | null;
}

/**
 * get_fulltext sizing. Without maxLength a call returns as much text as fits an estimated token budget chosen to stay
 * under Claude Code's default MCP output cap (MAX_MCP_OUTPUT_TOKENS, 25,000) with room for the JSON metadata, so a
 * typical paper comes back whole in one call.
 */
export const FULLTEXT_LIMITS = {
  defaultTokenBudget: 20_000,
  minLength: 1_000,
  /** Zotero's default extensions.zotero.fulltext.textMaxLength: no cache file is longer. */
  maxLength: 500_000,
} as const;

export type FulltextIndexState = "indexed" | "partial" | "unindexed" | "queued" | "unavailable";

/** get_fulltext metadata (first content item); the text itself is the second content item when `text` is true. */
export interface FulltextInfo extends AttachmentSummary {
  /** Title of the parent item, when the attachment has one. */
  parentTitle: string | null;
  indexState: FulltextIndexState;
  /** Where the text came from: Zotero's full-text cache, the not-yet-processed synced content, or nowhere. */
  source: "cache" | "synced-content" | null;
  /** PDF pages Zotero indexed and the document's page count, when Zotero recorded them. */
  indexedPages: number | null;
  totalPages: number | null;
  /** Length of the whole available text in UTF-16 code units (0 without text). */
  totalChars: number;
  offset: number;
  returnedChars: number;
  /** True when the returned text reaches the end of the available text. */
  complete: boolean;
  /** Offset to pass to continue reading, or null. */
  nextOffset: number | null;
  /** True when a second content item carries the text. */
  text: boolean;
  /** Caveats (partial index, no text) and what to do instead. */
  note: string | null;
}

export interface NoteDetail extends ItemRef {
  parentKey: string | null;
  noteTitle: string;
  /** Raw note HTML (possibly truncated, see truncated). */
  html: string | null;
  /** Plain-text rendering of the note (possibly truncated). */
  text: string;
  length: number;
  truncated: boolean;
  tags: TagInfo[];
  dateModified: string;
  uri: string;
}

export type AnnotationType = "highlight" | "underline" | "note" | "image" | "ink" | "text" | string;

export interface AnnotationRef {
  libraryID: number;
  key: string;
  annotationType: AnnotationType;
  /** Highlighted/underlined text (possibly truncated). */
  text: string | null;
  comment: string | null;
  color: string | null;
  pageLabel: string | null;
}

/**
 * Byte caps for annotation images attached to one tool result (raw PNG bytes; base64 adds a third). An image
 * over a cap is not attached; its AnnotationImage says why, so the model can request it on its own.
 */
export const ANNOTATION_IMAGE_LIMITS = {
  perImageBytes: 2_000_000,
  perCallBytes: 6_000_000,
} as const;

/** The cached rendering Zotero keeps of an image annotation (<data dir>/cache/library/<KEY>.png). */
export interface AnnotationImage {
  /** Where Zotero keeps (or would keep) the PNG; null when it cannot be computed. */
  cachePath: string | null;
  exists: boolean;
  bytes: number | null;
  /** True when the PNG is attached to this result as an image content item. */
  included: boolean;
  /** Why the image is not attached, or null. */
  note: string | null;
}

/** Per-image status that get_current_context adds after the snapshot for selected image annotations. */
export interface AnnotationImageStatus extends AnnotationImage {
  libraryID: number;
  key: string;
}

export interface AnnotationDetail extends AnnotationRef {
  itemID: number;
  attachmentKey: string;
  parentItemKey: string | null;
  /** 0-based page index parsed from the position, when available. */
  pageIndex: number | null;
  /** Parsed annotationPosition JSON (PDF rects, EPUB CFI, ...). Omitted for ink/image when large. */
  position: unknown;
  sortIndex: string | null;
  tags: TagInfo[];
  authorName: string | null;
  isExternal: boolean;
  dateModified: string;
  /** zotero://open-pdf link that opens the reader at this annotation. */
  link: string;
  /** Cached rendering of an image annotation; null for every other type. */
  image: AnnotationImage | null;
}
