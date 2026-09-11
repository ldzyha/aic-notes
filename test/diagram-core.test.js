import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  parseDiagram,
  serializeDiagram,
  moveSequenceMessage,
} from "../vendor/aic-editor-core/diagram-model.js";

const examples = {
  flowchart: `flowchart LR
    initial["Показано каталог"]
    loading["Результат оновлюється"]
    filtered["Показано відповідні товари"]
    initial -->|"Користувач змінив фільтр"| loading
    loading -->|"Отримано товари"| filtered`,
  classDiagram: `classDiagram
    direction LR
    class FilterController {
        +apply()
        +retry()
    }
    class FilterState {
        +boolean availableOnly
    }
    class CatalogSource {
        +load()
    }
    FilterController *-- FilterState : містить
    FilterController ..> CatalogSource : запитує дані`,
  sequenceDiagram: `sequenceDiagram
    actor User as Користувач
    participant Filter as Обробник фільтра
    participant Catalog as Джерело даних каталогу
    User->>Filter: Змінює фільтр доступності
    Filter->>Filter: Оновлює стан фільтра
    Filter->>Catalog: Запитує товари з обмеженням
    alt Успішна відповідь
        Catalog-->>Filter: Товари або порожній список
        Filter-->>User: Показує відповідний результат
    else Помилка
        Catalog-->>Filter: Повідомляє про помилку
        Filter-->>User: Показує помилку та можливість повторення
    end`,
};

for (const [type, source] of Object.entries(examples)) {
  test(`vendored ${type} model retains Core diagram meaning through roundtrip`, () => {
    const parsed = parseDiagram(source);
    assert.equal(parsed.ok, true, parsed.reason);
    assert.equal(parsed.model.type, type);
    const reparsed = parseDiagram(serializeDiagram(parsed.model));
    assert.equal(reparsed.ok, true, reparsed.reason);
    assert.deepEqual(reparsed.model, parsed.model);
  });
}

test("unsupported Mermaid produces no lossy visual model", () => {
  for (const source of [
    "flowchart LR\n A --> B\n style A fill:red\n",
    "flowchart LR\n subgraph Group\n A --> B\n end\n",
    'classDiagram\n A "1" --> "*" B\n',
    "sequenceDiagram\n autonumber\n A->>B: Message\n",
  ]) {
    const parsed = parseDiagram(source);
    assert.equal(parsed.ok, false);
    assert.equal(parsed.model, undefined);
    assert.ok(parsed.reason.length > 0);
    assert.ok(parsed.line > 0);
  }
});

test("entity-map marker and visual layout survive shared serialization", () => {
  const parsed = parseDiagram(
    '%% aic:entity-map\nflowchart LR\n A["System"] --> B["Module"]',
  );
  assert.equal(parsed.ok, true);
  parsed.model.nodes[0].x = 180;
  parsed.model.nodes[0].y = 65;
  const output = serializeDiagram(parsed.model);
  assert.match(output, /%% aic:entity-map/u);
  assert.match(output, /%% aic-builder-layout/u);
  assert.deepEqual(parseDiagram(output).model, parsed.model);
});

test("sequence reorder cannot silently move a message into a different branch", () => {
  const parsed = parseDiagram(examples.sequenceDiagram);
  assert.equal(parsed.ok, true);
  assert.equal(moveSequenceMessage(parsed.model, "E2", -1), true);
  assert.equal(parsed.model.steps[0].edgeId, "E2");
  assert.equal(moveSequenceMessage(parsed.model, "E4", -1), false);
  assert.equal(moveSequenceMessage(parsed.model, "E6", -1), false);
});

test("VS Code Mermaid preview and webview mount the shared visual editor and both styles", async () => {
  const read = (path) =>
    readFile(new URL(`../${path}`, import.meta.url), "utf8");
  const [mermaid, webview, session, builderCss, sessionCss] = await Promise.all(
    [
      read("vendor/markdown/mermaid.js"),
      read("src/webview/main.js"),
      read("vendor/aic-editor-core/diagram-session.js"),
      read("vendor/aic-editor-core/diagram-builder.css"),
      read("vendor/aic-editor-core/diagram-session.css"),
    ],
  );
  assert.match(
    mermaid,
    /import \{[^}]*createDiagramEditButton[^}]*\} from "\.\.\/aic-editor-core\/diagram-session\.js"/u,
  );
  assert.match(mermaid, /new DiagramSourceActionsWidget\(/u);
  assert.match(mermaid, /createDiagramEditButton\(\s*view,\s*\{/u);
  assert.match(
    session,
    /import \{ createDiagramBuilder \} from "\.\/diagram-builder\.js"/u,
  );
  assert.match(session, /controller = createDiagramBuilder\(document, \{/u);
  assert.match(
    webview,
    /import DIAGRAM_BUILDER_CSS from "\.\.\/\.\.\/vendor\/aic-editor-core\/diagram-builder\.css"/u,
  );
  assert.match(
    webview,
    /import DIAGRAM_SESSION_CSS from "\.\.\/\.\.\/vendor\/aic-editor-core\/diagram-session\.css"/u,
  );
  assert.match(
    webview,
    /DIAGRAM_BUILDER_CSS,\s*DIAGRAM_PALETTE_CSS,\s*DIAGRAM_SESSION_CSS,[\s\S]*style\.textContent = css/u,
  );
  assert.match(builderCss, /\.aic-diagram-builder/u);
  assert.match(sessionCss, /\.cm-aic-diagram-inline/u);
  assert.doesNotMatch(
    session,
    /createElement\("dialog"\)|document\.body\.append/u,
  );
  assert.match(mermaid, /from "\.\.\/aic-editor-core\/mermaid-runtime\.js"/u);
});
