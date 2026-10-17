/**
 * Command-line entry of the relay (bundled to server/zotero-relay.js; Claude Desktop runs it as
 * `node zotero-relay.js --port <port>`, Codex without arguments). stdout carries only JSON-RPC; diagnostics go to
 * stderr, which the client writes to its MCP server log.
 */
import { endpointUrl } from "../types/bridge.js";
import { RELAY_NAME, UsageError, parseRelayArgs, runRelay } from "./relay.js";

/** Replaced with the package version by the build (scripts/lib/bundle.ts). */
declare const __RELAY_VERSION__: string | undefined;
const version = typeof __RELAY_VERSION__ === "string" ? __RELAY_VERSION__ : "0.0.0-dev";

const log = (line: string): void => {
  process.stderr.write(`[${RELAY_NAME}] ${line}\n`);
};

// No top-level await: the bundle is CommonJS so that `node zotero-relay.js` works without a package.json beside it.
async function main(): Promise<void> {
  try {
    const options = parseRelayArgs(process.argv.slice(2));
    log(`${version}: stdio <-> ${endpointUrl(options.port)}`);
    await runRelay(options, { input: process.stdin, output: process.stdout, log, version });
  } catch (error) {
    log(error instanceof UsageError ? `usage error: ${error.message}` : `failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 2;
  }
}

void main();
