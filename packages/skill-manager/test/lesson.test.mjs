import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { lesson, lessonPaths } from "../tasks/language/practice/scripts/lesson.mjs";

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), "pi-language-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const paths = lessonPaths({ cwd: join(root, "project with spaces"), agentDir: join(root, "agent") });
  return {
    paths,
    run: (command, options = {}) => lesson(command, { paths, now: Date.parse("2026-11-09T10:00:00Z"), ...options }),
    async file(path, text) { await mkdir(dirname(path), { recursive: true }); await writeFile(path, text); },
  };
}

test("status has no writes and projects share learning memory but separate clocks", async (t) => {
  const f = await fixture(t);
  assert.equal((await f.run("status")).state, null);
  await assert.rejects(readFile(f.paths.statePath), { code: "ENOENT" });
  await assert.rejects(readFile(f.paths.promptPath), { code: "ENOENT" });
  const other = lessonPaths({ cwd: "/another/project", agentDir: dirname(f.paths.memoryDir) });
  assert.equal(other.memoryDir, f.paths.memoryDir);
  assert.notEqual(other.statePath, f.paths.statePath);
});

test("preparing is repeatable and finishing preserves all unrelated prompt edits", async (t) => {
  const f = await fixture(t);
  const custom = "# My voice preferences\r\nKeep my custom tone.\r\n";
  await f.file(f.paths.promptPath, custom);
  const first = await f.run("prepare");
  const prepared = await readFile(f.paths.promptPath, "utf8");
  assert.ok(prepared.startsWith(custom));
  assert.ok(prepared.includes(await readFile(new URL("../tasks/language/practice/references/teacher.md", import.meta.url), "utf8")));
  assert.equal((await f.run("prepare")).state.id, first.state.id);
  assert.equal(await readFile(f.paths.promptPath, "utf8"), prepared);
  await f.file(f.paths.promptPath, prepared + "\nAnother preference.\n");
  await f.run("finish");
  assert.equal(await readFile(f.paths.promptPath, "utf8"), custom + "\nAnother preference.\n");
  await f.run("finish");
  assert.equal(await readFile(f.paths.promptPath, "utf8"), custom + "\nAnother preference.\n");
});

test("finishing removes a generated prompt and keeps memory and global voice settings", async (t) => {
  const f = await fixture(t);
  const globalPrompt = join(dirname(f.paths.memoryDir), "REALTIME-SYSTEM-PROMPT.md");
  const review = join(f.paths.memoryDir, "en", "review.md");
  await f.file(globalPrompt, "Global voice instructions");
  await f.file(review, "Review past tense next lesson.");
  await f.run("prepare");
  await f.run("finish");
  await assert.rejects(readFile(f.paths.promptPath), { code: "ENOENT" });
  assert.equal(await readFile(globalPrompt, "utf8"), "Global voice instructions");
  assert.equal(await readFile(review, "utf8"), "Review past tense next lesson.");
});

test("clock starts with the lesson, allows extension without reset, and freezes at finish", async (t) => {
  const f = await fixture(t);
  const prepared = await f.run("prepare");
  assert.equal(prepared.remainingMinutes, undefined);
  const start = Date.parse("2026-11-09T10:05:00Z");
  const active = await f.run("start", { now: start, minutes: "10" });
  assert.equal(active.remainingMinutes, 10);
  await assert.rejects(f.run("prepare"), /Finish the current lesson/);
  const nearEnd = await f.run("status", { now: start + 8 * 60000 });
  assert.equal(nearEnd.remainingMinutes, 2);
  assert.equal(nearEnd.wrapUp, true);
  const extended = await f.run("start", { now: start + 8 * 60000, minutes: 20 });
  assert.equal(extended.state.startedAt, active.state.startedAt);
  assert.equal(extended.remainingMinutes, 12);
  assert.equal(extended.wrapUp, false);
  assert.equal((await f.run("status", { now: start + 21 * 60000 })).remainingMinutes, 0);
  const finished = await f.run("finish", { now: start + 22 * 60000 });
  assert.equal((await f.run("status", { now: start + 30 * 60000 })).elapsedMinutes, finished.elapsedMinutes);
  await assert.rejects(f.run("start", { minutes: 15 }), /Prepare a lesson/);
  assert.notEqual((await f.run("prepare")).state.id, prepared.state.id);
});

test("invalid durations and damaged prompt markers do not overwrite existing state", async (t) => {
  const f = await fixture(t);
  await assert.rejects(f.run("start", { minutes: 15 }), /Prepare a lesson/);
  await f.run("prepare");
  const state = await readFile(f.paths.statePath, "utf8");
  for (const minutes of [undefined, "", "oops", "Infinity", 0, -1]) {
    await assert.rejects(f.run("start", { minutes }), /positive number/);
    assert.equal(await readFile(f.paths.statePath, "utf8"), state);
  }
  const damaged = "My custom instructions\n<!-- pi-ext:language-practice:start -->\nEdited block";
  await f.file(f.paths.promptPath, damaged);
  for (const command of ["prepare", "finish"]) {
    await assert.rejects(f.run(command), /markers/);
    assert.equal(await readFile(f.paths.promptPath, "utf8"), damaged);
    assert.equal(await readFile(f.paths.statePath, "utf8"), state);
  }
});
