import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { appendFile, mkdtemp, rm, stat, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createRecord, listRecords, readRecord, saveCheckpoint } from "../src/records.ts";

/** Creates an isolated directory and removes it after the test. */
async function studyDirectory(t) {
  const root = await mkdtemp(join(tmpdir(), "study-records-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  return join(root, "study");
}

test("recovers earlier checkpoints from malformed and truncated entries and accepts a later append", async (t) => {
  const directory = await studyDirectory(t);
  const record = await createRecord(directory, "Transformers");
  const path = join(directory, `${record.id}.jsonl`);
  await saveCheckpoint(directory, record.id, { plan: "Implement attention", progress: "Read the paper" });
  await appendFile(path, '{"type":"checkpoint","plan":"Invalid replacement","next":9}\n{"type":"checkp');

  assert.deepEqual(await readRecord(directory, record.id), {
    ...record, plan: "Implement attention", progress: "Read the paper",
  });

  await saveCheckpoint(directory, record.id, { next: "Trace attention shapes" });
  assert.deepEqual(await readRecord(directory, record.id), {
    ...record, plan: "Implement attention", progress: "Read the paper", next: "Trace attention shapes",
  });
});

test("merges concurrent appends and preserves fields omitted in later checkpoints", async (t) => {
  const directory = await studyDirectory(t);
  const record = await createRecord(directory, "Compilers");
  await Promise.all([
    saveCheckpoint(directory, record.id, { plan: "Lex, parse, evaluate" }),
    saveCheckpoint(directory, record.id, { progress: "Lexer complete" }),
    saveCheckpoint(directory, record.id, { next: "Implement a parser" }),
  ]);
  await saveCheckpoint(directory, record.id, { topic: "Compilers in Rust" });

  assert.deepEqual(await readRecord(directory, record.id), {
    id: record.id,
    topic: "Compilers in Rust",
    plan: "Lex, parse, evaluate",
    progress: "Lexer complete",
    next: "Implement a parser",
  });
});

test("creates private journals and refuses to read or append through a symlink", { skip: process.platform === "win32" }, async (t) => {
  const directory = await studyDirectory(t);
  const record = await createRecord(directory, "Distributed systems");
  const path = join(directory, `${record.id}.jsonl`);
  assert.equal((await stat(directory)).mode & 0o077, 0);
  assert.equal((await stat(path)).mode & 0o077, 0);

  const alias = randomUUID();
  await symlink(path, join(directory, `${alias}.jsonl`));
  await assert.rejects(readRecord(directory, alias));
  await assert.rejects(saveCheckpoint(directory, alias, { next: "Invalid write" }));
  assert.deepEqual(await listRecords(directory), [record]);
});
