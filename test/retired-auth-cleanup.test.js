import test from "node:test";
import assert from "node:assert/strict";
import { removeRetiredAuthData } from "../src/retired-auth-cleanup.js";

const migrationKey = "aicNotes.migrations.standardNotesAuthRemoved.v1";
const secretKey = "aicNotes.snAuth.session.v1";

test("upgrade removes only the known stored login and marks successful cleanup", async () => {
  const calls = [];
  const context = {
    globalState: {
      get: (key, fallback) => {
        calls.push(["get", key, fallback]);
        return false;
      },
      update: async (key, value) => calls.push(["mark", key, value]),
    },
    secrets: { delete: async (key) => calls.push(["delete", key]) },
  };
  await removeRetiredAuthData(context);
  assert.deepEqual(calls, [
    ["get", migrationKey, false],
    ["delete", secretKey],
    ["mark", migrationKey, true],
  ]);
});

test("completed cleanup never touches storage again", async () => {
  const calls = [];
  await removeRetiredAuthData({
    globalState: { get: () => true, update: async () => calls.push("mark") },
    secrets: { delete: async () => calls.push("delete") },
  });
  assert.deepEqual(calls, []);
});

test("SecretStorage failure leaves migration pending but does not block local activation", async () => {
  let marked = false;
  await removeRetiredAuthData({
    globalState: { get: () => false, update: async () => { marked = true; } },
    secrets: { delete: async () => { throw new Error("synthetic storage failure"); } },
  });
  assert.equal(marked, false);
});

test("unavailable migration state also leaves local editing unblocked", async () => {
  let deleted = false;
  await removeRetiredAuthData({
    globalState: { get: () => { throw new Error("synthetic state failure"); } },
    secrets: { delete: async () => { deleted = true; } },
  });
  assert.equal(deleted, false);
});
