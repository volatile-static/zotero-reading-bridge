---
name: zotero
description: "Use when the user asks about papers, references, citations, notes, annotations, PDFs, collections or tags in their Zotero library, or refers to the paper open or selected in Zotero. Works through the read-only zotero_bridge MCP tools of the running Zotero desktop app."
---

# Zotero (Codex)

This plugin connects Codex to the Zotero AI Bridge running inside the user's Zotero desktop app on this computer.
Its MCP server is registered as `zotero_bridge`, so the tools appear as `mcp__zotero_bridge__<tool>` (for example
`mcp__zotero_bridge__search_items`). Everything is read-only.

Before each message, a `UserPromptSubmit` hook calls `capture_prompt_context` and attaches the current Zotero state
as a `<zotero_snapshot>` block. No snapshot means the hook did not run for this message: it has not been trusted yet
(Codex hook review), it failed, or Zotero was not running when this Codex session started. In that case follow the
policy below and call `get_current_context` when the user refers to the current paper or selection.

To read an attachment, get its path with `get_attachment_path`, then open the file with Codex's own file or shell
tools; reading outside the workspace may need approval depending on the sandbox settings.

<!-- @include shared/instructions/research-workflow.md -->

<!-- @include shared/instructions/context-policy.md -->
