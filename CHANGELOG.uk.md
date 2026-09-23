# Журнал змін AIC Notes

[English](CHANGELOG.md) · [Українська](CHANGELOG.uk.md)

Українська версія ведеться для поточних і майбутніх випусків. Повний ранній
історичний журнал є у [`CHANGELOG.md`](CHANGELOG.md).

## Не випущено

## 51.1.0 — 2026-09-23

Послідовність випуску 51 · 1 нова можливість · 0 виправлених помилок. Випуск
узгоджено зі Standard Notes AIC 43.1.0, експериментальним browser 0.8.0 і shared
core 7.2.0.

### Можливість

- Щільні AIC credential rows стали читабельними на mobile і у вузьких sidebars.
  Label займає лише bounded text width, protected value має компактну
  lock-and-six-dot copy target, flexible values ділять решту ширини, а одне
  trailing-меню `+` містить Field/Row/Section. Записи розділяють легкі лінії без
  строкатого чергування фону. Shared core — 7.2.0.

## 50.1.0 — 2026-09-23

Послідовність випуску 50 · 1 нова можливість · 0 виправлених помилок. Випуск
узгоджено зі Standard Notes AIC 42.1.0, експериментальним browser 0.7.0 і shared
core 7.1.0.

### Можливість

- Таблиці, code fences, Mermaid, AIC/Properties і details отримали спільну
  кнопку **Вирізати** з іконкою ножиць. Вона копіює повний Markdown-блок перед
  видаленням точного source range як однієї operation. Невдалий або застарілий
  clipboard request лишає документ без змін; у read-only кнопки немає. Shared
  core — 7.1.0.

## 49.1.2 — 2026-09-23

- Unpin у Linked Note негайно повертає слідування за активним main file однією
  navigation operation без перезавантаження вікна.
- README, functional index, release provenance, vendored Markdown provenance і
  changelog доступні англійською та українською.
- Локалізовані документи входять до перевіреного universal VSIX.

## 49.1.1 — 2026-09-22

- Mermaid спрощено до source і live preview.
- Preview має Copy, одну shared Edit icon та zoom; builder, DnD і rotate видалені.
- Shared core 7.0.0 узгоджено зі Standard Notes AIC 41.1.1 і browser 0.6.0.

## 48.0.1 — 2026-09-22

- Додано info (`>`), warning (`!>`) та error (`!>>`) quote styles.
- Quote/italic менші, block spacing більший.
- Незавершений code fence лишається source до завершення/focus out.

## 47.0.1 — 2026-09-22

- Виправлено відступи headings/quotes/lists.
- Thematic break центрований, 50–100 px, з вертикальним простором.

## 46.1.1 — 2026-09-22

- Account preset замінено blank text row; Password/TOTP окремі.
- Narrow fields переносять label і values разом.
- Password generation приховано на viewport ≤600 px.

## 45.1.0 — 2026-09-15

- Copy section працює в main і Linked Note та не змінює source.
- Browser Global Shared лишається окремою browser-only можливістю.

## Раніші випуски

Версії 0.1.x–44.4.7, security fixes, ownership migrations і детальні regression
records збережені в [англійському журналі](CHANGELOG.md). Нові entries додаються
обома мовами.
