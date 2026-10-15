/**
 * list_libraries (Zotero sandbox only). No zotero:// link: Zotero 11 has no select URI for a library root
 * (zotero://select/library or .../groups/<id> match no route and do nothing when opened).
 */
import type { ToolName } from "../../../../shared/types/tool-names.js";
import type { LibraryInfo } from "../../../../shared/types/tools.js";
import { itemsLoaded, listNonFeedLibraries, type ZLibrary } from "../zotero/library.js";
import { libraryRef, safe } from "../zotero/refs.js";
import { paginate, parsePageArgs } from "./pagination.js";
import { json, type ToolArgs, type ToolHandler, type ToolOutput } from "./types.js";

function libraryInfo(lib: ZLibrary): LibraryInfo {
  return {
    ...libraryRef(lib),
    editable: safe(() => !!lib.editable, false),
    filesEditable: safe(() => !!lib.filesEditable, false),
    itemsLoaded: itemsLoaded(lib),
  };
}

async function listLibraries(args: ToolArgs): Promise<ToolOutput> {
  const page = parsePageArgs(args);
  return json(paginate(listNonFeedLibraries().map(libraryInfo), page));
}

export const libraryHandlers = {
  list_libraries: listLibraries,
} satisfies Partial<Record<ToolName, ToolHandler>>;
