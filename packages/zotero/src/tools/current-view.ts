/** Read the actual library item tree, including virtual views and feeds, without changing the UI. */
import type { ToolName } from "../../../../shared/types/tool-names.js";
import type { ZItem } from "../zotero/library.js";
import { withTimeout } from "../zotero/library.js";
import { itemSummary } from "../zotero/refs.js";
import { paginate, parsePageArgs } from "./pagination.js";
import { json, ToolError, type ToolHandler } from "./types.js";

interface TreeRow {
  id: string;
  type: string;
  getName(): string;
}
interface View {
  waitForLoad(): Promise<unknown>;
  getSortedItems(asIDs: false): ZItem[];
}
interface Window {
  Zotero_Tabs: { selectedType: string };
  ZoteroPane: { itemsView: View | false; getCollectionTreeRows(): TreeRow[] };
}
export interface ViewCapture {
  capturedAt: string;
  rows: Array<{ id: string; type: string; name: string }>;
  items: ZItem[];
}

export async function captureCurrentView(): Promise<ViewCapture> {
  const win = Zotero.getMainWindow() as unknown as Window | null;
  if (!win || win.Zotero_Tabs.selectedType !== "library" || !win.ZoteroPane.itemsView) {
    throw new ToolError("UNAVAILABLE", "Open the Zotero library tab and select a view first");
  }
  const pane = win.ZoteroPane;
  const view = pane.itemsView as View;
  const rows = pane.getCollectionTreeRows();
  const signature = JSON.stringify(rows.map(row => row.id));
  await withTimeout(view.waitForLoad(), 5000, () => new ToolError("TIMEOUT", "The current view is still loading; retry shortly"));
  if (win.Zotero_Tabs.selectedType !== "library" || pane.itemsView !== view
    || JSON.stringify(pane.getCollectionTreeRows().map(row => row.id)) !== signature) {
    throw new ToolError("UNAVAILABLE", "The current view changed while loading; retry");
  }
  return {
    capturedAt: new Date().toISOString(),
    rows: rows.map(row => ({ id: row.id, type: row.type, name: row.getName() })),
    items: [...view.getSortedItems(false)],
  };
}

/** Cursors pin membership/order for two minutes, even if the user changes view between pages. */
export function createCurrentViewHandler(capture = captureCurrentView, now = Date.now): ToolHandler {
  const snapshots = new Map<string, { expires: number; capture: ViewCapture }>();
  let sequence = 0;
  return async args => {
    for (const [key, value] of snapshots) if (value.expires <= now()) snapshots.delete(key);
    const page = parsePageArgs({ limit: args.limit });
    let token: string;
    let snapshot: ViewCapture;
    if (args.cursor !== undefined) {
      const match = typeof args.cursor === "string" ? /^v([a-z0-9]+)-o([0-9]{1,9})$/.exec(args.cursor) : null;
      if (!match) throw new ToolError("INVALID_ARGUMENT", "Invalid view cursor; pass back nextCursor unchanged");
      token = match[1]!;
      const cached = snapshots.get(token);
      if (!cached) throw new ToolError("UNAVAILABLE", "View cursor expired; omit cursor to read the current view again");
      snapshot = cached.capture;
      page.offset = Number(match[2]);
    } else {
      snapshot = await capture();
      token = `${now().toString(36)}${(++sequence).toString(36)}`;
      while (snapshots.size >= 3) snapshots.delete(snapshots.keys().next().value!);
      snapshots.set(token, { expires: now() + 120_000, capture: snapshot });
    }
    const result = paginate(snapshot.items, page);
    return json({
      view: { capturedAt: snapshot.capturedAt, rows: snapshot.rows },
      ...result,
      items: result.items.map(item => itemSummary(item)),
      nextCursor: result.nextCursor ? `v${token}-${result.nextCursor}` : null,
    });
  };
}

export const currentViewHandlers = {
  get_current_view_items: createCurrentViewHandler(),
} satisfies Partial<Record<ToolName, ToolHandler>>;
