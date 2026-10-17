---
name: zotero
description: "Use when the user asks about papers, references, citations, notes, annotations, PDFs, collections or tags in their Zotero library, or refers to the paper open or selected in Zotero. Works through the read-only zotero_bridge MCP tools of the running Zotero desktop app."
---

# Zotero (Codex)

This plugin connects Codex to the Zotero Reading Bridge running inside the user's Zotero desktop app on this computer.
Its MCP server is registered as `zotero_bridge`, so the tools appear as `mcp__zotero_bridge__<tool>` (for example
`mcp__zotero_bridge__search_items`). Everything is read-only.

This plugin configures a `UserPromptSubmit` hook to attach Zotero state as a `<zotero_snapshot>` block. Hook support,
trust and availability determine whether it runs; follow the shared context rules below when no snapshot arrives.

For the file-reading fallback below, use Codex's available file or shell tools; reading outside the workspace may
need approval depending on the sandbox settings.

<!-- @include shared/instructions/research-workflow.md -->

