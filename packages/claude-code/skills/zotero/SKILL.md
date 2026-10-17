---
name: zotero
description: "Use when the user asks about papers, references, citations, notes, annotations, PDFs, collections or tags in their Zotero library, or refers to the paper open or selected in Zotero. Works through the read-only Zotero Reading Bridge MCP tools of the running Zotero desktop app."
---

# Zotero (Claude Code)

This plugin connects Claude Code to the Zotero Reading Bridge running inside the user's Zotero desktop app on this
computer. Its MCP server is `plugin:zotero-reading-bridge:zotero`, so the tools appear as
`mcp__plugin_zotero-reading-bridge_zotero__<tool>` (for example `mcp__plugin_zotero-reading-bridge_zotero__search_items`).
Everything is read-only.

Before each message, a `UserPromptSubmit` hook calls `capture_prompt_context` and attaches the current Zotero state
as a `<zotero_snapshot>` block. No snapshot means the hook did not deliver one for this message: Zotero was not
running or not reachable, the bridge server was not connected yet, or the hook timed out. In that case follow the
policy below and call `get_current_context` when the user refers to the current paper or selection.

To read a document, call `get_fulltext` first: it returns the text Zotero already extracted. Only when that text is
missing or partial, get the file path with `get_attachment_path` and open the file with Claude Code's own tools (the
Read tool reads PDFs page by page); reading outside the project may ask for permission.

<!-- @include shared/instructions/research-workflow.md -->

<!-- @include shared/instructions/context-policy.md -->
