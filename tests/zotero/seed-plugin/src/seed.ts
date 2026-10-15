/**
 * Creates the fixture library (fixtures/data.ts) inside the test profile's data directory.
 * TEST ONLY: this is the one place in the repository that writes Zotero data.
 */
import {
  ANNOTATIONS,
  ATTACHMENTS,
  BULK_ITEM_COUNT,
  BULK_TAG,
  COLLECTIONS,
  FIXTURE_VERSION,
  GROUP,
  ITEMS,
  NOTES,
  PDF_FIRST_PAGE_LABEL,
  SAVED_SEARCH,
  bulkTitle,
  pdfSortIndex,
  type FixtureItem,
  type SeedManifest,
  type SeededObject,
} from "../../fixtures/data.js";
import type { SeedRequest } from "../../seed-api.js";
import { errorMessage } from "./util.js";

let seeded: SeedManifest | null = null;

function ref(obj: { libraryID: number; key: string; id: number }): SeededObject {
  return { libraryID: obj.libraryID, key: obj.key, id: obj.id };
}

function buildItem(spec: FixtureItem, libraryID: number, collectionIDs: number[]): Zotero.Item {
  const item = new Zotero.Item(spec.itemType as any);
  item.libraryID = libraryID;
  item.setField("title", spec.title);
  for (const [field, value] of Object.entries(spec.fields)) {
    item.setField(field as any, value);
  }
  item.setCreators(spec.creators as any);
  for (const tag of spec.tags) item.addTag(tag);
  if (collectionIDs.length) item.setCollections(collectionIDs);
  if (spec.deleted) item.deleted = true;
  return item;
}

async function seedGroup(manifest: SeedManifest): Promise<void> {
  try {
    // Zotero.Group accepts Library props (editable/filesEditable) besides its own; typings omit them.
    const group: any = new (Zotero.Group as any)({
      groupID: GROUP.groupID,
      name: GROUP.name,
      description: "",
      version: 0,
      editable: true,
      filesEditable: true,
    });
    await group.saveTx();
    const library = Zotero.Libraries.get(group.libraryID) as Zotero.Library;
    await library.waitForDataLoad("item");
    const collection = new Zotero.Collection({ libraryID: group.libraryID, name: GROUP.collection.name } as any);
    await collection.saveTx();
    manifest.collections[GROUP.collection.id] = ref(collection);
    for (const spec of GROUP.items) {
      const item = buildItem(spec, group.libraryID, [collection.id]);
      await item.saveTx();
      manifest.items[spec.id] = ref(item);
    }
    manifest.group = { libraryID: group.libraryID, groupID: GROUP.groupID };
  } catch (error) {
    manifest.groupError = errorMessage(error);
  }
}

export async function seedFixtures(request: SeedRequest): Promise<SeedManifest> {
  if (seeded) return seeded;
  const libraryID = Zotero.Libraries.userLibraryID;
  await Zotero.Libraries.userLibrary.waitForDataLoad("item");
  const manifest: SeedManifest = {
    fixtureVersion: FIXTURE_VERSION,
    userLibraryID: libraryID,
    group: null,
    groupError: null,
    collections: {},
    items: {},
    notes: {},
    attachments: {},
    annotations: {},
    savedSearches: {},
    bulk: { collectionKey: "", keys: [] },
  };

  for (const spec of COLLECTIONS) {
    const parent = spec.parent ? manifest.collections[spec.parent] : undefined;
    const collection = new Zotero.Collection({ libraryID, name: spec.name, parentID: parent?.id } as any);
    await collection.saveTx();
    manifest.collections[spec.id] = ref(collection);
  }
  const collectionID = (id: string): number => {
    const col = manifest.collections[id];
    if (!col) throw new Error(`Unknown fixture collection ${id}`);
    return col.id;
  };
  const itemID = (id: string): number => {
    const item = manifest.items[id];
    if (!item) throw new Error(`Unknown fixture item ${id}`);
    return item.id;
  };

  for (const spec of ITEMS) {
    const item = buildItem(spec, libraryID, spec.collections.map(collectionID));
    await item.saveTx();
    manifest.items[spec.id] = ref(item);
  }

  for (const spec of NOTES) {
    const note = new Zotero.Item("note");
    note.libraryID = libraryID;
    note.setNote(spec.html);
    if (spec.parent) note.parentID = itemID(spec.parent);
    else if (spec.collections.length) note.setCollections(spec.collections.map(collectionID));
    await note.saveTx();
    manifest.notes[spec.id] = ref(note);
  }

  const sources: Record<string, string> = {
    stored: request.files.sourcePdf,
    linked: request.files.linkedPdf,
    "missing-linked": request.files.missingLinkedPdf,
    "missing-stored": request.files.missingStoredSource,
  };
  for (const spec of ATTACHMENTS) {
    const file = sources[spec.kind];
    if (!file) throw new Error(`No source file for attachment kind ${spec.kind}`);
    const options = { file, parentItemID: itemID(spec.parent), title: spec.title, contentType: "application/pdf" };
    // Stored kinds are copied into storage/<KEY>/; linked kinds point at the harness's file in place.
    const attachment =
      spec.kind === "stored" || spec.kind === "missing-stored"
        ? await Zotero.Attachments.importFromFile(options)
        : await Zotero.Attachments.linkFromFile(options);
    if (spec.note) {
      attachment.setNote(spec.note);
      await attachment.saveTx();
    }
    const path = (await attachment.getFilePathAsync()) || null;
    manifest.attachments[spec.id] = { ...ref(attachment), path };
  }

  for (const [index, spec] of ANNOTATIONS.entries()) {
    const attachmentRef = manifest.attachments[spec.attachment];
    if (!attachmentRef) throw new Error(`Unknown fixture attachment ${spec.attachment}`);
    const attachment = Zotero.Items.get(attachmentRef.id) as Zotero.Item;
    const annotation = await Zotero.Annotations.saveFromJSON(attachment, {
      key: (Zotero as any).DataObjectUtilities.generateKey(),
      type: spec.type,
      text: spec.text,
      comment: spec.comment,
      color: spec.color,
      pageLabel: String(PDF_FIRST_PAGE_LABEL + spec.pageIndex),
      sortIndex: pdfSortIndex(spec.pageIndex, index * 10, 100 + index),
      position: spec.position,
      tags: spec.tags.map((name) => ({ name })),
    } as any);
    manifest.annotations[spec.id] = ref(annotation);
  }

  const search = new Zotero.Search({ libraryID, name: SAVED_SEARCH.name } as any);
  for (const condition of SAVED_SEARCH.conditions) {
    search.addCondition(condition.condition as any, condition.operator as any, condition.value);
  }
  await search.saveTx();
  manifest.savedSearches[SAVED_SEARCH.id] = ref(search);

  // One transaction keeps the >200-item bulk insert to a few seconds.
  const bulkCollectionID = collectionID("col-bulk");
  const bulkKeys: string[] = [];
  await Zotero.DB.executeTransaction(async () => {
    for (let i = 0; i < BULK_ITEM_COUNT; i++) {
      const item = new Zotero.Item("journalArticle");
      item.libraryID = libraryID;
      item.setField("title", bulkTitle(i));
      item.setField("date", `${2000 + (i % 20)}-01-${String((i % 28) + 1).padStart(2, "0")}`);
      item.setCreators([{ creatorType: "author", lastName: "Bulk", firstName: `Author ${i + 1}` }] as any);
      item.addTag(BULK_TAG);
      item.setCollections([bulkCollectionID]);
      await item.save();
      bulkKeys.push(item.key);
    }
  });
  manifest.bulk = { collectionKey: manifest.collections["col-bulk"]?.key ?? "", keys: bulkKeys };

  await seedGroup(manifest);
  seeded = manifest;
  return manifest;
}
