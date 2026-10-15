/**
 * Source-level checks of the Zotero preferences pane, locales and manifest (text only; nothing is loaded into
 * Zotero). The package verifier repeats the file-level checks on the built XPI.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import { describe, it } from "node:test";

import { PREF_ENABLED, ZOTERO_ADDON_ID } from "../../shared/types/bridge.js";

const ZOTERO_DIR = new URL("../../packages/zotero/", import.meta.url);
const LOCALES = ["en-US", "zh-CN"] as const;

function read(rel: string): string {
  return fs.readFileSync(new URL(rel, ZOTERO_DIR), "utf8");
}

/** Fluent message id -> attribute names (`.label` etc.); enough of the syntax for our flat files. */
function parseFtl(text: string): Map<string, Set<string>> {
  const messages = new Map<string, Set<string>>();
  let current: Set<string> | undefined;
  for (const line of text.split("\n")) {
    const message = /^([A-Za-z][\w-]*)[ \t]*=/.exec(line);
    if (message?.[1]) {
      current = new Set();
      messages.set(message[1], current);
      continue;
    }
    const attribute = /^[ \t]+\.([\w-]+)[ \t]*=/.exec(line);
    if (attribute?.[1]) current?.add(attribute[1]);
  }
  return messages;
}

const markup = read("content/preferences.xhtml");
const paneScript = read("content/preferences.ts");
const ftl = new Map(LOCALES.map((locale) => [locale, parseFtl(read(`locale/${locale}/zotero-ai-bridge.ftl`))]));

describe("preferences pane localization", () => {
  const markupIds = [...markup.matchAll(/\bdata-l10n-id="([^"]+)"/g)].map((m) => m[1] ?? "");
  const scriptIds = [...paneScript.matchAll(/"(zotero-ai-bridge-[\w-]+)"/g)].map((m) => m[1] ?? "");

  it("uses only prefixed ids, all defined in every locale", () => {
    assert.ok(markupIds.length > 0 && scriptIds.length > 0);
    for (const id of [...markupIds, ...scriptIds]) {
      assert.match(id, /^zotero-ai-bridge-/, id);
      for (const [locale, messages] of ftl) assert.ok(messages.has(id), `${id} missing in ${locale}`);
    }
  });

  it("gives buttons and checkboxes a .label attribute", () => {
    for (const m of markup.matchAll(/<(button|checkbox)\b[^>]*?\bdata-l10n-id="([^"]+)"/g)) {
      for (const [locale, messages] of ftl) {
        assert.ok(messages.get(m[2] ?? "")?.has("label"), `${m[2]} (${m[1]}) lacks .label in ${locale}`);
      }
    }
  });

  it("defines the same messages and attributes in every locale", () => {
    const [first, ...others] = [...ftl.values()];
    assert.ok(first);
    for (const other of others) {
      assert.deepEqual(
        [...other].map(([id, attrs]) => [id, [...attrs]]),
        [...first].map(([id, attrs]) => [id, [...attrs]]),
      );
    }
  });
});

describe("preferences pane markup", () => {
  it("has no inline event handlers (Zotero 11 chrome CSP)", () => {
    assert.doesNotMatch(markup, /\son[a-z]+\s*=/i);
  });

  it("contains every element id the pane script looks up", () => {
    const declared = new Set([...markup.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]));
    const used = [...paneScript.matchAll(/"(zab-[\w-]+)"/g)].map((m) => m[1]);
    assert.ok(used.length > 0);
    for (const id of used) assert.ok(declared.has(id), `#${id} is not in preferences.xhtml`);
  });

  it("binds the enable checkbox to the plugin pref", () => {
    assert.match(markup, new RegExp(`<checkbox\\b[^>]*\\bpreference="${PREF_ENABLED.replace(/[.-]/g, "\\$&")}"`));
  });

  it("links the plugin's Fluent file", () => {
    assert.match(markup, /<html:link rel="localization" href="zotero-ai-bridge\.ftl"\/>/);
  });
});

describe("manifest.json and prefs.js", () => {
  const manifest = JSON.parse(read("manifest.json")) as {
    manifest_version: number;
    icons: Record<string, string>;
    applications: { zotero: Record<string, string> };
  };

  it("declares the Zotero 11 application block (design decision 16)", () => {
    assert.equal(manifest.manifest_version, 2);
    assert.deepEqual(manifest.applications.zotero, {
      id: ZOTERO_ADDON_ID,
      update_url: "https://zotero-ai-bridge.invalid/update.json",
      strict_min_version: "10.999",
      strict_max_version: "11.*",
    });
  });

  it("points every icon at an existing file", () => {
    assert.ok(Object.keys(manifest.icons).length > 0);
    for (const icon of Object.values(manifest.icons)) assert.ok(fs.existsSync(new URL(icon, ZOTERO_DIR)), icon);
  });

  it("defaults the enable pref to true", () => {
    assert.match(read("prefs.js"), new RegExp(`^pref\\("${PREF_ENABLED.replace(/[.-]/g, "\\$&")}", true\\);$`, "m"));
  });
});
