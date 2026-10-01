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

Випуск 55.1.0 на спільному ядрі 7.4.0 узгоджено зі Standard Notes AIC 47.1.0
і розширенням браузера 0.9.2. Головний редактор і Linked Note використовують
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

## Спільні зашифровані файли

Редактор `.aicnotes` використовує канонічний інтерфейс переносних нотаток і
обмінюється лише шифротекстом із власним TextDocument у VS Code. Застарілі записи
відхиляються; зовнішні зміни потребують явного повторного відкриття. Файли можна
зберігати в папках синхронізації користувача. Зібраний інтерфейс і знімок його
джерела та хешів поширюються процесом оновлення канонічного репозиторію.
Звичайний Markdown залишається під керуванням наявного провайдера.

## Доставка оновлень розширень

Перед публікацією перевіряються точні архіви релізу й контрольні суми.
Спільне ядро та портативний інтерфейс надходять до VS Code через PR; окремі
знімки фіксують коміт джерела й хеш кожного файла. Локальні збірки з робочого
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
ідентичність нотатки чи шифрування. Браузерні набори використовують наявні
записи URL, origin і Global, зокрема Shared без сторінки та Global без нотаток
сторінок. Редактори зберігають окрему історію скасування до закриття або зміни
поточного контексту.

Збереження PWA оновлює локальний простір або явно підключений зашифрований
файл. Імпорт папки не надає запису у вихідні файли чи фонової синхронізації;
експортуйте копії у власну папку синхронізації.
