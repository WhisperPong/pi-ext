import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, readlink, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { PassThrough } from "node:stream";
import test from "node:test";
import { configureExtensions, describeResources, discoverResources, installSkill, readSettings, runSetup, setupPaths, skillStatus } from "../setup-lib.mjs";
import { chooseResources } from "../setup.mjs";

async function fixture(t) {
  const base = await mkdtemp(join(tmpdir(), "pi-ext-setup-"));
  t.after(() => rm(base, { recursive: true, force: true }));
  const paths = setupPaths({ root: join(base, "repo"), home: join(base, "home"), agentDir: join(base, "home", ".pi", "agent") });
  await mkdir(paths.root, { recursive: true });
  return { paths, async file(path, contents = "") {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, contents);
  } };
}

async function addExtension(f, name) {
  const source = join(f.paths.root, "packages", name, "index.ts");
  await f.file(source, "export default function () {}\n");
  await f.file(join(dirname(source), "package.json"), JSON.stringify({ name, description: `${name} description` }));
  return { id: name, source };
}

async function addSkill(f, name) {
  const source = join(f.paths.root, "skills", name);
  await f.file(join(source, "SKILL.md"), `---\nname: ${name}\ndescription: Test skill\n---\nInstructions\n`);
  await f.file(join(source, "scripts", "helper.sh"), "echo test\n");
  return { id: name, source };
}

test("discovers extensions and portable skill directories without dependencies", async (t) => {
  const f = await fixture(t);
  assert.deepEqual(await discoverResources(f.paths.root), { extensions: [], skills: [] });
  await addExtension(f, "codex-bar");
  await addSkill(f, "example");
  await f.file(join(f.paths.root, "skills", ".gitkeep"));
  await f.file(join(f.paths.root, "skills", "incomplete", "README.md"));
  const resources = await discoverResources(f.paths.root);
  assert.deepEqual(resources.extensions.map((entry) => entry.id), ["codex-bar"]);
  assert.equal(resources.extensions[0].description, "codex-bar description");
  assert.deepEqual(resources.skills.map((entry) => entry.id), ["example"]);
});

test("cancel does not install dependencies, create settings, or link skills", async (t) => {
  const f = await fixture(t);
  await addExtension(f, "codex-bar");
  await addSkill(f, "example");
  await runSetup({ paths: f.paths, choose: async () => undefined, run: () => assert.fail("Must not run"), log: () => {} });
  await assert.rejects(readFile(f.paths.settingsPath), { code: "ENOENT" });
  await assert.rejects(readdir(f.paths.skillsDir), { code: "ENOENT" });
});

test("installs only selected extensions, migrates a legacy root entry, and preserves other settings", async (t) => {
  const f = await fixture(t);
  await addExtension(f, "codex-bar");
  await addExtension(f, "other");
  const source = relative(dirname(f.paths.settingsPath), f.paths.root);
  await f.file(f.paths.settingsPath, JSON.stringify({ theme: "system", packages: ["npm:unrelated", source], skills: ["!private*"] }));
  const runs = [];
  await runSetup({
    paths: f.paths,
    choose: async (options) => {
      assert.ok(options.extensions.every((entry) => entry.status === "installed"));
      return { extensions: ["codex-bar"], skills: [] };
    },
    run: async (...args) => {
      runs.push(args);
      // An unrelated setting changed while dependencies were being installed.
      const settings = await readSettings(f.paths.settingsPath);
      await f.file(f.paths.settingsPath, JSON.stringify({ ...settings, defaultThinkingLevel: "high" }));
    },
    log: () => {},
  });
  assert.deepEqual(runs, [["pnpm", ["install"], f.paths.root]]);
  const settings = await readSettings(f.paths.settingsPath);
  assert.equal(settings.theme, "system");
  assert.equal(settings.defaultThinkingLevel, "high");
  assert.deepEqual(settings.skills, ["!private*"]);
  assert.deepEqual(settings.packages, ["npm:unrelated", { source: f.paths.root, extensions: ["packages/codex-bar/index.ts"], skills: [] }]);
  const options = await describeResources(await discoverResources(f.paths.root), f.paths, settings);
  assert.deepEqual(options.extensions.map((entry) => entry.selected), [true, false]);
});

test("deselecting extensions disables only this repository and does not remove skills", async (t) => {
  const f = await fixture(t);
  const extension = await addExtension(f, "codex-bar");
  const skill = await addSkill(f, "example");
  await configureExtensions(f.paths, [extension]);
  await installSkill(skill, f.paths.skillsDir);
  await runSetup({ paths: f.paths, choose: async () => ({ extensions: [], skills: [] }), run: () => assert.fail("No dependencies needed"), log: () => {} });
  assert.deepEqual((await readSettings(f.paths.settingsPath)).packages[0].extensions, []);
  assert.equal(await skillStatus(skill, f.paths.skillsDir), "installed");
});

test("links selected skills with their supporting files and is safe to rerun", async (t) => {
  const f = await fixture(t);
  const skill = await addSkill(f, "example");
  const run = () => assert.fail("Skills-only setup needs no pnpm install");
  const choose = async () => ({ extensions: [], skills: [skill.id] });
  await runSetup({ paths: f.paths, choose, run, log: () => {} });
  assert.equal(await readFile(join(f.paths.skillsDir, skill.id, "scripts", "helper.sh"), "utf8"), "echo test\n");
  const link = await readlink(join(f.paths.skillsDir, skill.id));
  await runSetup({ paths: f.paths, choose, run, log: () => {} });
  assert.equal(await readlink(join(f.paths.skillsDir, skill.id)), link);
  assert.equal(await skillStatus(skill, f.paths.skillsDir), "installed");
  await assert.rejects(readFile(f.paths.settingsPath), { code: "ENOENT" });
});

test("existing local skills and broken symlinks are never overwritten", async (t) => {
  const f = await fixture(t);
  const local = await addSkill(f, "local");
  const broken = await addSkill(f, "broken");
  await f.file(join(f.paths.skillsDir, "local", "SKILL.md"), "local changes");
  await symlink(join(f.paths.root, "missing"), join(f.paths.skillsDir, "broken"), "dir");
  assert.equal(await installSkill(local, f.paths.skillsDir), "exists");
  assert.equal(await installSkill(broken, f.paths.skillsDir), "exists");
  assert.equal(await readFile(join(f.paths.skillsDir, "local", "SKILL.md"), "utf8"), "local changes");
  assert.equal(await readlink(join(f.paths.skillsDir, "broken")), join(f.paths.root, "missing"));
});

test("dependency failure and malformed settings do not change installation settings", async (t) => {
  const f = await fixture(t);
  await addExtension(f, "codex-bar");
  const original = '{"theme":"dark"}\n';
  await f.file(f.paths.settingsPath, original);
  await assert.rejects(runSetup({
    paths: f.paths,
    choose: async () => ({ extensions: ["codex-bar"], skills: [] }),
    run: async () => { throw new Error("Dependency installation failed"); },
    log: () => {},
  }), /Dependency installation failed/);
  assert.equal(await readFile(f.paths.settingsPath, "utf8"), original);
  await f.file(f.paths.settingsPath, "not JSON");
  await assert.rejects(runSetup({ paths: f.paths, choose: () => assert.fail("Cannot continue"), run: () => {}, log: () => {} }), /Cannot read/);
  assert.equal(await readFile(f.paths.settingsPath, "utf8"), "not JSON");
});

test("preserves root-package options and does not duplicate equivalent local paths", async (t) => {
  const f = await fixture(t);
  const extension = await addExtension(f, "codex-bar");
  await f.file(f.paths.settingsPath, JSON.stringify({ packages: [
    { source: f.paths.root, extensions: [], prompts: [] },
    relative(dirname(f.paths.settingsPath), f.paths.root),
  ] }));
  await configureExtensions(f.paths, [extension]);
  const settings = await readSettings(f.paths.settingsPath);
  assert.equal(settings.packages.length, 1);
  assert.deepEqual(settings.packages[0].prompts, []);
  const original = await readFile(f.paths.settingsPath, "utf8");
  await configureExtensions(f.paths, [extension]);
  assert.equal(await readFile(f.paths.settingsPath, "utf8"), original);
});

test("respects a custom agent directory and refuses unknown selections", async (t) => {
  const f = await fixture(t);
  const paths = setupPaths({ root: f.paths.root, home: dirname(f.paths.skillsDir), agentDir: join(f.paths.root, "custom-agent") });
  assert.equal(paths.settingsPath, join(f.paths.root, "custom-agent", "settings.json"));
  await assert.rejects(runSetup({
    paths,
    choose: async () => ({ extensions: ["missing"], skills: [] }),
    run: () => assert.fail("Must not run"),
    log: () => {},
  }), /Unknown setup selection/);
  await assert.rejects(readFile(paths.settingsPath), { code: "ENOENT" });
});

test("Pi loads only the selected extension and does not auto-load unselected bundled skills", async (t) => {
  const { DefaultPackageManager, SettingsManager } = await import("@earendil-works/pi-coding-agent");
  const f = await fixture(t);
  const extension = await addExtension(f, "codex-bar");
  const other = await addExtension(f, "other");
  const skill = await addSkill(f, "example");
  await f.file(join(f.paths.root, "package.json"), JSON.stringify({ pi: { extensions: ["./packages/*/index.ts"], skills: [] } }));
  await configureExtensions(f.paths, [extension]);
  const manager = new DefaultPackageManager({
    cwd: f.paths.root,
    agentDir: dirname(f.paths.settingsPath),
    settingsManager: SettingsManager.inMemory(await readSettings(f.paths.settingsPath)),
  });
  const resources = await manager.resolve();
  assert.ok(resources.extensions.some((entry) => entry.path === extension.source && entry.enabled));
  assert.ok(!resources.extensions.some((entry) => entry.path === other.source && entry.enabled));
  assert.ok(!resources.skills.some((entry) => entry.path.startsWith(skill.source) && entry.enabled));
});

test("recognizes existing package include and exclude filters", async (t) => {
  const f = await fixture(t);
  await addExtension(f, "codex-bar");
  await addExtension(f, "other");
  const resources = await discoverResources(f.paths.root);
  for (const [filters, expected] of [
    [["packages/*/index.ts", "!packages/other/**"], [true, false]],
    [["!**/*", "+packages/codex-bar/index.ts"], [true, false]],
    [["+packages/codex-bar/index.ts"], [true, true]],
    [["packages/*/index.ts", "-packages/codex-bar/index.ts"], [false, true]],
  ]) {
    const options = await describeResources(resources, f.paths, { packages: [{ source: f.paths.root, extensions: filters }] });
    assert.deepEqual(options.extensions.map((entry) => entry.selected), expected);
  }
});

async function interactive(answers, options) {
  const input = new PassThrough();
  const output = new PassThrough();
  input.isTTY = true;
  output.isTTY = true;
  let transcript = "";
  output.on("data", (chunk) => {
    const text = chunk.toString();
    transcript += text;
    if (text.includes("Numbers to toggle") || text.includes("Apply this selection?")) {
      const answer = answers.shift();
      setImmediate(() => {
        if (answer === undefined) input.end();
        else input.write(`${answer}\n`);
      });
    }
  });
  try {
    const selection = await chooseResources(options, { input, output });
    return { selection, transcript };
  } finally {
    input.destroy();
    output.destroy();
  }
}

const menu = {
  extensions: [{ id: "codex-bar", description: "Codex status", selected: false, status: "new" }],
  skills: [],
};

test("interactive chooser supports numbered selection and requires confirmation", async () => {
  const { selection, transcript } = await interactive(["99", "1,1", "", "y"], menu);
  assert.deepEqual(selection, { extensions: ["codex-bar"], skills: [] });
  assert.match(transcript, /Invalid selection/);
  assert.match(transcript, /Skills/);
  assert.match(transcript, /none available/);
  assert.equal(menu.extensions[0].selected, false);
});

test("interactive chooser supports all/none and cancellation including EOF", async () => {
  assert.deepEqual((await interactive(["a", "n", "", "y"], menu)).selection, { extensions: [], skills: [] });
  for (const answers of [["q"], ["", "n"], []]) {
    assert.equal((await interactive(answers, menu)).selection, undefined);
  }
});

test("interactive chooser rejects redirected input without making changes", async () => {
  await assert.rejects(chooseResources({ extensions: [], skills: [] }, { input: new PassThrough(), output: new PassThrough() }), /interactive terminal/);
});
