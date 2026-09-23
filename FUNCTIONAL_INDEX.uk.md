# Функціональний індекс AIC Notes

[English](FUNCTIONAL_INDEX.md) · [Українська](FUNCTIONAL_INDEX.uk.md)

Це українська карта функцій VS Code extension. Повна машинно перевірена деталізація
модулів і тестів міститься у [`FUNCTIONAL_INDEX.md`](FUNCTIONAL_INDEX.md).

## Межа продукту

AIC Notes — локальний VS Code Markdown editor без Standard Notes account,
synchronization, polling, upload чи remote conflict model. Shared editor core
надходить із `standard-notes-aic/src/core` через sync script і byte-verified
snapshot. VS Code host володіє TextDocument, save/undo, URI navigation, clipboard
та webview lifecycle.

Поточний випуск 50.1.0 використовує shared core 7.1.0. Таблиці, code
fences, Mermaid, AIC/Properties і details мають одну кнопку **Вирізати** з
іконкою ножиць. Вона копіює повний Markdown-блок перед видаленням його exact
source range як однієї operation. Помилка clipboard, застарілий source або
read-only режим залишають документ без змін.

## Поточні контракти

- усі `*.md`, включно з `*.note.md`, можуть відкриватися в AIC Markdown;
- linked notes показуються в Secondary Side Bar;
- один edit owner не дозволяє двом surfaces одночасно змінювати одну нотатку;
- dirty draft не втрачається під час follow/navigation;
- Save, Ctrl/Cmd+S і focus leave використовують один persistence manager;
- placeholder не створює файл до першої зміни;
- Trash revalidates identity/revision/lease після async work.

## Linked Note

`file.js` відповідає `file.note.md`, folder `src` — `src.note.md`, workspace —
`workspace.note.md`. Незакріплена панель слідує за активним main resource.
Активна note показує найближчу наявну parent folder note, далі project note або
project placeholder. Pin фіксує note; Unpin має негайно відновити follow без
window reload. Explorer clicks, Open Source і source navigation не перезаписують
чернетки.

## Shared editor

Типізовані AIC values: `|`, `*|`, `#|`, `_|`, `1|`, `0|`. Blank/Card/One-time
є presets. Підтримуються field copy/paste, one-time transitions, password
creation на екранах ширше 600 px, recovery codes, section copy, Authenticator
JSON conversion, source/preview, slash templates, details, task controls,
parser-backed links і Mermaid.

Mermaid — source + live preview з Copy, однією Edit icon та preview-only zoom.
Builder, drag-and-drop і rotate відсутні. Quotes: `>`, `!>`, `!>>`; details:
`>>> … <<<`.

## Surfaces

| Surface         | Власник документа               | Збереження              |
| --------------- | ------------------------------- | ----------------------- |
| Main AIC editor | VS Code TextDocument            | VS Code save lifecycle  |
| Linked Note     | Secondary provider + edit lease | correlated commit/ack   |
| Native Markdown | VS Code                         | нативне Save            |
| Shared previews | canonical core                  | mutation intent до host |

## Commands

Open Linked Note, Link Selection to Note, Open Note in Secondary Side Bar, Open
Project Note, Open Source, Enable Explorer Nesting, Use Native Editor, Enable
AIC Agent Workflow і Sync Agent Instructions. Команди не створюють account або
network integration.

## Перевірка

Release gate перевіряє core snapshot, tests, production bundle, universal VSIX,
SHA-256 та archive contents. Обов’язкові regressions: main + linked surface,
clean/dirty ownership, navigation races, save failures, light/dark, narrow layout,
keyboard, clipboard identity і disposal. Локальний VSIX не є Marketplace release.
