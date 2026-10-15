/**
 * get_schema (Zotero sandbox only): item types, their fields and creator types, with localized names.
 */
import type { ToolName } from "../../../../shared/types/tool-names.js";
import { findItemType, type ItemTypeInfo } from "../zotero/lookup.js";
import { safe } from "../zotero/refs.js";
import { textArg } from "./data-args.js";
import { compareCodeUnits } from "./search-plan.js";
import { json, type ToolArgs, type ToolHandler, type ToolOutput } from "./types.js";

/** Zotero.ItemFields (xpcom/data/itemFields.js) is missing from zotero-types. */
interface ItemFieldsApi {
  getItemTypeFields(itemTypeID: number): number[];
  getName(field: number): string | false;
  getLocalizedString(field: number): string;
  getBaseIDFromTypeAndField(itemType: number, field: number): number | false;
}

interface ItemTypeEntry {
  /** Internal name used by search_items' itemType filter and in item data. */
  itemType: string;
  localized: string;
}

interface FieldEntry {
  field: string;
  localized: string;
  /** Base field this type-specific field maps to (e.g. label -> publisher), else null. */
  baseField: string | null;
}

interface CreatorTypeEntry {
  creatorType: string;
  localized: string;
  primary: boolean;
}

function itemTypeEntry(type: ItemTypeInfo): ItemTypeEntry {
  return { itemType: type.name, localized: safe(() => Zotero.ItemTypes.getLocalizedString(type.id), "") || type.name };
}

function fieldEntries(type: ItemTypeInfo): FieldEntry[] {
  const fields = (Zotero as unknown as { ItemFields: ItemFieldsApi }).ItemFields;
  // Throws for types without field data (note, annotation): those simply have no fields.
  const ids = safe(() => fields.getItemTypeFields(type.id), [] as number[]);
  const entries: FieldEntry[] = [];
  for (const fieldID of ids) {
    const field = safe(() => fields.getName(fieldID), false as string | false);
    if (!field) continue;
    const baseID = safe(() => fields.getBaseIDFromTypeAndField(type.id, fieldID), false as number | false);
    entries.push({
      field,
      localized: safe(() => fields.getLocalizedString(fieldID), "") || field,
      baseField: baseID && baseID !== fieldID ? safe(() => fields.getName(baseID) || null, null) : null,
    });
  }
  return entries;
}

function creatorTypeEntries(type: ItemTypeInfo): CreatorTypeEntry[] {
  const primaryID = safe(() => Zotero.CreatorTypes.getPrimaryIDForType(type.id), false as number | false);
  // Zotero orders these primary first, then by localized name.
  return safe(() => [...Zotero.CreatorTypes.getTypesForItemType(type.id)], []).map((creatorType) => ({
    creatorType: creatorType.name,
    localized: safe(() => Zotero.CreatorTypes.getLocalizedString(creatorType.id), "") || creatorType.name,
    primary: creatorType.id === primaryID,
  }));
}

async function getSchema(args: ToolArgs): Promise<ToolOutput> {
  const name = textArg(args, "itemType");
  if (name === null) {
    const types = safe(() => [...Zotero.ItemTypes.getTypes()] as ItemTypeInfo[], []);
    const itemTypes = types
      .map(itemTypeEntry)
      .sort((a, b) => Zotero.localeCompare(a.localized, b.localized) || compareCodeUnits(a.itemType, b.itemType));
    return json({ itemTypes });
  }
  const type = findItemType(name);
  return json({ ...itemTypeEntry(type), fields: fieldEntries(type), creatorTypes: creatorTypeEntries(type) });
}

export const schemaHandlers = {
  get_schema: getSchema,
} satisfies Partial<Record<ToolName, ToolHandler>>;
