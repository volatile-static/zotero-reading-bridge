/**
 * Wire contract between the harness (Node) and the test-only seed plugin (Zotero sandbox).
 *
 * Pure declarations: both sides import this file. The seed endpoints exist only in the seed plugin,
 * which is installed only into throwaway profiles under work/zotero-test, and every request must carry
 * the per-run token that the harness writes into that profile's user.js.
 */
import type { SeedManifest } from "./fixtures/data.js";

export const SEED_ADDON_ID = "zab-test-seed@zotero-reading-bridge.local";
/** Prefs written to the test profile's user.js; the seed plugin refuses to register endpoints without them. */
export const SEED_PREF_TOKEN = "extensions.zab-test.token";
export const SEED_PREF_DATA_DIR = "extensions.zab-test.dataDir";
/** Minimum token length (hex chars) the seed plugin accepts. */
export const SEED_TOKEN_MIN_LENGTH = 32;

/** Request header carrying the token (Zotero lowercases header names). */
export const SEED_TOKEN_HEADER = "x-zab-test-token";

export const SEED_PATHS = {
  state: "/zab-test/state",
  seed: "/zab-test/seed",
  query: "/zab-test/query",
  fingerprint: "/zab-test/fingerprint",
  ui: "/zab-test/ui",
  pref: "/zab-test/pref",
  addon: "/zab-test/addon",
  prefsPane: "/zab-test/prefs-pane",
  tag: "/zab-test/tag",
  quit: "/zab-test/quit",
} as const;

/** The only pref /zab-test/pref may change: Zotero's "Show Items from Subcollections" (collection tools follow it). */
export const SEED_WRITABLE_PREFS = ["extensions.zotero.recursiveCollections"] as const;

/** Add or remove one tag on a fixture item (saved like a user edit), to prove caches see library changes. */
export interface TagRequest {
  libraryID: number;
  key: string;
  tag: string;
  action: "add" | "remove";
}

export interface TagResult {
  ok: true;
  tags: string[];
}

export interface PluginState {
  id: string;
  version: string;
  isActive: boolean;
  userDisabled: boolean;
  appDisabled: boolean;
}

export interface WindowState {
  type: string | null;
  title: string;
}

export interface SeedStateResult {
  ok: true;
  zoteroVersion: string;
  platformVersion: string;
  locale: string;
  dataDir: string;
  profileDir: string;
  port: number | null;
  uiReady: boolean;
  plugins: PluginState[];
  libraries: Array<{ libraryID: number; type: string; name: string; groupID: number | null }>;
  windows: WindowState[];
  endpoints: string[];
}

export interface SeedRequest {
  /** Absolute paths prepared by the harness inside the run's fixture directory. */
  files: {
    sourcePdf: string;
    linkedPdf: string;
    missingLinkedPdf: string;
    missingStoredSource: string;
  };
}

export interface SeedResult {
  ok: true;
  manifest: SeedManifest;
  ms: number;
}

export interface ObservedItem {
  key: string;
  libraryID: number;
  itemType: string;
  title: string;
  deleted: boolean;
  tags: string[];
  collections: string[];
  creators: Array<Record<string, string>>;
  fields: Record<string, string>;
}

export interface ObservedAttachment {
  key: string;
  parentKey: string | null;
  linkMode: string;
  contentType: string;
  path: string | null;
  exists: boolean;
  title: string;
}

export interface ObservedAnnotation {
  key: string;
  parentKey: string | null;
  type: string;
  text: string | null;
  comment: string | null;
  color: string | null;
  pageLabel: string | null;
  sortIndex: string | null;
  position: unknown;
  tags: string[];
}

export interface FixtureQueryResult {
  ok: true;
  libraries: Array<{ libraryID: number; type: string; name: string }>;
  collections: Record<string, { key: string; name: string; parentKey: string | null; itemCount: number }>;
  items: Record<string, ObservedItem>;
  notes: Record<string, { key: string; parentKey: string | null; html: string; collections: string[] }>;
  attachments: Record<string, ObservedAttachment>;
  annotations: Record<string, ObservedAnnotation>;
  savedSearch: { key: string; name: string; resultKeys: string[] } | null;
  bulk: { collectionItemCount: number; taggedCount: number };
  group: { libraryID: number; groupID: number; name: string; itemKeys: string[]; collectionKeys: string[] } | null;
}

export interface TableFingerprint {
  rows: number;
  sha256: string;
}

export interface FileFingerprint {
  path: string;
  exists: boolean;
  size: number | null;
  mtimeMs: number | null;
}

export interface FingerprintResult {
  ok: true;
  tables: Record<string, TableFingerprint>;
  maxima: Record<string, string | number | null>;
  files: FileFingerprint[];
}

export type UiAction =
  | { action: "report" }
  | { action: "selectLibrary"; libraryID: number }
  | { action: "selectCollection"; libraryID: number; key: string }
  | { action: "selectSavedSearch"; libraryID: number; key: string }
  | { action: "selectItems"; libraryID: number; keys: string[] }
  | { action: "clearItemSelection" }
  /** inWindow: a separate reader window (ReaderWindow) instead of a main-window tab. */
  | { action: "openReader"; libraryID: number; key: string; pageIndex: number; inWindow?: boolean }
  | { action: "navigateReader"; pageIndex: number }
  | { action: "setTextSelection"; pageIndex: number; length: number }
  | { action: "clearTextSelection" }
  | { action: "selectAnnotations"; keys: string[] }
  /** Open a note in a main-window note tab (Zotero 11's default) and wait until it is the active tab. */
  | { action: "openNoteTab"; libraryID: number; key: string }
  /** Close every reader and note tab and reader window, back to the library tab. */
  | { action: "closeReaders" };

export interface ReaderUiState {
  tabID: string | null;
  inWindow: boolean;
  libraryID: number | null;
  attachmentKey: string | null;
  readerType: string | null;
  pageIndex: number | null;
  pageLabel: string | null;
  pagesCount: number | null;
  selectedText: string | null;
  selectedAnnotationKeys: string[];
}

export interface UiState {
  mainWindow: boolean;
  tab: { id: string | null; type: string | null; title: string | null };
  tabCount: number;
  treeRows: Array<{ id: string; type: string; name: string }>;
  selectedItems: Array<{ libraryID: number; key: string }>;
  readers: number;
  /** The focused reader window if it is the most recent Zotero window, else the active reader tab. */
  reader: ReaderUiState | null;
  /** windowtype of Services.wm.getMostRecentWindow(null). */
  mostRecentWindowType: string | null;
  windows: WindowState[];
}

export interface UiResult {
  ok: true;
  action: UiAction["action"];
  /** False when the action cannot be performed in this Zotero build (with the reason). */
  feasible: boolean;
  reason: string | null;
  /** How the action was carried out (e.g. which reader API), for the report. */
  method: string | null;
  state: UiState;
  ms: number;
}

export interface PrefRequest {
  name: (typeof SEED_WRITABLE_PREFS)[number];
  value: boolean | null;
}

export interface PrefResult {
  ok: true;
  name: string;
  value: boolean | string | number | null;
}

export interface AddonRequest {
  id: string;
  action: "status" | "disable" | "enable";
}

export interface AddonResult {
  ok: true;
  addon: PluginState | null;
  endpoints: string[];
  ms: number;
}

/**
 * Preferences window driver: "open" opens Zotero's preferences at the plugin's pane and waits until the pane
 * is loaded, shown and its status line translated; "close" closes the window.
 * `messages` are formatted per locale through a fresh Fluent Localization (value-only message ids).
 */
export interface PrefsPaneRequest {
  action: "open" | "close";
  pluginID: string;
  messages?: { locales: string[]; ids: string[] };
}

export interface PaneElementState {
  id: string | null;
  tag: string;
  l10nId: string;
  /** Trimmed text content (Fluent message value). */
  text: string;
  /** Fluent `.label` attribute target (button). */
  label: string | null;
}

export interface PaneState {
  loaded: boolean;
  shown: boolean;
  /** The h1 Zotero prepends with the pane's label. */
  heading: string | null;
  elements: PaneElementState[];
  status: { l10nId: string | null; text: string } | null;
  address: string | null;
  /** Button id -> disabled attribute present. */
  buttonsDisabled: Record<string, boolean>;
}

export interface PrefsPaneResult {
  ok: true;
  /** The pane Zotero.PreferencePanes holds for the plugin, or null when it registered none. */
  registered: { paneID: string; label: string; image: string | null; imageBytes: number | null } | null;
  windowOpen: boolean;
  pane: PaneState | null;
  /** Whether Zotero's unified plugin Fluent source exists in L10nRegistry. */
  l10nSourceRegistered: boolean;
  availableLocales: string[];
  /** locale -> message id -> formatted value (null: missing); a locale Zotero does not ship maps to null. */
  messages: Record<string, Record<string, string | null> | null>;
  ms: number;
}
