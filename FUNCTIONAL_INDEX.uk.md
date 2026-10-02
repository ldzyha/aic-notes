# Функціональний індекс AIC Notes

[English](FUNCTIONAL_INDEX.md) · [Українська](FUNCTIONAL_INDEX.uk.md)

Це українська карта функцій VS Code extension. Повна машинно перевірена деталізація
модулів і тестів міститься у [`FUNCTIONAL_INDEX.md`](FUNCTIONAL_INDEX.md).

## Підготовлений контракт Mermaid — core 7.5.2

Полотно має 100% ширини, діаграма центрована у природному розмірі й за потреби
пропорційно зменшується. Довгі підписи flowchart переносяться в обмежених вузлах;
висота відповідає всьому вмісту без внутрішніх скролів чи кнопок масштабу.
Спостереження за геометрією уникає повторної роботи; Mermaid завантажується лише
за потреби. У VS Code зміна теми оновлює кольори в обох редакторах без повторного
відкриття. Перевірки: `mermaid-viewport`, `mermaid`, `diagram-core`, `mermaid-theme`.

## Межа продукту

AIC Notes — локальний VS Code Markdown editor без Standard Notes account,
synchronization, polling, upload чи remote conflict model. Shared editor core
надходить із `standard-notes-aic/src/core` через sync script і byte-verified
snapshot. VS Code host володіє TextDocument, save/undo, URI navigation, clipboard
та webview lifecycle.

`src/extension.js` збирається для desktop і браузерного worker у
`dist/extension.cjs` та `dist/extension-browser.cjs`. Браузерна збірка має один
файл і лише зовнішню залежність `vscode`; `src/host-runtime.js` використовує
WebCrypto та UTF-8 без Node globals. Асинхронний digest інструкцій зберігає той
самий формат маркера агента.

`src/notes/resources.js` перевіряє межі workspace, authority та ревізію
віртуального URI; `src/notes/uri-path.js` обробляє URI-шляхи. Читання належить
`workspace.fs`, редагування та Save/Undo — TextDocument VS Code. Провайдери лише
для читання показують документи, але не дозволяють запис, створення/видалення
нотаток чи інструкцій. Невідомі віртуальні провайдери також не отримують запис.
Нотатки desktop залишаються сумісними; синхронізація та доступ до репозиторію
належать обраному користувачем провайдеру. Меню використовує файловий контекст
VS Code, slash-команди доступні в Markdown різних схем.

`test/web-host.test.js` запускає справжню браузерну збірку без Node globals і
перевіряє віртуальні Markdown, пов’язані нотатки, інструкції та шифротекст;
`test/web-resources.test.js` — межі URI, POSIX-шляхи, UTF-8 та WebCrypto.
Пакування і перевірка архіву вимагають браузерний entry та точний зібраний файл.

Випуск AIC Notes 58.1.1 використовує спільне ядро 7.5.1. Головний редактор і Linked Note використовують
однаковий спільний контракт.

Коментарі до пов’язаного коду лишаються всередині свого акордеона з компактним
заголовком і читабельною вкладеністю. Незбережені зміни не змінюють фон редактора;
кнопка Save пульсує до збереження. За налаштування reduced motion індикатор
статичний, а стан збереження й далі залежить від підтвердження хоста.

Порожні редаговані секретні частини (`*|`) показують **Generate password** на
будь-якій ширині панелі незалежно від назви. Параметри переносяться на вузьких
екранах. Генерація працює локально, не перезаписує заповнені значення й недоступна
в режимі читання.

Кнопка копіювання ненадовго показує галочку після успіху або хрестик після
помилки, зберігає доступну назву дії та повідомляє стан для читача екрана.
Більші заголовки секцій, окремий нейтральний фон груп і
легке чергування сірих рядків допомагають швидше знаходити записи.

Назви, email та логіни займають природну ширину. Спочатку ціле значення
переходить на наступний рядок; текст переноситься всередині лише тоді, коли
не вміщується на повній доступній ширині. Пароль має компактну кнопку копіювання
із замком, а короткі дані картки й TOTP-коди залишаються читабельними. Меню `+`
йде після останнього значення, записи розділяють легкі лінії. Сенсорні кнопки
зберігають область натискання 44 px.

Після виходу з редагування джерела AIC-блоку або перемикання всієї нотатки з
джерела у прев’ю рядки кожної секції сортуються за назвою: без урахування регістру
та з природним порядком чисел. Рядки без назви зберігають свій порядок наприкінці.
Порядок секцій, порядок значень і точний текст значень не змінюються. Відкриття
прев’ю, копіювання й ручне переставлення не запускають сортування.

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
creation для порожніх полів на будь-якій ширині з адаптивними параметрами, recovery
codes, section copy, Authenticator
JSON conversion, source/preview, slash templates, details, task controls,
parser-backed links і Mermaid.

Mermaid — source + live preview з Copy, Edit і Cut. Полотно займає всю ширину; діаграма зберігає природний розмір, зменшується лише для вузького редактора й займає всю потрібну висоту без внутрішніх скролів.
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

## Звичайні Markdown-файли

Основний редактор і Linked Note використовують файлового провайдера та рідні
TextDocument Save/Undo у VS Code desktop і Web. Немає пароля застосунку,
зашифрованого простору чи редактора/імпорту `.aicnotes`. Оновлення або видалення
розширення не змінює наявні файли. Маскування секретів і генерація паролів —
функції редактора; Markdown зберігається на диску відкритим текстом.

## Доставка оновлень розширень

Перед публікацією перевіряються точні архіви релізу й контрольні суми.
Спільне ядро надходить до VS Code через PR; знімок ядра
фіксує коміт джерела й хеш кожного файла. Локальні збірки з робочого
дерева дозволено, а підтвердження релізу потребує закоміченого джерела.
Для активації потрібні сторінки магазинів, облікові дані та змінні ввімкнення;
інструкції наведено в [оновленнях розширень](../standard-notes-aic/pwa/EXTENSION_UPDATES.uk.md).

## Окремі вкладки нотаток

**Current**, **Shared** і **Global** показують лише одну область нотаток.
Перемикання очікує збереження поточної чернетки; помилка залишає її відкритою.
Спільний компонент підтримує стрілки, Home/End і Enter/Space та виключає
приховані панелі з фокуса й читання допоміжними технологіями. Спільний текст
не копіюється автоматично в поточну нотатку.

У браузері Current належить точній URL-адресі, Shared — її origin, Global —
профілю браузера. У VS Code Current зберігає початковий файл, Shared відкриває
найближчу наявну нотатку папки, Global — наявну нотатку проєкту. Власником
документа та скасування лишається VS Code; перехід використовує його редактор.
Відсутні нотатки недоступні, вибір вкладки не створює файлів.

PWA показує імпортовані Markdown-файли як папки. Для `app/src/page.md` Shared
знаходить `app/src.note.md` або найближчу наявну нотатку батьківської папки,
а Global — `app/app.note.md`, за домовленістю VS Code. Для окремих файлів без
визначеної папки проєкту Global недоступний. Назва простору не визначає
ідентичність нотатки. Браузерні набори використовують наявні
записи URL, origin і Global, зокрема Shared без сторінки та Global без нотаток
сторінок. Редактори зберігають окрему історію скасування до закриття або зміни
поточного контексту.

PWA зберігає зміни у явно підключені оригінали Markdown. Копії з кешу лишаються
доступними лише для читання до вибору файла для запису. Синхронізацією керує
користувач через обрану файлову систему чи папку синхронізації.
