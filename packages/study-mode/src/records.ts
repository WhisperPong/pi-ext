import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { link, mkdir, open, readdir, unlink, type FileHandle } from "node:fs/promises";
import { join } from "node:path";

export type StudyCheckpoint = { topic?: string; plan?: string; progress?: string; next?: string };
export type StudyRecord = StudyCheckpoint & { id: string; topic: string };

const ID = /^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i;
const FIELDS = ["topic", "plan", "progress", "next"] as const;
const SAFE_OPEN = constants.O_NOFOLLOW | constants.O_NONBLOCK;

/** Returns a journal path for a UUID without allowing path components in the ID. */
function journalPath(directory: string, id: string): string {
  if (!ID.test(id)) throw new Error("Invalid study record ID. Choose a topic with /study.");
  return join(directory, `${id}.jsonl`);
}

/** Tests a filesystem error code without relying on platform-specific error messages. */
function hasCode(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === code;
}

/** Parses one journal entry, allowing recovery past an incomplete append. */
function parseLine(line: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(line);
    return typeof value === "object" && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/** Validates checkpoint fields and retains only recognized values. */
function checkpointOf(value: Partial<Record<keyof StudyCheckpoint, unknown>>): StudyCheckpoint | null {
  const checkpoint: StudyCheckpoint = {};
  for (const field of FIELDS) {
    const text = value[field];
    if (text === undefined) continue;
    if (typeof text !== "string" || (field === "topic" && !text.trim())) return null;
    checkpoint[field] = text;
  }
  return checkpoint;
}

/** Reads a regular file and rebuilds its latest valid state from its journal entries. */
async function readJournal(file: FileHandle, id: string): Promise<{ record: StudyRecord; touched: number } | null> {
  const stat = await file.stat();
  if (!stat.isFile()) return null;
  const [first, ...lines] = (await file.readFile("utf8")).split("\n");
  const created = parseLine(first);
  if (created?.type !== "created" || typeof created.topic !== "string" || !created.topic.trim()) return null;
  const record: StudyRecord = { id, topic: created.topic };
  for (const line of lines) {
    const entry = line.trim() ? parseLine(line) : null;
    if (entry?.type !== "checkpoint") continue;
    const checkpoint = checkpointOf(entry);
    if (checkpoint !== null) Object.assign(record, checkpoint);
  }
  return { record, touched: stat.mtimeMs };
}

/** Opens and closes a journal around an operation and explains a missing topic. */
async function withJournal<T>(
  directory: string,
  id: string,
  flags: number,
  read: (file: FileHandle) => Promise<T>,
): Promise<T> {
  const path = journalPath(directory, id);
  const file = await open(path, flags | SAFE_OPEN).catch((error: unknown) => {
    if (hasCode(error, "ENOENT")) {
      throw new Error(`Study record ${id} is missing. Restore it or choose a topic with /study in a new Pi session.`, { cause: error });
    }
    throw error;
  });
  try {
    return await read(file);
  } finally {
    await file.close();
  }
}

/** Publishes a complete initial journal without replacing an existing record. */
export async function createRecord(directory: string, topic: string): Promise<StudyRecord> {
  const name = topic.trim();
  if (!name) throw new Error("Enter a topic to start studying.");
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const id = randomUUID();
  const path = journalPath(directory, id);
  const temporary = join(directory, `.${id}.tmp`);
  const file = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | SAFE_OPEN, 0o600);
  try {
    try {
      await file.writeFile(`${JSON.stringify({ type: "created", topic: name })}\n`);
      await file.sync();
    } finally {
      await file.close();
    }
    await link(temporary, path);
  } finally {
    await unlink(temporary);
  }
  return { id, topic: name };
}

/** Reads one topic or tells the learner how to proceed if its journal is unusable. */
export async function readRecord(directory: string, id: string): Promise<StudyRecord> {
  return withJournal(directory, id, constants.O_RDONLY, async (file) => {
    const result = await readJournal(file, id);
    if (!result) throw new Error(`Study record ${id} is corrupt. Restore it or choose a topic with /study in a new Pi session.`);
    return result.record;
  });
}

/** Lists readable topics from most recently updated to oldest. */
export async function listRecords(directory: string): Promise<StudyRecord[]> {
  const entries = await readdir(directory, { withFileTypes: true }).catch((error: unknown) => {
    if (hasCode(error, "ENOENT")) return [];
    throw error;
  });
  const journals: { record: StudyRecord; touched: number }[] = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".jsonl")) continue;
    const id = entry.name.slice(0, -".jsonl".length);
    if (!ID.test(id)) continue;
    const file = await open(journalPath(directory, id), constants.O_RDONLY | SAFE_OPEN).catch((error: unknown) => {
      if (hasCode(error, "ENOENT") || hasCode(error, "ELOOP")) return null;
      throw error;
    });
    if (!file) continue;
    try {
      const journal = await readJournal(file, id);
      if (journal) journals.push(journal);
    } finally {
      await file.close();
    }
  }
  return journals.sort((a, b) => b.touched - a.touched || a.record.id.localeCompare(b.record.id))
    .map(({ record }) => record);
}

/** Appends one checkpoint, preserving earlier values for omitted fields. */
export async function saveCheckpoint(directory: string, id: string, checkpoint: StudyCheckpoint): Promise<void> {
  const valid = checkpointOf(checkpoint);
  if (!valid) throw new Error("Study checkpoint has an invalid field.");
  const buffer = Buffer.from(`\n${JSON.stringify({ type: "checkpoint", ...valid })}\n`);
  await withJournal(directory, id, constants.O_RDWR | constants.O_APPEND, async (file) => {
    if (!(await readJournal(file, id))) {
      throw new Error(`Study record ${id} is corrupt. Restore it or choose a topic with /study in a new Pi session.`);
    }
    const { bytesWritten } = await file.write(buffer);
    if (bytesWritten !== buffer.length) throw new Error("The study checkpoint was only partly written. Try saving again.");
    await file.sync();
  });
}
