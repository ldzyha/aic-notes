# AIC shared functionality and design

The canonical design/functional rules are in
`../standard-notes-aic/AGENTS.md`; its `FEATURES.json`, `COMPONENTS.json` and
`UI_ARCHITECTURE.md` define ownership and the BEM migration. Read those before
changing shared UI or editor behavior.

- Keep VS Code storage, TextDocument revision/undo ownership, URI navigation and
  theme mapping here. Reuse the canonical shared primitives for editor components.
- Do not hand-edit `vendor/aic-editor-core`. Change `src/core` in the canonical
  repository, update `CORE_FILES.json` if necessary, then synchronize and verify
  byte parity with `CORE_SNAPSHOT.json`.
- New shared visual variants use the registered BEM modifier and semantic token,
  not copied host-specific component CSS. Preserve legacy behavior hooks until
  their registered migration and regression tests are complete.
- Test both primary and linked-note webviews, light/dark themes and the canonical
  editor after a shared UI change. Do not infer installation/publication from a
  successful local build.

Documentation follows `DOCUMENTATION.md`: state simple answers directly, and keep
a question heading only when it helps explain a more complex answer. Choose the
smallest format that preserves the answer and its material conditions.
