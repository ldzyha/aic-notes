# AIC Notes

[English](README.md) · [Українська](README.uk.md)

AIC Notes — локальний Markdown-редактор для VS Code/code-server. Він відкриває
кожний `*.md`, включно з `*.note.md`, у preview-first редакторі AIC і показує
пов’язані нотатки в Secondary Side Bar. Розширення не має входу в Standard Notes,
запитів облікового запису, синхронізації, polling, upload, remote delete чи
remote conflicts. За потреби переносьте блоки вручну через Copy/Paste.

Поточний випуск **49.1.2** виправляє Unpin у Linked Note: панель одразу
повертається до активного main file без window reload. Документація продукту й
випуску доступна англійською та українською.

Поточна development-версія на shared core 7.1.0 додає спільну кнопку
**Вирізати** для таблиць, code fences, Mermaid, AIC/Properties і details. Вона
спочатку копіює весь Markdown-блок, а потім видаляє його однією operation;
помилка clipboard лишає source без змін.

Єдина двомовна інструкція для VS Code, Standard Notes і браузера:
[`RELEASE_INSTALL.md`](https://github.com/ldzyha/standard-notes-aic/blob/v41.1.2/RELEASE_INSTALL.md).

## AIC-поля і режим джерела

Головний редактор і Linked Note використовують той самий обмежений `aic` parser,
що й Standard Notes. Кожний розділювач задає тип наступного значення:

- `|` — текст;
- `*|` — секрет;
- `#|` — authenticator seed;
- `_|` — картка;
- `1|` — невикористане одноразове значення;
- `0|` — використане одноразове значення.

Назва перед першим розділювачем необов’язкова, а один рядок може поєднувати
кілька типів:

```aic
# Обліковий запис
Login | person@example.test
Password *| synthetic-secret
Card _| 4111111111111111 | 12/30 *| 123
Recovery codes 1| code-one 0| already-used
```

Blank, Card і One-time codes — шаблони цих частин, а не окремі формати. Field
додає типізовану частину до поточного рядка, Row — рядок нижче, Section — секцію
після поточної. Копіювання `1|` переводить код у `0|`; натискання використаного
значення повертає `1|` без копіювання.

Одна іконка **Show Markdown source / Show preview** перемикає прев’ю на місці,
не змінюючи джерело, Undo, dirty state чи правила збереження. Сирий Markdown
може відкрити візуально масковані значення. Локальна довідка **?** працює без
мережі, нотатки та сховища.

Застарілі YAML Properties, colon fields і попередні Security formats лишаються
точним Markdown для ручного виправлення. Вони не мігрують автоматично й не
отримують часові мітки.

## Дії з полями безпеки

### Authenticator JSON

Відкрийте початковий JSON-масив або виділіть його повністю. Для валідних записів
із `service`, `account`, `secret` з’явиться **Convert and save security blocks**.
Перетворення створює один або кілька блоків `aic` із незалежними секціями:
Service/Account/Notes видимі, TOTP/Password та додаткові рядкові поля приховані.
Безпечна адреса сервісу отримує окреме URL-поле. Переповнення переходить у новий
блок без втрати даних.

Операція є однією undoable зміною і зберігається через того самого VS Code
менеджера. Вона не сканує обліковий запис, не читає буфер, не змінює типи нотаток
і не синхронізує дані. Некоректний запис, дублікат ключа чи непідтримуване
значення відхиляє весь масив. Межі: 256 записів і 1 МіБ UTF-8.

### Copy, Paste і password generation

Натисніть label, щоб скопіювати його, або value, щоб скопіювати значення.
Порожнє поле має Paste і Delete; заповнене — ні. Replace відсутній. Значення
редагується через Edit у Markdown source. Whole-block Copy лишається в заголовку.

Paste читає останній текст через нативний VS Code Clipboard API лише після
натискання. Історії, моніторингу й проміжного діалогу немає. Відмова або timeout
показує масковане поле лише для вставлення. Порожній буфер нічого не змінює.

Порожнє парольне поле показує **Generate password** лише на viewport ширше
600 px. Типово: 24 символи; діапазон 8–128, великі/малі літери, цифри й символи.
Web Crypto працює локально, не перезаписує, не показує і не копіює значення
автоматично. TOTP/API keys не є цілями генератора.

## Mermaid і Markdown

Mermaid редагується як Markdown-код із живим прев’ю. У прев’ю є Copy, одна
іконка Edit та zoom. Візуальний builder, drag-and-drop і rotate прибрані.

`>` — інформаційна цитата, `!>` — warning, `!>>` — error, а `>>> … <<<` —
details/accordion. Цитати мають легкий фон і боковий акцент; цитований та italic
текст менші. Горизонтальна лінія центрована, має ширину 50–100 px і вертикальні
відступи. Незавершений три-backtick fence лишається редагованим, а готовий блок
показує прев’ю після виходу курсора.

## Встановлення

Завантажте `aic-notes-49.1.2.vsix` зі
[сторінки випуску](https://github.com/ldzyha/aic-notes/releases/tag/v49.1.2).
У VS Code виконайте **Extensions: Install from VSIX…** і перезавантажте вікно.
Для code-server:

```bash
code-server --install-extension ./aic-notes-49.1.2.vsix --force
```

AIC Notes локальний і не потребує облікового запису Standard Notes.

## Модель пов’язаних нотаток

Для `file.js` використовується `file.note.md`; для папки `src/components` —
`src/components.note.md`; для workspace — `workspace.note.md`. Новий
placeholder не створює файл до першої зміни. Explorer-команди можуть відкрити
нотатки, а **Open Source** окремо повертає до джерела.

Незакріплений Linked Note слідує за активним головним файлом. Для активної
`*.note.md` панель показує найближчу наявну батьківську нотатку папки, далі
project note або project placeholder. Pin фіксує поточну нотатку; після Unpin
панель знову має слідувати за поточним головним файлом без reload. Незбережена
чернетка не втрачається під час навігації.

## Збереження й видалення

Save, Ctrl/Cmd+S і вихід із поверхні використовують один менеджер persistence.
Security preview actions запитують негайне збереження. Лише підтверджений запис
прибирає dirty state. Помилка лишає чернетку для retry.

Trash перевіряє identity, revision і edit ownership після асинхронної роботи.
Видалення переносить файл у локальний VS Code Trash, якщо це підтримується.
Відновлення залежить від системного кошика або вашої резервної копії.

## Команди

- **Open Linked Note** — відкрити пов’язану нотатку для файла чи Explorer item.
- **Open Note in Secondary Side Bar** — показати вибрану нотатку збоку.
- **Open Project Note** — відкрити нотатку workspace.
- **Open Source** — перейти від sidecar note до джерела.
- **Link Selection to Note** — додати пов’язаний код до живої чернетки.
- **Enable Explorer Nesting for Notes** — увімкнути відображення sidecar-файлів.
- **Use Native Editor for Plain Markdown** — повернути нативний VS Code editor.
- **Enable/Sync AIC Agent Workflow** — необов’язкові локальні інструкції для
  agent workflow.

## Розробка та випуск

```bash
npm ci
npm test
npm run release:gate
```

Release gate звіряє канонічне shared core, запускає тести, збирає universal VSIX,
створює SHA-256 і перевіряє вміст архіву. Успішна локальна збірка не означає
публікацію в Marketplace. Поточний канал — GitHub Releases.

AIC для Standard Notes — окремий продукт зі спільним ядром. Передавання контенту
між застосунками ручне; інтеграції облікового запису або синхронізації немає.
