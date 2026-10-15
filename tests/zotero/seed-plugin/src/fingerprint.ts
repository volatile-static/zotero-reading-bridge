/**
 * Database and file fingerprint used by the read-only verification case: if any bridge tool wrote to the
 * library (items, collections, searches, tags, annotations, notes, attachment state, settings) or touched
 * an attachment file, a hash or maximum below changes.
 */
import type { FileFingerprint, FingerprintResult } from "../../seed-api.js";
import { sha256Hex } from "./util.js";

/** Every user-data table a read-only bridge must never modify, with a deterministic row order. */
const TABLE_QUERIES: Record<string, string> = {
  libraries:
    "SELECT libraryID, type, editable, filesEditable, version, clientVersion, storageVersion, lastSync, archived FROM libraries ORDER BY libraryID",
  groups: "SELECT groupID, libraryID, name, description, version FROM groups ORDER BY groupID",
  items:
    "SELECT itemID, itemTypeID, libraryID, key, dateAdded, dateModified, clientDateModified, version, clientVersion, synced FROM items ORDER BY itemID",
  itemData: "SELECT itemID, fieldID, valueID FROM itemData ORDER BY itemID, fieldID",
  itemDataValues: "SELECT valueID, value FROM itemDataValues ORDER BY valueID",
  itemCreators: "SELECT itemID, creatorID, creatorTypeID, orderIndex FROM itemCreators ORDER BY itemID, orderIndex",
  creators: "SELECT creatorID, firstName, lastName, fieldMode FROM creators ORDER BY creatorID",
  itemNotes: "SELECT itemID, parentItemID, note, title FROM itemNotes ORDER BY itemID",
  itemAttachments:
    "SELECT itemID, parentItemID, linkMode, contentType, path, syncState, storageModTime, storageHash, lastProcessedModificationTime, lastRead FROM itemAttachments ORDER BY itemID",
  itemAnnotations:
    "SELECT itemID, parentItemID, type, authorName, text, comment, color, pageLabel, sortIndex, position, isExternal FROM itemAnnotations ORDER BY itemID",
  tags: "SELECT tagID, name FROM tags ORDER BY tagID",
  itemTags: "SELECT itemID, tagID, type FROM itemTags ORDER BY itemID, tagID",
  itemRelations: "SELECT itemID, predicateID, object FROM itemRelations ORDER BY itemID, predicateID, object",
  collections:
    "SELECT collectionID, collectionName, parentCollectionID, clientDateModified, libraryID, key, version, clientVersion, synced FROM collections ORDER BY collectionID",
  collectionItems: "SELECT collectionID, itemID, orderIndex FROM collectionItems ORDER BY collectionID, itemID",
  savedSearches:
    "SELECT savedSearchID, savedSearchName, clientDateModified, libraryID, key, version, clientVersion, synced FROM savedSearches ORDER BY savedSearchID",
  savedSearchConditions:
    "SELECT savedSearchID, searchConditionID, condition, operator, value FROM savedSearchConditions ORDER BY savedSearchID, searchConditionID",
  deletedItems: "SELECT itemID, dateDeleted FROM deletedItems ORDER BY itemID",
  deletedCollections: "SELECT collectionID, dateDeleted FROM deletedCollections ORDER BY collectionID",
  deletedSearches: "SELECT savedSearchID, dateDeleted FROM deletedSearches ORDER BY savedSearchID",
  syncedSettings: "SELECT setting, libraryID, value, version, synced FROM syncedSettings ORDER BY setting, libraryID",
};

const MAXIMA_QUERIES: Record<string, string> = {
  "items.maxDateModified": "SELECT MAX(dateModified) FROM items",
  "items.maxClientDateModified": "SELECT MAX(clientDateModified) FROM items",
  "items.maxVersion": "SELECT MAX(version) FROM items",
  "items.maxClientVersion": "SELECT MAX(clientVersion) FROM items",
  "collections.maxClientDateModified": "SELECT MAX(clientDateModified) FROM collections",
  "savedSearches.maxClientDateModified": "SELECT MAX(clientDateModified) FROM savedSearches",
  "libraries.maxVersion": "SELECT MAX(version) FROM libraries",
  "libraries.maxClientVersion": "SELECT MAX(clientVersion) FROM libraries",
  "itemAnnotations.count": "SELECT COUNT(*) FROM itemAnnotations",
  "tags.count": "SELECT COUNT(*) FROM tags",
};

async function tableRows(sql: string): Promise<unknown[][]> {
  const rows = ((await Zotero.DB.queryAsync(sql)) as any[] | undefined) ?? [];
  const columns = /^SELECT (.+?) FROM /.exec(sql)?.[1]?.split(",").map((c) => c.trim()) ?? [];
  return rows.map((row) => columns.map((column) => row[column] ?? null));
}

async function fileFingerprint(path: string): Promise<FileFingerprint> {
  try {
    const info = await IOUtils.stat(path);
    return { path, exists: true, size: info.size ?? null, mtimeMs: info.lastModified ?? null };
  } catch {
    return { path, exists: false, size: null, mtimeMs: null };
  }
}

export async function fingerprint(files: string[]): Promise<FingerprintResult> {
  const tables: FingerprintResult["tables"] = {};
  for (const [name, sql] of Object.entries(TABLE_QUERIES)) {
    const rows = await tableRows(sql);
    tables[name] = { rows: rows.length, sha256: await sha256Hex(JSON.stringify(rows)) };
  }
  const maxima: FingerprintResult["maxima"] = {};
  for (const [name, sql] of Object.entries(MAXIMA_QUERIES)) {
    const value = (await Zotero.DB.valueQueryAsync(sql)) as string | number | false | null;
    maxima[name] = value === false ? null : value;
  }
  const fileResults: FileFingerprint[] = [];
  for (const path of files) fileResults.push(await fileFingerprint(path));
  return { ok: true, tables, maxima, files: fileResults };
}
