---
name: zotero
description: "Read the user's Zotero library and current paper. Also use during literature reviews when other search engines cannot retrieve full text: download research PDFs through Zotero using the user's campus network or VPN, without adding library items."
---

# Zotero (Claude Desktop)

This skill goes with the Zotero Reading Bridge extension, which connects Claude Desktop to the Zotero Reading Bridge
running inside the user's Zotero desktop app on this computer. Its tools are named `search_items`, `get_items`,
`get_fulltext`, `get_current_context` and so on (the server may be listed as "Zotero Reading Bridge" or "Zotero AI
Bridge"). The library stays read-only; full-text downloads write temporary PDFs.

This Claude Desktop integration attaches no Zotero snapshot to messages, so the shared context rules below require
a fresh `get_current_context` on every message referring to the current paper or selection.

For the file-reading fallback below, use the file-reading tools available in the current Claude session. A local
path returned by Zotero may not be accessible from that session.

<!-- @include shared/instructions/research-workflow.md -->
