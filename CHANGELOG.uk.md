# Журнал змін AIC Notes

[English](CHANGELOG.md) · [Українська](CHANGELOG.uk.md)

Українська версія ведеться для поточних і майбутніх випусків. Повний ранній
історичний журнал є у [`CHANGELOG.md`](CHANGELOG.md).

## Не випущено

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
