/**
 * Synthetic fixture library for the live Zotero harness.
 *
 * Pure data (no Node or Zotero APIs): the seed plugin bundles it to create the objects inside the test
 * profile, and the harness imports it to know what every tool should return. Titles, creators, notes and
 * annotation comments deliberately mix Chinese, ASCII, spaces and HTML-significant characters.
 */

/** Fixture ids are stable names used by the harness; Zotero keys are assigned at seed time. */
export type FixtureId = string;

export const FIXTURE_TAG = "zab-fixture";
export const BULK_TAG = "zab-bulk";
export const GROUP_TAG = "zab-group";
/** More than PAGE_LIMIT_MAX (200) so every list tool needs a second page. */
export const BULK_ITEM_COUNT = 230;
export const BULK_TITLE_PREFIX = "Bulk fixture item";

/** Page labels of the generated PDF start at 101 so tests can tell labels from 0-based indexes. */
export const PDF_FIRST_PAGE_LABEL = 101;
export const PDF_PAGES: readonly (readonly string[])[] = [
  ["Zotero Reading Bridge fixture document", "Selection target: alpha beta gamma delta", "Page one body text for search."],
  ["Fixture page two underline target", "Second page body text."],
  ["Fixture page three image and ink region", "Third page body text."],
];

/**
 * 1x1 PNG the seed stores as the cached rendering of the image annotation (Zotero.Annotations.saveCacheImage), so
 * get_annotations has a cache file to attach without first rendering the page. Opening the reader may replace it with
 * a real rendering, so cases only check that a PNG is attached.
 */
export const ANNOTATION_CACHE_PNG: readonly number[] = [
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01,
  0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x44, 0x41,
  0x54, 0x78, 0x9c, 0x63, 0xf8, 0xcf, 0xc0, 0xf0, 0x1f, 0x00, 0x05, 0x00, 0x01, 0xff, 0x89, 0x99, 0x3d, 0x1d, 0x00, 0x00,
  0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
];

/** Image annotations that get a cached PNG at seed time. */
export const CACHED_IMAGE_ANNOTATIONS: readonly FixtureId[] = ["ann-image"];

export interface FixtureCreator {
  creatorType: string;
  firstName?: string;
  lastName?: string;
  /** Single-field (institutional) name. */
  name?: string;
}

export interface FixtureCollection {
  id: FixtureId;
  name: string;
  parent?: FixtureId;
}

export interface FixtureItem {
  id: FixtureId;
  itemType: string;
  title: string;
  creators: FixtureCreator[];
  fields: Record<string, string>;
  tags: string[];
  collections: FixtureId[];
  deleted?: boolean;
}

export interface FixtureNote {
  id: FixtureId;
  /** Parent fixture item; absent for a standalone note. */
  parent?: FixtureId;
  html: string;
  collections: FixtureId[];
}

export type FixtureAttachmentKind = "stored" | "linked" | "missing-linked" | "missing-stored";

export interface FixtureAttachment {
  id: FixtureId;
  parent: FixtureId;
  kind: FixtureAttachmentKind;
  title: string;
  /** Attachment note (shown in Zotero's attachment pane), HTML. */
  note?: string;
}

export type FixtureAnnotationType = "highlight" | "underline" | "note" | "text" | "image" | "ink";

export interface FixtureAnnotation {
  id: FixtureId;
  attachment: FixtureId;
  type: FixtureAnnotationType;
  text?: string;
  comment: string;
  color: string;
  pageIndex: number;
  position: Record<string, unknown>;
  tags: string[];
}

export interface FixtureSavedSearch {
  id: FixtureId;
  name: string;
  conditions: Array<{ condition: string; operator: string; value: string }>;
}

export interface FixtureGroup {
  groupID: number;
  name: string;
  collection: { id: FixtureId; name: string };
  items: FixtureItem[];
}

export const COLLECTIONS: readonly FixtureCollection[] = [
  { id: "col-root", name: "中文研究 Root Collection" },
  { id: "col-child", name: "子集合 Child", parent: "col-root" },
  { id: "col-grandchild", name: "孙集合 Grandchild", parent: "col-child" },
  { id: "col-bulk", name: "Bulk 批量" },
  { id: "col-empty", name: "空集合 Empty" },
];

export const ITEMS: readonly FixtureItem[] = [
  {
    id: "item-zh-article",
    itemType: "journalArticle",
    title: "深度学习在文献管理中的应用研究",
    creators: [
      { creatorType: "author", lastName: "张", firstName: "伟" },
      { creatorType: "author", lastName: "李", firstName: "娜" },
    ],
    fields: {
      date: "2023-05-17",
      publicationTitle: "计算机学报",
      DOI: "10.1234/zab.2023.001",
      abstractNote: "本文提出一种用于测试的文献管理方法。",
    },
    tags: ["机器学习", FIXTURE_TAG],
    collections: ["col-root"],
  },
  {
    id: "item-en-book",
    itemType: "book",
    title: "Reading Machines: A Fixture Book",
    creators: [{ creatorType: "author", lastName: "Smith", firstName: "Alice" }],
    fields: { date: "2019", publisher: "Fixture Press", place: "Shanghai 上海" },
    tags: [FIXTURE_TAG, "english"],
    collections: ["col-child"],
  },
  {
    id: "item-mixed",
    itemType: "conferencePaper",
    title: "混合 Mixed 标题 with spaces & <symbols>",
    creators: [{ creatorType: "author", name: "中国科学院 Fixture Institute" }],
    fields: { date: "2021-11", proceedingsTitle: "会议论文集 Proceedings" },
    tags: [FIXTURE_TAG],
    collections: ["col-grandchild"],
  },
  {
    id: "item-pdf-parent",
    itemType: "journalArticle",
    title: "带附件的论文：阅读器测试 Reader Fixture Paper",
    creators: [
      { creatorType: "author", lastName: "Brown", firstName: "Bob" },
      { creatorType: "author", lastName: "王", firstName: "芳" },
    ],
    fields: { date: "2022-03-04", publicationTitle: "Journal of Fixtures", DOI: "10.1234/zab.2022.042" },
    tags: [FIXTURE_TAG, "reader"],
    collections: ["col-root"],
  },
  {
    id: "item-linked-parent",
    itemType: "report",
    title: "链接文件测试 Linked File Report",
    creators: [{ creatorType: "author", lastName: "Chen", firstName: "Li" }],
    fields: { date: "2020-01-01", institution: "测试研究所" },
    tags: ["linked"],
    collections: [],
  },
  {
    id: "item-missing-parent",
    itemType: "thesis",
    title: "缺失附件测试 Missing Attachment Thesis",
    creators: [{ creatorType: "author", lastName: "赵", firstName: "敏" }],
    fields: { date: "2018", university: "测试大学" },
    tags: ["missing"],
    collections: [],
  },
  {
    id: "item-trashed",
    itemType: "journalArticle",
    title: "已删除的条目 Trashed Fixture",
    creators: [{ creatorType: "author", lastName: "Trash", firstName: "Tom" }],
    fields: { date: "2017" },
    tags: [FIXTURE_TAG],
    collections: ["col-root"],
    deleted: true,
  },
];

/** Tagged with FIXTURE_TAG and not in the trash: what the saved search must return. */
export const FIXTURE_TAGGED_LIVE_ITEMS: readonly FixtureId[] = ITEMS.filter(
  (item) => item.tags.includes(FIXTURE_TAG) && !item.deleted,
).map((item) => item.id);

export const NOTE_HTML =
  '<div data-schema-version="9"><h1>笔记标题 Fixture Note</h1>' +
  "<p>第一段落 with <strong>bold</strong> &amp; entity.</p>" +
  "<ul><li>列表项一</li><li>item two</li></ul></div>";

/** Long enough to exceed the get_notes default maxLength (20000). */
export const LONG_NOTE_REPEAT = 1200;
export const LONG_NOTE_UNIT = "长笔记内容 long note text. ";

export const NOTES: readonly FixtureNote[] = [
  { id: "note-child", parent: "item-pdf-parent", html: NOTE_HTML, collections: [] },
  { id: "note-standalone", html: "<p>独立笔记 Standalone note about 深度学习</p>", collections: ["col-root"] },
  {
    id: "note-long",
    parent: "item-en-book",
    html: `<p>${LONG_NOTE_UNIT.repeat(LONG_NOTE_REPEAT)}</p>`,
    collections: [],
  },
];

export const ATTACHMENTS: readonly FixtureAttachment[] = [
  { id: "att-stored-pdf", parent: "item-pdf-parent", kind: "stored", title: "Fixture PDF" },
  {
    id: "att-linked-pdf",
    parent: "item-linked-parent",
    kind: "linked",
    title: "链接 PDF Linked",
    note: "<p>附件笔记 Attachment note on the linked PDF</p>",
  },
  { id: "att-missing-linked", parent: "item-missing-parent", kind: "missing-linked", title: "缺失链接 Missing Linked" },
  { id: "att-missing-stored", parent: "item-missing-parent", kind: "missing-stored", title: "缺失存储 Missing Stored" },
];

/** Directory and file names (relative to the run's fixture directory) for file attachments. */
export const ATTACHMENT_FILES = {
  sourcePdf: "source/fixture.pdf",
  linkedPdf: "链接 附件 目录/测试 文档 linked.pdf",
  missingLinkedPdf: "缺失 目录/已删除 missing.pdf",
  missingStoredSource: "source/missing stored.pdf",
} as const;

export const ANNOTATIONS: readonly FixtureAnnotation[] = [
  {
    id: "ann-highlight",
    attachment: "att-stored-pdf",
    type: "highlight",
    text: "Selection target: alpha beta gamma delta",
    comment: "高亮评论 highlight comment",
    color: "#ffd400",
    pageIndex: 0,
    position: { pageIndex: 0, rects: [[72, 690, 380, 706]] },
    tags: ["标注标签"],
  },
  {
    id: "ann-underline",
    attachment: "att-stored-pdf",
    type: "underline",
    text: "Fixture page two underline target",
    comment: "",
    color: "#ff6666",
    pageIndex: 1,
    position: { pageIndex: 1, rects: [[72, 714, 330, 730]] },
    tags: [],
  },
  {
    id: "ann-note",
    attachment: "att-stored-pdf",
    type: "note",
    comment: "便笺 sticky note 中文",
    color: "#5fb236",
    pageIndex: 1,
    position: { pageIndex: 1, rects: [[400, 700, 422, 722]] },
    tags: [],
  },
  {
    id: "ann-text",
    attachment: "att-stored-pdf",
    type: "text",
    comment: "文本框 text box",
    color: "#2ea8e5",
    pageIndex: 0,
    position: { pageIndex: 0, fontSize: 14, rotation: 0, rects: [[72, 600, 272, 620]] },
    tags: [],
  },
  {
    id: "ann-image",
    attachment: "att-stored-pdf",
    type: "image",
    comment: "图片区域 image region",
    color: "#a28ae5",
    pageIndex: 2,
    position: { pageIndex: 2, rects: [[72, 500, 300, 700]] },
    tags: [],
  },
  {
    id: "ann-ink",
    attachment: "att-stored-pdf",
    type: "ink",
    comment: "",
    color: "#e56eee",
    pageIndex: 2,
    position: { pageIndex: 2, width: 2, paths: [[100, 400, 150, 420, 200, 400, 250, 430]] },
    tags: [],
  },
];

export const SAVED_SEARCH: FixtureSavedSearch = {
  id: "search-fixture-tag",
  name: "保存的搜索 Fixture Tag",
  conditions: [{ condition: "tag", operator: "is", value: FIXTURE_TAG }],
};

export const GROUP: FixtureGroup = {
  groupID: 9900001,
  name: "测试群组 Fixture Group",
  collection: { id: "group-col", name: "群组集合 Group Collection" },
  items: [
    {
      id: "group-item",
      itemType: "journalArticle",
      title: "群组条目 Group Fixture Item",
      creators: [{ creatorType: "author", lastName: "Group", firstName: "Gina" }],
      fields: { date: "2024-02-02" },
      tags: [GROUP_TAG],
      collections: ["group-col"],
    },
  ],
};

export function bulkTitle(index: number): string {
  return `${BULK_TITLE_PREFIX} ${String(index + 1).padStart(3, "0")}`;
}

/** Zotero sortIndex for a PDF annotation: pageIndex|offset|top (5|6|5 digits). */
export function pdfSortIndex(pageIndex: number, offset: number, top: number): string {
  return `${String(pageIndex).padStart(5, "0")}|${String(offset).padStart(6, "0")}|${String(top).padStart(5, "0")}`;
}

/** Shape returned by the seed plugin's /zab-test/seed endpoint. */
export interface SeededObject {
  libraryID: number;
  key: string;
  id: number;
}

export interface SeedManifest {
  fixtureVersion: number;
  userLibraryID: number;
  group: { libraryID: number; groupID: number } | null;
  /** Reason the group library could not be created (null when it exists). */
  groupError: string | null;
  collections: Record<FixtureId, SeededObject>;
  items: Record<FixtureId, SeededObject>;
  notes: Record<FixtureId, SeededObject>;
  attachments: Record<FixtureId, SeededObject & { path: string | null }>;
  annotations: Record<FixtureId, SeededObject>;
  savedSearches: Record<FixtureId, SeededObject>;
  bulk: { collectionKey: string; keys: string[] };
}

export const FIXTURE_VERSION = 1;
