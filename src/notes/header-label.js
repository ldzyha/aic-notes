import { parsePropertiesBody } from "../../vendor/aic-editor-core/properties-model.js";

/** Read only managed metadata. Cache the unchanged header across body edits. */
export function createNoteHeaderLabel() {
  let previous = null;
  let label = "";
  const formatter = new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium", timeStyle: "short",
  });
  return (markdown) => {
    const body = /^---[ \t]*(?:\r\n|\n|\r)([\s\S]*?)(?:\r\n|\n|\r)(?:---|\.\.\.)[ \t]*(?:(?:\r\n|\n|\r)|$)/u
      .exec(String(markdown ?? "").slice(0, 65536))?.[1] ?? "";
    if (body === previous) return label;
    previous = body;
    label = "";
    const parsed = parsePropertiesBody(body);
    if (!parsed.ok) return label;
    const updated = parsed.model.sections
      .flatMap((section) => section.fields)
      .find((field) => field.readOnly && field.label === "updated");
    if (!updated || !/^\d{4}-\d{2}-\d{2}(?:T|$)/u.test(updated.value)) return label;
    const date = new Date(updated.value);
    if (!Number.isNaN(date.getTime())) label = formatter.format(date);
    return label;
  };
}
