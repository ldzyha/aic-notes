import { Annotation } from "@codemirror/state";
import { pageExternalAnnotations } from "../../vendor/aic-editor-core/note-page-cards.js";

/** Marks a transaction that came from the extension host, not from typing. */
export const remote = Annotation.define();

/**
 * Transaction spec for document text the host sends (external file change,
 * reset, acknowledged save). While one page is focused the shared page cards
 * drop every change outside that page unless it is marked as external, so all
 * host text must go through here. Host text is never an undo step.
 */
export function hostChange(changes) {
  return {
    changes,
    annotations: [remote.of(true), ...pageExternalAnnotations()],
  };
}
