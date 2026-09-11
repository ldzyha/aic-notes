import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import {
  mkdtemp,
  mkdir,
  readdir,
  realpath,
  rm,
  rmdir,
  stat,
  utimes,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import lockfile from "proper-lockfile";
import { createAuthOperationLock } from "../src/auth/operation-lock.js";

async function temporary(t) {
  const root = await mkdtemp(path.join(tmpdir(), "aic-auth-lease-"));
  assert.equal(path.dirname(root), path.resolve(tmpdir()));
  const releases = [];
  t.after(async () => {
    await Promise.allSettled(releases.map((release) => release()));
    // root comes directly from mkdtemp and was checked against the temp parent.
    await rm(root, { recursive: true, force: true });
  });
  return {
    root,
    retain(release) {
      releases.push(release);
      return release;
    },
  };
}

test("two auth lock instances exclude one another and write only an empty lock directory", async (t) => {
  const temp = await temporary(t);
  const directory = path.join(temp.root, "global-storage", "extension");
  const first = createAuthOperationLock(directory);
  const second = createAuthOperationLock(directory);
  const release = temp.retain(await first());
  await assert.rejects(second(), { code: "account_busy" });
  assert.deepEqual(await readdir(directory), ["sn-auth-operation.lock"]);
  assert.equal(
    (await stat(path.join(directory, "sn-auth-operation.lock"))).isDirectory(),
    true,
  );
  assert.deepEqual(
    await readdir(path.join(directory, "sn-auth-operation.lock")),
    [],
  );
  await Promise.all([release(), release()]);
  assert.deepEqual(await readdir(directory), []);
  const nextRelease = temp.retain(await second());
  await nextRelease();
});

test("auth exclusion also holds in a separate Node process", async (t) => {
  const temp = await temporary(t);
  const acquire = createAuthOperationLock(temp.root);
  const release = temp.retain(await acquire());
  const moduleUrl = new URL("../src/auth/operation-lock.js", import.meta.url)
    .href;
  const script = `
    const { createAuthOperationLock } = await import(process.argv[1]);
    try {
      const release = await createAuthOperationLock(process.argv[2])();
      await release();
      process.stdout.write("acquired");
    } catch (error) {
      process.stdout.write(error.code);
    }
  `;
  const run = () =>
    promisify(execFile)(
      process.execPath,
      ["--input-type=module", "-e", script, moduleUrl, temp.root],
      { timeout: 10000 },
    );
  assert.equal((await run()).stdout, "account_busy");
  await release();
  assert.equal((await run()).stdout, "acquired");
});

test("a stale abandoned directory can be reclaimed without any token file", async (t) => {
  const temp = await temporary(t);
  const lockDirectory = path.join(temp.root, "sn-auth-operation.lock");
  await mkdir(lockDirectory);
  const abandoned = new Date(Date.now() - 120000);
  await utimes(lockDirectory, abandoned, abandoned);
  const release = temp.retain(await createAuthOperationLock(temp.root)());
  assert.deepEqual(await readdir(lockDirectory), []);
  await release();
});

test("coordination failures are normalized without exposing filesystem paths", async (t) => {
  const temp = await temporary(t);
  await assert.rejects(createAuthOperationLock(undefined)(), {
    code: "account_coordination_unavailable",
  });
  const invalid = path.join(temp.root, "invalid\0directory");
  await assert.rejects(createAuthOperationLock(invalid)(), (error) => {
    assert.equal(error.code, "account_coordination_unavailable");
    assert.equal(error.message, "account_coordination_unavailable");
    return true;
  });
  const release = temp.retain(await createAuthOperationLock(temp.root)());
  await mkdir(
    path.join(temp.root, "sn-auth-operation.lock", "unexpected-directory"),
  );
  await assert.rejects(release(), { code: "account_coordination_unavailable" });
});

test("a compromised lease notifies the host and cannot release a subsequent owner's lock", async (t) => {
  const temp = await temporary(t);
  const originalLock = lockfile.lock;
  t.mock.method(lockfile, "lock", (target, options) => {
    assert.equal(options.realpath, true);
    assert.equal(options.stale, 60000);
    assert.equal(options.update, 10000);
    assert.equal(options.retries, 0);
    assert.equal(
      options.lockfilePath,
      path.join(target, "sn-auth-operation.lock"),
    );
    // Exercise the real heartbeat failure without waiting the production 10s.
    return originalLock(target, { ...options, update: 1000 });
  });
  let notify;
  const compromised = new Promise((resolve) => {
    notify = resolve;
  });
  const acquire = createAuthOperationLock(temp.root);
  const lostRelease = temp.retain(
    await acquire((error) => {
      notify(error);
      return Promise.reject(new Error("Simulated rejected host callback"));
    }),
  );
  const canonical = await realpath(temp.root);
  await rmdir(path.join(canonical, "sn-auth-operation.lock"));
  let timer;
  const timeout = new Promise((resolve, reject) => {
    timer = setTimeout(
      () => reject(new Error("Compromise callback did not run")),
      8000,
    );
  });
  const error = await Promise.race([compromised, timeout]).finally(() =>
    clearTimeout(timer),
  );
  assert.equal(error.code, "account_coordination_unavailable");
  const nextRelease = temp.retain(await acquire());
  await lostRelease();
  await assert.rejects(acquire(), { code: "account_busy" });
  await nextRelease();
});
