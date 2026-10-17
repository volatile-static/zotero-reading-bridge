/**
 * Every tool in shared/contracts/tools.json, in contract order.
 * The Zotero plugin types its handler map as Record<ToolName, ToolHandler>, so a missing handler is a
 * compile error; a unit test checks this list against the contract file.
 */
export const TOOL_NAMES = [
  "get_status",
  "get_current_context",
  "capture_prompt_context",
  "list_libraries",
  "list_collections",
  "get_collection",
  "list_saved_searches",
  "run_saved_search",
  "search_items",
  "get_items",
  "get_item_children",
  "list_tags",
  "get_notes",
  "get_annotations",
  "list_attachments",
  "get_attachment_path",
  "get_fulltext",
  "get_library_paths",
  "get_schema",
] as const;

export type ToolName = (typeof TOOL_NAMES)[number];
