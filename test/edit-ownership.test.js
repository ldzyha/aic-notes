import test from "node:test";
import assert from "node:assert/strict";
import { NoteEditOwnership } from "../src/notes/edit-ownership.js";

function surface(host, name) {
  const state = {
    text: "base",
    dirty: false,
    snapshot: null,
    notifications: [],
  };
  const entry = host.register({
    uri: () => ({ toString: () => "file:///note.md" }),
    dirty: () => state.dirty,
    text: () => state.text,
    probe: async () =>
      state.snapshot ?? { text: state.text, dirty: state.dirty },
    notify: (value) => state.notifications.push(value),
    name,
  });
  return { entry, state };
}

test("same-note surfaces share one edit owner; epochs reject queued old-owner edits", async () => {
  const host = new NoteEditOwnership();
  const main = surface(host, "main");
  const sidebar = surface(host, "sidebar");
  assert.equal(await host.activate(main.entry), true);
  const oldLease = host.state(main.entry).lease;
  assert.equal(host.accepts(main.entry, oldLease), true);
  assert.equal(await host.activate(sidebar.entry), true);
  assert.equal(host.state(main.entry).readOnly, true);
  assert.equal(host.accepts(main.entry, oldLease), false);
  assert.equal(await host.activate(main.entry), true);
  assert.equal(host.accepts(main.entry, oldLease), false);
  assert.equal(host.accepts(main.entry, host.state(main.entry).lease), true);
});

for (const initial of ["main", "sidebar"]) {
  test(`${initial} dirty lease is retained and the other surface unlocks after an explicit save`, async () => {
    const host = new NoteEditOwnership();
    const owner = surface(host, initial);
    const waiting = surface(host, initial === "main" ? "sidebar" : "main");
    await host.activate(owner.entry);
    owner.state.dirty = true;
    assert.equal(await host.activate(waiting.entry), false);
    assert.equal(host.state(waiting.entry).readOnly, true);
    owner.state.dirty = false;
    assert.equal(await host.changed(owner.entry), true);
    assert.equal(host.state(waiting.entry).readOnly, false);
    assert.equal(host.state(owner.entry).readOnly, true);
  });
}

test("snapshot barrier refuses optimistic edits not yet applied to the TextDocument", async () => {
  const host = new NoteEditOwnership();
  const main = surface(host, "main");
  const sidebar = surface(host, "sidebar");
  await host.activate(main.entry);
  main.state.snapshot = { text: "base plus in-flight typing", dirty: false };
  assert.equal(await host.activate(sidebar.entry), false);
  assert.equal(host.state(main.entry).readOnly, false);
  assert.equal(host.state(sidebar.entry).readOnly, true);
});

test("a disconnected or timed-out client does not silently lose its ownership", async () => {
  const host = new NoteEditOwnership();
  const main = surface(host, "main");
  const sidebar = surface(host, "sidebar");
  await host.activate(main.entry);
  main.entry.probe = async () => null;
  assert.equal(await host.activate(sidebar.entry), false);
  assert.equal(host.state(main.entry).readOnly, false);
});

test("a surface changing note while a transfer waits cannot acquire the wrong note", async () => {
  const host = new NoteEditOwnership();
  const main = surface(host, "main");
  const sidebar = surface(host, "sidebar");
  await host.activate(main.entry);
  main.entry.probe = async () => {
    sidebar.entry.uri = () => ({ toString: () => "file:///other.note.md" });
    return { text: "base", dirty: false };
  };
  assert.equal(await host.activate(sidebar.entry), false);
  assert.equal(host.state(main.entry).readOnly, false);
});
