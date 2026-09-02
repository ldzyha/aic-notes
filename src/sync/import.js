import { parseFrontmatter } from "../notes/frontmatter.js";
import { notePathFor, folderNotePathFor } from "../notes/paths.js";

const UNSAFE_SEGMENT = /[<>:"/\\|?*\u0000-\u001f]/u;

function safeSegment(value) {
  const segment = String(value ?? "").trim();
  if (
    !segment ||
    segment === "." ||
    segment === ".." ||
    UNSAFE_SEGMENT.test(segment)
  )
    return null;
  return segment;
}

function joinedPath(parent, name) {
  return parent ? `${parent}/${name}` : name;
}

// Convert a bridge result into one exact local Markdown path. Canonical AIC
// sidecars retain their frontmatter-based target mapping. Project-tagged
// Standard Notes whose title is an exact Markdown filename map directly to a
// regular document (or a free-standing *.note.md note). Everything else fails
// closed, so an arbitrary tagged note can never become a source-tree file.
export function remoteNoteTarget(remote, workspaceName) {
  const project = safeSegment(workspaceName);
  const tagPath = Array.isArray(remote?.tagPath)
    ? remote.tagPath.map(safeSegment)
    : [];
  if (!project || tagPath.some((segment) => !segment) || tagPath[0] !== project)
    return null;
  const { meta } = parseFrontmatter(String(remote?.localContent ?? ""));
  const level = String(meta.level ?? "");
  const title = safeSegment(meta.title);

  if (level === "project-note") {
    if (!title || title !== safeSegment(remote?.title) || title !== project || tagPath.length !== 1)
      return null;
    return {
      level,
      notePath: `${project}.note.md`,
      targetPath: "",
      targetKind: "directory",
    };
  }

  const parent = tagPath.slice(1).join("/");
  const targetPath = parent ? `${parent}/${title}` : title;
  if (level === "folder-note") {
    if (!title || title !== safeSegment(remote?.title)) return null;
    return {
      level,
      notePath: folderNotePathFor(targetPath),
      targetPath,
      targetKind: "directory",
    };
  }
  if (level === "file-note") {
    if (!title || title !== safeSegment(remote?.title)) return null;
    return {
      level,
      notePath: notePathFor(targetPath),
      targetPath,
      targetKind: "file",
    };
  }

  const filename = safeSegment(remote?.title);
  if (!filename || !filename.toLowerCase().endsWith(".md")) return null;
  const localPath = joinedPath(parent, filename);
  if (filename.toLowerCase().endsWith(".note.md")) {
    return {
      level: "note",
      notePath: localPath,
      targetPath: null,
      targetKind: null,
    };
  }
  return {
    level: "document",
    notePath: localPath,
    targetPath: localPath,
    targetKind: "file",
  };
}

export function importCandidates(notes, workspaceName) {
  const candidates = [];
  for (const remote of Array.isArray(notes) ? notes : []) {
    const target = remoteNoteTarget(remote, workspaceName);
    if (!target?.notePath || !remote?.remoteUuid) continue;
    const candidate = { remote, ...target };
    candidates.push(candidate);
  }
  const byPath = new Map();
  for (const candidate of candidates) {
    const group = byPath.get(candidate.notePath) ?? [];
    group.push(candidate);
    byPath.set(candidate.notePath, group);
  }
  const result = [];
  for (const group of byPath.values()) {
    if (group.length === 1) {
      result.push(group[0]);
      continue;
    }
    const [first] = group;
    const equivalent = group.every(
      (candidate) =>
        candidate.level === first.level &&
        candidate.targetPath === first.targetPath &&
        candidate.targetKind === first.targetKind &&
        candidate.remote.title === first.remote.title &&
        candidate.remote.localContent === first.remote.localContent,
    );
    if (equivalent) {
      result.push(
        [...group].sort((left, right) =>
          left.remote.remoteUuid.localeCompare(right.remote.remoteUuid),
        )[0],
      );
    }
  }
  return result;
}
