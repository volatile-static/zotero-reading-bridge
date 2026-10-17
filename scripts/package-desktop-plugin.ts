/** Assemble the desktop plugin from staged files, reusing the Claude Desktop relay bytes. */
import type { ZipInputEntry } from "./lib/zip.js";

export function desktopPluginEntries(entries: ZipInputEntry[], relay: ZipInputEntry): ZipInputEntry[] {
  const files = new Map(entries.map((entry) => [entry.name, Buffer.from(entry.data)]));
  const read = (name: string) => JSON.parse(files.get(name)!.toString("utf8"));
  const put = (name: string, value: unknown) => files.set(name, Buffer.from(JSON.stringify(value, null, 2) + "\n"));
  const portable = read("plugin.json");
  portable.extensions["com.openai"].requires_local_executor = true;
  put("plugin.json", portable);
  const legacy = read(".codex-plugin/plugin.json");
  legacy.requires_local_executor = true;
  put(".codex-plugin/plugin.json", legacy);
  const server = { type: "stdio", command: "node", args: ["${PLUGIN_ROOT}/server/zotero-relay.js"], cwd: "${PLUGIN_ROOT}" };
  put("mcp.json", { $schema: "https://agent-plugins.org/schemas/1.0.0/mcp.schema.json", mcpServers: { zotero_bridge: server } });
  put(".mcp.json", { mcpServers: { zotero_bridge: server } });
  files.set(relay.name, Buffer.from(relay.data));
  put("server/package.json", { type: "commonjs" });
  files.delete(".agents/plugins/marketplace.json");
  return [...files].map(([name, data]) => ({ name, data }));
}
