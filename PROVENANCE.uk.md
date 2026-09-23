# Походження випуску

[English](PROVENANCE.md) · [Українська](PROVENANCE.uk.md)

## Випуск 50.1.0 — вирізання всього блоку

AIC Editor Core 7.1.0 додає clipboard-first **Вирізати** для керованих
preview-блоків. Mirrored core files і VS Code adapters перевіряють exact source
range та stale state; їхні hashes записані у `CORE_SNAPSHOT.json`. Випуск
узгоджено зі Standard Notes AIC 42.1.0 та експериментальним browser 0.7.0.

## Джерела

AIC Notes поєднує локальний VS Code host із канонічним editor core із
`ldzyha/standard-notes-aic`. Перелік shared files визначає `CORE_FILES.json`, а
`CORE_SNAPSHOT.json` фіксує source repository, commit і hashes. Файли у
`vendor/aic-editor-core` не редагують вручну.

Markdown note naming (`file.js` → `file.note.md`, folder → sibling `.note.md`)
походить із локальних модулів AIC, зафіксованих у
[`vendor/markdown/PROVENANCE.md`](vendor/markdown/PROVENANCE.uk.md). VS Code API,
CodeMirror, Mermaid та інші залежності перелічені у package lock і
`THIRD_PARTY_NOTICES.md`.

## Поточний координований випуск

### 50.1.0

Shared core 7.1.0 додає clipboard-first **Вирізати** для всіх керованих
preview-блоків. Standard Notes AIC 42.1.0 і browser 0.7.0 використовують ту саму
поведінку.

### 49.1.2

Linked Note Unpin одразу відновлює follow за active main file. Англійські й українські docs входять до verified VSIX. Standard Notes AIC 41.1.2 і browser 0.6.1 використовують той самий core 7.0.0.

### 49.1.1

Shared core 7.0.0 із Standard Notes AIC 41.1.1. Mermaid має direct source і live
preview, Copy, одну Edit icon та preview-only zoom. Visual builder, DnD і rotate
видалені. VSIX зібраний як universal artifact без native binaries/WASM, перевірений
release gate і SHA-256.

### 48.0.1

Core 6.2.2 додав info/warning/error quote accents, менший quote/italic text,
більші block gaps і editable unfinished code fences.

### 47.0.1

Core 6.2.1 додав Markdown spacing та центрований thematic break 50–100 px.

### 46.1.1

Core 6.2.0 замінив Account preset blank text row, відокремив Password/TOTP,
виправив narrow connected field layout і приховав password generation ≤600 px.

## Артефакт

Release artifact — `aic-notes-VERSION.vsix` і точний `.sha256`. VSIX має містити
manifest, extension/webview bundles, README, changelog, license, provenance,
functional index, core snapshot і third-party notices. Source maps, source tree,
tests, scripts, native binaries й попередні VSIX не входять.

Успішна збірка або GitHub asset не означає автоматичну публікацію у VS Code
Marketplace. Статус розповсюдження описується окремо в двомовній інструкції
релізу.
