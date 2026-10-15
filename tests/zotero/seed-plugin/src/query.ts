/**
 * Reads the seeded fixtures back through Zotero's own APIs so the harness can prove seeding worked
 * independently of the bridge (seed-only mode).
 */
import { BULK_TAG, type SeedManifest } from "../../fixtures/data.js";
import type { FixtureQueryResult, ObservedAnnotation, ObservedAttachment, ObservedItem } from "../../seed-api.js";

function getItem(libraryID: number, key: string): Zotero.Item {
  const item = Zotero.Items.getByLibraryAndKey(libraryID, key);
  if (!item) throw new Error(`Seeded item ${libraryID}/${key} not found`);
  return item as Zotero.Item;
}

function collectionKeys(item: Zotero.Item): string[] {
  return item
    .getCollections()
    .map((id: number) => (Zotero.Collections.get(id) as Zotero.Collection | false))
    .filter((col): col is Zotero.Collection => !!col)
    .map((col) => col.key)
    .sort();
}

function observeItem(item: Zotero.Item): ObservedItem {
  const json = item.toJSON() as Record<string, unknown>;
  const fields: Record<string, string> = {};
  for (const [name, value] of Object.entries(json)) {
    if (typeof value === "string" && !["key", "itemType", "dateAdded", "dateModified"].includes(name)) {
      fields[name] = value;
    }
  }
  return {
    key: item.key,
    libraryID: item.libraryID,
    itemType: item.itemType,
    title: item.getField("title") as string,
    deleted: item.deleted,
    tags: item.getTags().map((t: { tag: string }) => t.tag).sort(),
    collections: collectionKeys(item),
    creators: item.getCreatorsJSON() as unknown as Array<Record<string, string>>,
    fields,
  };
}

async function observeAttachment(item: Zotero.Item): Promise<ObservedAttachment> {
  const path = (await item.getFilePathAsync()) || null;
  return {
    key: item.key,
    parentKey: item.parentKey || null,
    linkMode: Zotero.Attachments.linkModeToName(item.attachmentLinkMode),
    contentType: item.attachmentContentType,
    // getFilePath() resolves the would-be path even when the file is missing.
    path: path ?? (item.getFilePath() || null),
    exists: await item.fileExists(),
    title: item.getField("title") as string,
  };
}

function observeAnnotation(item: Zotero.Item): ObservedAnnotation {
  const ann = item as any;
  let position: unknown = null;
  try {
    position = JSON.parse(ann.annotationPosition);
  } catch {
    position = null;
  }
  return {
    key: item.key,
    parentKey: item.parentKey || null,
    type: ann.annotationType,
    text: ann.annotationText ?? null,
    comment: ann.annotationComment ?? null,
    color: ann.annotationColor ?? null,
    pageLabel: ann.annotationPageLabel ?? null,
    sortIndex: ann.annotationSortIndex ?? null,
    position,
    tags: item.getTags().map((t: { tag: string }) => t.tag).sort(),
  };
}

export async function queryFixtures(manifest: SeedManifest): Promise<FixtureQueryResult> {
  const userLibraryID = manifest.userLibraryID;
  await Zotero.Libraries.userLibrary.waitForDataLoad("item");

  const result: FixtureQueryResult = {
    ok: true,
    libraries: (Zotero.Libraries.getAll() as Zotero.Library[]).map((lib) => ({
      libraryID: lib.libraryID,
      type: lib.libraryType,
      name: lib.name,
    })),
    collections: {},
    items: {},
    notes: {},
    attachments: {},
    annotations: {},
    savedSearch: null,
    bulk: { collectionItemCount: 0, taggedCount: 0 },
    group: null,
  };

  for (const [id, ref] of Object.entries(manifest.collections)) {
    const col = Zotero.Collections.getByLibraryAndKey(ref.libraryID, ref.key) as Zotero.Collection | false;
    if (!col) throw new Error(`Seeded collection ${id} not found`);
    await (Zotero.Libraries.get(ref.libraryID) as Zotero.Library).waitForDataLoad("item");
    result.collections[id] = {
      key: col.key,
      name: col.name,
      parentKey: col.parentKey || null,
      itemCount: col.getChildItems(true, false).length,
    };
  }
  for (const [id, ref] of Object.entries(manifest.items)) {
    result.items[id] = observeItem(getItem(ref.libraryID, ref.key));
  }
  for (const [id, ref] of Object.entries(manifest.notes)) {
    const note = getItem(ref.libraryID, ref.key);
    result.notes[id] = {
      key: note.key,
      parentKey: note.parentKey || null,
      html: note.getNote(),
      collections: note.isTopLevelItem() ? collectionKeys(note) : [],
    };
  }
  for (const [id, ref] of Object.entries(manifest.attachments)) {
    result.attachments[id] = await observeAttachment(getItem(ref.libraryID, ref.key));
  }
  for (const [id, ref] of Object.entries(manifest.annotations)) {
    result.annotations[id] = observeAnnotation(getItem(ref.libraryID, ref.key));
  }

  const searchRef = Object.values(manifest.savedSearches)[0];
  if (searchRef) {
    const search = Zotero.Searches.getByLibraryAndKey(searchRef.libraryID, searchRef.key) as Zotero.Search | false;
    if (!search) throw new Error("Seeded saved search not found");
    const ids = [...new Set<number>(await search.search())];
    const items = (await Zotero.Items.getAsync(ids)) as Zotero.Item[];
    const topLevel = new Set(items.filter((item) => !item.deleted).map((item) => item.topLevelItem.key));
    result.savedSearch = { key: search.key, name: search.name, resultKeys: [...topLevel].sort() };
  }

  const bulkCollection = Zotero.Collections.getByLibraryAndKey(userLibraryID, manifest.bulk.collectionKey) as
    | Zotero.Collection
    | false;
  result.bulk.collectionItemCount = bulkCollection ? bulkCollection.getChildItems(true, false).length : 0;
  const tagSearch = new Zotero.Search({ libraryID: userLibraryID } as any);
  tagSearch.addCondition("tag", "is", BULK_TAG);
  result.bulk.taggedCount = new Set<number>(await tagSearch.search()).size;

  if (manifest.group) {
    const group = Zotero.Groups.get(manifest.group.groupID) as any;
    if (!group) throw new Error(`Seeded group ${manifest.group.groupID} not found`);
    result.group = {
      libraryID: group.libraryID,
      groupID: group.groupID,
      name: group.name,
      itemKeys: ((await Zotero.Items.getAll(group.libraryID, true, false, false)) as Zotero.Item[])
        .map((item) => item.key)
        .sort(),
      collectionKeys: (Zotero.Collections.getByLibrary(group.libraryID) as Zotero.Collection[])
        .map((col) => col.key)
        .sort(),
    };
  }
  return result;
}
