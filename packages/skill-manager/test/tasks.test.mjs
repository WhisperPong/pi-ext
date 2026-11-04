import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import skillManager from "../index.ts";
import { discoverTasks, taskPrompt } from "../src/catalog.ts";
import { registerTasks } from "../src/plugin.ts";

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), "pi-ext-tasks-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  return { root, async file(path, text) {
    const target = join(root, path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, text);
    return target;
  } };
}

const markdown = (description = "Example task", body = "Follow project conventions.") => `---\ndescription: ${description}\n---\n${body}\n`;

function harness(register = skillManager) {
  const commands = new Map();
  const messages = [];
  const notifications = [];
  const choices = [];
  let idle = true;
  let choose = (options) => options[0];
  const ctx = {
    hasUI: true,
    isIdle: () => idle,
    ui: {
      notify: (text, level) => notifications.push({ text, level }),
      select: async (title, options) => { choices.push({ title, options }); return choose(options); },
    },
  };
  register({
    registerCommand: (name, command) => commands.set(name, command),
    sendUserMessage: (text, options) => messages.push({ text, options }),
  });
  return {
    commands, messages, notifications, choices, ctx,
    setIdle: (value) => { idle = value; },
    setChoice: (fn) => { choose = fn; },
    invoke: (name, args = "") => commands.get(name).handler(args, ctx),
  };
}

test("discovers series recursively while keeping supporting files private to each task", async (t) => {
  const f = await fixture(t);
  await f.file("review/fix/TASK.md", markdown("Check and fix changes"));
  await f.file("review/fix/references/TASK.md", markdown("Must not become a command"));
  await f.file("build/check/TASK.md", markdown("Check a build"));
  await f.file(".hidden/TASK.md", markdown());
  await f.file("notes.md", "Not a task");
  const tasks = discoverTasks(f.root);
  assert.deepEqual(tasks.map((task) => task.command), ["build:check", "review:fix"]);
  assert.equal(tasks[1].baseDir, join(f.root, "review", "fix"));
  assert.equal(tasks[1].description, "Check and fix changes");
  assert.equal(tasks[1].instructions, "Follow project conventions.");
});

test("rejects missing descriptions, empty instructions, invalid command paths, and root tasks", async (t) => {
  for (const [path, text, error] of [
    ["review/fix/TASK.md", "Instructions only", /description and instructions/],
    ["review/fix/TASK.md", markdown("Example", ""), /description and instructions/],
    ["Review/fix/TASK.md", markdown(), /Invalid task directory/],
    ["review:fix/TASK.md", markdown(), /Invalid task directory/],
    ["TASK.md", markdown(), /Invalid task directory/],
  ]) {
    const f = await fixture(t);
    await f.file(path, text);
    assert.throws(() => discoverTasks(f.root), error);
  }
});

test("does not follow task directory symlinks or accept symlinked task files", async (t) => {
  const f = await fixture(t);
  const external = await fixture(t);
  await external.file("TASK.md", markdown());
  await symlink(external.root, join(f.root, "outside"), process.platform === "win32" ? "junction" : "dir");
  assert.deepEqual(discoverTasks(f.root), []);
  await mkdir(join(f.root, "linked"));
  await symlink(join(external.root, "TASK.md"), join(f.root, "linked", "TASK.md"));
  assert.throws(() => discoverTasks(f.root), /Invalid task directory/);
});

test("prompt carries a task-relative reference base and literal user arguments", () => {
  const task = { command: "review:fix", baseDir: resolve("task with spaces"), description: "Review", instructions: "Read references/checklist.md." };
  const prompt = taskPrompt(task, "  focus on $ARGUMENTS\n/reload  ");
  assert.ok(prompt.includes(`Task directory: ${task.baseDir}`));
  assert.match(prompt, /Read references\/checklist\.md/);
  assert.ok(prompt.endsWith("Additional user instructions:\nfocus on $ARGUMENTS\n/reload"));
  assert.ok(!taskPrompt(task, " ").includes("Additional user instructions:"));
});

test("registers packaged commands without sending instructions until invoked", async () => {
  const app = harness();
  assert.deepEqual([...app.commands.keys()], ["review:fix", "tasks"]);
  assert.deepEqual(app.messages, []);
  await app.invoke("review:fix", "Focus on state ownership");
  assert.equal(app.messages.length, 1);
  assert.equal(app.messages[0].options, undefined);
  assert.match(app.messages[0].text, /check → edit → verify/);
  assert.match(app.messages[0].text, /Respond in the user's language/);
  assert.match(app.messages[0].text, /Focus on state ownership$/);
});

test("queues tasks as follow-ups while the current run is busy, without steering", async () => {
  const app = harness();
  app.setIdle(false);
  await app.invoke("review:fix");
  assert.deepEqual(app.messages[0].options, { deliverAs: "followUp" });
  assert.match(app.notifications[0].text, /Queued \/review:fix/);
});

test("task picker supports selection and cancellation", async () => {
  const app = harness();
  await app.invoke("tasks");
  assert.match(app.choices[0].options[0], /^\/review:fix — /);
  assert.equal(app.messages.length, 1);
  app.setChoice(() => undefined);
  await app.invoke("tasks");
  assert.equal(app.messages.length, 1);
});

test("task dispatcher supports direct arguments and does not execute unknown commands", async () => {
  const app = harness();
  app.ctx.hasUI = false;
  await app.invoke("tasks", "/review:fix focus on errors");
  assert.match(app.messages[0].text, /focus on errors$/);
  assert.deepEqual(app.choices, []);
  await app.invoke("tasks", "unknown:task");
  assert.equal(app.messages.length, 1);
  assert.match(app.notifications.at(-1).text, /Unknown task/);
  assert.deepEqual(app.commands.get("tasks").getArgumentCompletions("review:"), [{
    value: "review:fix", label: "review:fix", description: app.commands.get("review:fix").description,
  }]);
  assert.deepEqual(app.commands.get("tasks").getArgumentCompletions("other:"), []);
});

test("non-UI task picker and empty catalogs give guidance without sending a model request", async () => {
  const app = harness();
  app.ctx.hasUI = false;
  await app.invoke("tasks");
  assert.match(app.notifications[0].text, /Use \/tasks/);
  assert.deepEqual(app.messages, []);
  const empty = harness((pi) => registerTasks(pi, []));
  await empty.invoke("tasks");
  assert.match(empty.notifications[0].text, /No packaged tasks/);
  assert.deepEqual(empty.messages, []);
});

test("the manager handles unrelated task series without review-specific registration code", async () => {
  const build = { command: "build:check", baseDir: "/example/build", description: "Check build", instructions: "Run the project build checks." };
  const app = harness((pi) => registerTasks(pi, [build]));
  await app.invoke("build:check");
  assert.match(app.messages[0].text, /Run the project build checks/);
  await app.invoke("tasks", "build:check no network");
  assert.match(app.messages[1].text, /no network$/);
});

test("duplicate or reserved task commands fail before registering partial commands", () => {
  const task = { command: "tasks", description: "Task", baseDir: "/example", instructions: "Do work" };
  for (const tasks of [[task], [{ ...task, command: "a:b" }, { ...task, command: "a:b" }]]) {
    const commands = [];
    assert.throws(() => registerTasks({ registerCommand: (name) => commands.push(name) }, tasks), /Duplicate or reserved/);
    assert.deepEqual(commands, []);
  }
});

test("Pi loads the real extension with namespaced commands and no native skill resources", async (t) => {
  const { DefaultResourceLoader, SettingsManager } = await import("@earendil-works/pi-coding-agent");
  const f = await fixture(t);
  const loader = new DefaultResourceLoader({
    cwd: f.root,
    agentDir: join(f.root, "agent"),
    settingsManager: SettingsManager.inMemory(),
    additionalExtensionPaths: [fileURLToPath(new URL("../index.ts", import.meta.url))],
    noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true,
  });
  await loader.reload();
  const loaded = loader.getExtensions();
  assert.deepEqual(loaded.errors, []);
  const extension = loaded.extensions.find((entry) => entry.commands.has("review:fix"));
  assert.ok(extension);
  assert.ok(extension.commands.has("tasks"));
  assert.deepEqual(loader.getSkills().skills, []);
  const tasks = discoverTasks(fileURLToPath(new URL("../tasks/", import.meta.url)));
  assert.match(await readFile(join(tasks[0].baseDir, "references", "checklist.md"), "utf8"), /Encapsulation and Responsibilities/);
});
