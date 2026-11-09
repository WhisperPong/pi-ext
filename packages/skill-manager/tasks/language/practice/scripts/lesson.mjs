import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const taskDir = fileURLToPath(new URL("../", import.meta.url));
const begin = "\n\n<!-- pi-ext:language-practice:start -->\n";
const end = "\n<!-- pi-ext:language-practice:end -->\n";

export function lessonPaths({ cwd = process.cwd(), agentDir = process.env.PI_CODING_AGENT_DIR || join(homedir(), ".pi", "agent") } = {}) {
  const memoryDir = join(resolve(agentDir), "language-practice");
  const workspace = createHash("sha256").update(resolve(cwd)).digest("hex").slice(0, 16);
  return {
    memoryDir,
    profilePath: join(memoryDir, "profile.md"),
    statePath: join(memoryDir, "sessions", `${workspace}.json`),
    promptPath: join(resolve(cwd), ".pi", "REALTIME-SYSTEM-PROMPT.md"),
  };
}

async function readOptional(path) {
  try { return await readFile(path, "utf8"); }
  catch (error) { if (error.code === "ENOENT") return undefined; throw error; }
}

async function writeAtomic(path, content) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, content, { flag: "wx", mode: 0o600 });
    await rename(temporary, path);
  } finally {
    await unlink(temporary).catch((error) => { if (error.code !== "ENOENT") throw error; });
  }
}

function replaceTeacher(source, teacher) {
  const starts = source.split("<!-- pi-ext:language-practice:start -->").length - 1;
  const ends = source.split("<!-- pi-ext:language-practice:end -->").length - 1;
  const block = teacher === undefined ? "" : `${begin}${teacher}${end}`;
  if (!starts && !ends) return source + block;
  const from = source.indexOf(begin);
  const to = source.indexOf(end, from + begin.length);
  if (starts !== 1 || ends !== 1 || from < 0 || to < from) {
    throw new Error("The lesson prompt block was edited. Restore its markers before continuing.");
  }
  return source.slice(0, from) + block + source.slice(to + end.length);
}

export async function lesson(command, { paths = lessonPaths(), minutes, now = Date.now() } = {}) {
  const stored = await readOptional(paths.statePath);
  let state = stored === undefined ? undefined : JSON.parse(stored);
  if (stored !== undefined && (!state || !["prepared", "active", "finished"].includes(state.status)
    || typeof state.id !== "string" || (state.status === "active" && (!Number.isFinite(Date.parse(state.startedAt))
      || !Number.isFinite(state.durationMinutes) || state.durationMinutes <= 0)))) {
    throw new Error("Invalid lesson state. Preserve it before starting another lesson.");
  }

  if (command === "prepare") {
    if (state?.status === "active") throw new Error("Finish the current lesson before preparing another.");
    const teacher = await readFile(join(taskDir, "references", "teacher.md"), "utf8");
    const context = `\nTask directory: ${JSON.stringify(taskDir)}\nLesson helper: ${JSON.stringify(join(taskDir, "scripts", "lesson.mjs"))}\nLearning memory directory: ${JSON.stringify(paths.memoryDir)}\n`;
    const source = await readOptional(paths.promptPath) ?? "";
    const next = replaceTeacher(source, teacher + context);
    state = state?.status === "prepared" ? state : { id: randomUUID(), status: "prepared", preparedAt: new Date(now).toISOString() };
    await writeAtomic(paths.statePath, `${JSON.stringify(state, null, 2)}\n`);
    await writeAtomic(paths.promptPath, next);
  } else if (command === "start") {
    if (!state || state.status === "finished") throw new Error("Prepare a lesson before starting it.");
    const duration = Number(minutes);
    if (!Number.isFinite(duration) || duration <= 0) throw new Error("Duration must be a positive number of minutes.");
    state = { ...state, status: "active", startedAt: state.startedAt ?? new Date(now).toISOString(), durationMinutes: duration };
    await writeAtomic(paths.statePath, `${JSON.stringify(state, null, 2)}\n`);
  } else if (command === "finish") {
    const source = await readOptional(paths.promptPath);
    if (source !== undefined) {
      const next = replaceTeacher(source);
      if (next !== source) {
        if (next) await writeAtomic(paths.promptPath, next);
        else await unlink(paths.promptPath);
      }
    }
    if (state && state.status !== "finished") {
      state = { ...state, status: "finished", finishedAt: new Date(now).toISOString() };
      await writeAtomic(paths.statePath, `${JSON.stringify(state, null, 2)}\n`);
    }
  } else if (command !== "status") {
    throw new Error("Use prepare, start <minutes>, status, or finish.");
  }

  const elapsed = state?.startedAt ? Math.max(0, ((state.finishedAt ? Date.parse(state.finishedAt) : now) - Date.parse(state.startedAt)) / 60000) : 0;
  const remaining = state?.startedAt ? Math.max(0, state.durationMinutes - elapsed) : undefined;
  return {
    ...paths, state: state ?? null, now: new Date(now).toISOString(),
    ...(remaining === undefined ? {} : {
      elapsedMinutes: Math.round(elapsed * 10) / 10,
      remainingMinutes: Math.round(remaining * 10) / 10,
      wrapUp: remaining <= Math.min(2, state.durationMinutes / 5),
    }),
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    console.log(JSON.stringify(await lesson(process.argv[2] ?? "status", { minutes: process.argv[3] }), null, 2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
