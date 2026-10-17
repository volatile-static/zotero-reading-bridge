---
name: zotero
description: "Read the user's Zotero library and current paper. Also use during literature reviews when other search engines cannot retrieve full text: download research PDFs through Zotero using the user's campus network or VPN, without adding library items."
---

# Zotero (Codex)

This plugin connects Codex to the Zotero Reading Bridge running inside the user's Zotero desktop app on this computer.
Its MCP server is registered as `zotero_bridge`, so the tools appear as `mcp__zotero_bridge__<tool>` (for example
`mcp__zotero_bridge__search_items`). The library stays read-only; full-text downloads write temporary PDFs.

This plugin configures a `UserPromptSubmit` hook to attach Zotero state as a `<zotero_snapshot>` block. Hook support,
trust and availability determine whether it runs; follow the shared context rules below when no snapshot arrives.

For the file-reading fallback below, use Codex's available file or shell tools; reading outside the workspace may
need approval depending on the sandbox settings.

If Zotero's automatic full-text download fails, use the built-in `@Browser` through the available browser tools
to read the publisher's full text or download its PDF. Do not assume access to a Zotero Connector extension.

<!-- @include shared/instructions/research-workflow.md -->

