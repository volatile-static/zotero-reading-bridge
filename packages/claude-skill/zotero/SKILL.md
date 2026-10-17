---
name: zotero
description: "Use when the user asks about papers, references, citations, notes, annotations, PDFs, collections or tags in their Zotero library, or refers to the paper open or selected in Zotero. Works through the read-only Zotero Reading Bridge tools of the running Zotero desktop app."
---

# Zotero (Claude Desktop)

This skill goes with the Zotero Reading Bridge extension, which connects Claude Desktop to the Zotero Reading Bridge
running inside the user's Zotero desktop app on this computer. Its tools are named `search_items`, `get_items`,
`get_fulltext`, `get_current_context` and so on (the server may be listed as "Zotero Reading Bridge" or "Zotero AI
Bridge"). Everything is read-only.

This Claude Desktop integration attaches no Zotero snapshot to messages, so the shared context rules below require
a fresh `get_current_context` on every message referring to the current paper or selection.

For the file-reading fallback below, use the file-reading tools available in the current Claude session. A local
path returned by Zotero may not be accessible from that session.

<!-- @include shared/instructions/research-workflow.md -->
