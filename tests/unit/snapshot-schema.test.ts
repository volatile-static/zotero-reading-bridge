/**
 * Keeps shared/contracts/context-snapshot.schema.json in sync with the ContextSnapshot type: a fully populated
 * sample (typed, so the compiler checks it against the TypeScript shape) must use exactly the declared
 * properties, every non-optional key must be required, and real snapshots must conform.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { formatHookContext } from "../../packages/zotero/src/context/hook-output.js";
import { assembleSnapshot, unavailableParts } from "../../packages/zotero/src/context/snapshot.js";
import type { ContextSnapshot } from "../../shared/types/snapshot.js";

interface SchemaNode {
  type?: string | string[];
  const?: unknown;
  enum?: unknown[];
  properties?: Record<string, SchemaNode>;
  required?: string[];
  additionalProperties?: boolean;
  items?: SchemaNode;
  anyOf?: SchemaNode[];
  $ref?: string;
  $defs?: Record<string, SchemaNode>;
  minimum?: number;
  minLength?: number;
}

const schema = JSON.parse(
  readFileSync(new URL("../../shared/contracts/context-snapshot.schema.json", import.meta.url), "utf8"),
) as SchemaNode & { $schema: string };

/** Properties that are optional in the TypeScript types (absent from `required`). */
const OPTIONAL_PROPERTIES = new Set(["groupID"]);

function resolve(node: SchemaNode): SchemaNode {
  if (!node.$ref) return node;
  const name = node.$ref.replace("#/$defs/", "");
  const target = schema.$defs?.[name];
  assert.ok(target, `unresolved $ref ${node.$ref}`);
  return resolve(target);
}

function jsonType(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (typeof value === "number") return Number.isInteger(value) ? "integer" : "number";
  return typeof value;
}

function typeMatches(declared: string | string[], actual: string): boolean {
  const types = Array.isArray(declared) ? declared : [declared];
  return types.includes(actual) || (actual === "integer" && types.includes("number"));
}

/**
 * Minimal structural check for the keywords this schema uses. `strict` additionally demands that the value
 * uses every declared (non-optional) property, which is what makes the fully populated sample a sync test.
 */
function check(value: unknown, rawNode: SchemaNode, path: string, strict: boolean): void {
  const node = resolve(rawNode);
  if (node.anyOf) {
    const errors: string[] = [];
    for (const branch of node.anyOf) {
      try {
        check(value, branch, path, strict);
        return;
      } catch (error) {
        errors.push(String(error));
      }
    }
    assert.fail(`${path}: no anyOf branch matched:\n${errors.join("\n")}`);
  }
  if ("const" in node) assert.deepEqual(value, node.const, `${path}: const`);
  if (node.enum) assert.ok(node.enum.includes(value), `${path}: ${JSON.stringify(value)} not in enum`);
  if (node.type) assert.ok(typeMatches(node.type, jsonType(value)), `${path}: type ${jsonType(value)} vs ${JSON.stringify(node.type)}`);
  if (typeof value === "number" && node.minimum !== undefined) assert.ok(value >= node.minimum, `${path}: minimum`);
  if (typeof value === "string" && node.minLength !== undefined) assert.ok(value.length >= node.minLength, `${path}: minLength`);

  if (jsonType(value) === "object") {
    assert.equal(node.type, "object", `${path}: object without type object`);
    assert.equal(node.additionalProperties, false, `${path}: additionalProperties must be false`);
    const properties = node.properties ?? {};
    const keys = Object.keys(value as object);
    for (const key of keys) assert.ok(key in properties, `${path}.${key}: not declared in the schema`);
    for (const key of node.required ?? []) assert.ok(keys.includes(key), `${path}.${key}: required but missing`);
    if (strict) {
      for (const key of Object.keys(properties)) {
        assert.ok(keys.includes(key) || OPTIONAL_PROPERTIES.has(key), `${path}.${key}: declared but not in the sample`);
      }
    }
    for (const key of keys) check((value as Record<string, unknown>)[key], properties[key] ?? {}, `${path}.${key}`, strict);
  }
  if (Array.isArray(value)) {
    assert.ok(node.items, `${path}: array without items schema`);
    value.forEach((entry, index) => check(entry, node.items ?? {}, `${path}[${index}]`, strict));
  }
}

/** Every field populated (nullable ones non-null, optional ones present, every array non-empty). */
const FULL_SAMPLE: ContextSnapshot = {
  schemaVersion: 1,
  snapshotId: "claude-code/s:sess/p:prompt/n:3/20261014T221200123Z",
  client: "claude-code",
  sessionId: "sess",
  turnId: "turn",
  promptId: "prompt",
  sequence: 3,
  capturedAt: "2026-10-14T22:12:00.123Z",
  status: "ok",
  unavailableReason: "the Zotero library pane could not be read",
  focus: "reader",
  activeTab: { type: "reader", title: "论文标题" },
  libraryView: {
    libraries: [{ libraryID: 2, type: "group", name: "Lab group", groupID: 12345 }],
    collections: [{ libraryID: 1, key: "COLL0002", collectionID: 7, name: "子集合", parentKey: "COLL0001" }],
    savedSearches: [{ libraryID: 1, key: "SRCH0001", searchID: 2, name: "Unread" }],
    otherRows: ["trash:1"],
    selectedItems: {
      count: 12,
      items: [{ libraryID: 1, key: "ITEM0001", itemID: 10, itemType: "journalArticle", title: "Deep learning" }],
      truncated: true,
    },
  },
  reader: {
    readerType: "pdf",
    location: "window",
    attachment: { libraryID: 1, key: "ATTA0001", itemID: 11, itemType: "attachment", title: "Full Text PDF", contentType: "application/pdf" },
    parentItem: { libraryID: 1, key: "ITEM0001", itemID: 10, itemType: "journalArticle", title: "Deep learning" },
    page: { index: 4, label: "5", count: 30 },
    selectedText: { text: "selected passage", length: 16, truncated: false },
    selectedAnnotations: {
      count: 1,
      items: [
        { libraryID: 1, key: "ANNO0001", annotationType: "highlight", text: "highlighted", comment: "note", color: "#ffd400", pageLabel: "5" },
      ],
      truncated: false,
    },
  },
  note: {
    location: "tab",
    item: { libraryID: 1, key: "NOTE0001", itemID: 12, itemType: "note", title: "读书笔记" },
    parentItem: { libraryID: 1, key: "ITEM0001", itemID: 10, itemType: "journalArticle", title: "Deep learning" },
  },
  warnings: ["Selected text truncated to 4000 of 9000 characters."],
};

describe("context-snapshot.schema.json", () => {
  it("is a draft 2020-12 schema whose top-level shape matches ContextSnapshot", () => {
    assert.equal(schema.$schema, "https://json-schema.org/draft/2020-12/schema");
    check(FULL_SAMPLE, schema, "$", true);
  });

  it("requires exactly the non-optional properties of every object", () => {
    const nodes: Array<[string, SchemaNode]> = [["$", schema], ...Object.entries(schema.$defs ?? {})];
    const visit = (name: string, node: SchemaNode): void => {
      if (node.properties) {
        const expected = Object.keys(node.properties).filter((key) => !OPTIONAL_PROPERTIES.has(key)).sort();
        assert.deepEqual([...(node.required ?? [])].sort(), expected, `${name}: required list`);
        for (const [key, child] of Object.entries(node.properties)) visit(`${name}.${key}`, child);
      }
    };
    for (const [name, node] of nodes) visit(name, node);
  });

  it("every $def is referenced", () => {
    const text = JSON.stringify(schema);
    for (const name of Object.keys(schema.$defs ?? {})) {
      assert.ok(text.includes(`"#/$defs/${name}"`), `${name} is never referenced`);
    }
  });

  it("accepts assembled snapshots in every status", () => {
    const meta = { client: null, sessionId: null, turnId: null, promptId: null, sequence: 1, capturedAt: "2026-10-14T22:12:00.123Z", maxTextLength: 4000 };
    const snapshots = [
      assembleSnapshot(unavailableParts("capture timed out after 2500 ms"), meta),
      assembleSnapshot(
        {
          activeTab: { type: "library", title: null },
          libraryView: {
            libraries: [{ libraryID: 1, type: "user", name: "My Library" }],
            collections: [],
            savedSearches: [],
            otherRows: [],
            selectedItems: { count: 0, items: [], truncated: false },
          },
          reader: null,
          note: null,
          warnings: [],
          error: null,
        },
        meta,
      ),
      assembleSnapshot(
        {
          activeTab: FULL_SAMPLE.activeTab,
          libraryView: FULL_SAMPLE.libraryView,
          reader: { ...(FULL_SAMPLE.reader as NonNullable<ContextSnapshot["reader"]>), parentItem: null, page: null, selectedText: "x".repeat(5000) },
          note: { ...(FULL_SAMPLE.note as NonNullable<ContextSnapshot["note"]>), parentItem: null },
          warnings: [],
          error: null,
        },
        meta,
      ),
    ];
    assert.deepEqual(snapshots.map((s) => s.status), ["unavailable", "empty", "ok"]);
    for (const snap of snapshots) check(JSON.parse(JSON.stringify(snap)), schema, "$", false);
  });

  it("snapshots shortened for the hook context still conform", () => {
    const big: ContextSnapshot = JSON.parse(JSON.stringify(FULL_SAMPLE));
    if (big.reader?.selectedText) big.reader.selectedText = { text: "长".repeat(20000), length: 20000, truncated: false };
    const context = formatHookContext(big, "rules", { hookContextChars: 2500 });
    const json = context.slice(context.indexOf("<zotero_snapshot>\n") + 18, context.indexOf("\n</zotero_snapshot>"));
    check(JSON.parse(json), schema, "$", false);
  });
});
