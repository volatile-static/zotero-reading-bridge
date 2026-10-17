/**
 * Reads the bridge's shipped Fluent files so live pane checks compare against the exact source strings.
 * Handles the subset those files use: single-line message values, `.attr = value` lines and `#` comments.
 */
import fs from "node:fs";
import path from "node:path";
import { REPO_ROOT } from "./paths.js";

export interface FtlMessage {
  value: string | null;
  attributes: Record<string, string>;
}

export function parseFtl(source: string): Map<string, FtlMessage> {
  const messages = new Map<string, FtlMessage>();
  let current: FtlMessage | null = null;
  for (const line of source.split(/\r?\n/)) {
    if (!line.trim() || line.startsWith("#")) continue;
    const message = /^([A-Za-z][\w-]*) =\s?(.*)$/.exec(line);
    if (message) {
      current = { value: message[2] ? message[2] : null, attributes: {} };
      messages.set(message[1]!, current);
      continue;
    }
    const attribute = /^\s+\.([\w-]+) = (.*)$/.exec(line);
    if (!attribute || !current) throw new Error(`Unsupported FTL line: ${line}`);
    current.attributes[attribute[1]!] = attribute[2]!;
  }
  return messages;
}

export function readBridgeFtl(locale: string): Map<string, FtlMessage> {
  return parseFtl(fs.readFileSync(path.join(REPO_ROOT, "packages", "zotero", "locale", locale, "zotero-reading-bridge.ftl"), "utf8"));
}

/** Formats a value the way Fluent renders it in the UI: variables substituted, bidi isolation marks dropped. */
export function renderFtlValue(value: string, args: Record<string, string> = {}): string {
  return value.replace(/\{\s*\$([\w-]+)\s*\}/g, (_, name: string) => {
    const arg = args[name];
    if (arg === undefined) throw new Error(`No value for FTL variable $${name}`);
    return arg;
  });
}

export function stripIsolationMarks(text: string): string {
  return text.replace(/[⁨⁩]/g, "");
}
