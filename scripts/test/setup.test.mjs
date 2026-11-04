import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readlink, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import test from "node:test";
import { configureExtensions, describeResources, discoverResources, readSettings, runSetup, setupPaths } from "../setup-lib.mjs";

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

async function legacyLink(f, target = join(f.paths.root, "skills", "review-fix")) {
  await mkdir(f.paths.legacySkillsDir, { recursive: true });
  const link = join(f.paths.legacySkillsDir, "review-fix");
  await symlink(target, link, process.platform === "win32" ? "junction" : "dir");
  return link;
}

test("discovers only extensions without dependencies or standalone skill discovery", async (t) => {
  const f = await fixture(t);
  assert.deepEqual(await discoverResources(f.paths.root), { extensions: [] });
  await addExtension(f, "codex-bar");
  await addExtension(f, "skill-manager");
  await f.file(join(f.paths.root, "skills", "legacy", "SKILL.md"), "Legacy instructions");
  await f.file(join(f.paths.root, "packages", "incomplete", "README.md"));
  const resources = await discoverResources(f.paths.root);
  assert.deepEqual(resources.extensions.map((entry) => entry.id), ["codex-bar", "skill-manager"]);
  assert.equal(resources.extensions[0].description, "codex-bar description");
  assert.equal(resources.skills, undefined);
});

test("cancel does not install dependencies, change settings, or remove a legacy link", async (t) => {
  const f = await fixture(t);
  await addExtension(f, "skill-manager");
  const link = await legacyLink(f);
  await runSetup({ paths: f.paths, choose: async () => undefined, run: () => assert.fail("Must not run"), log: () => {} });
  await assert.rejects(readFile(f.paths.settingsPath), { code: "ENOENT" });
  assert.equal(await readlink(link), join(f.paths.root, "skills", "review-fix"));
});

test("installs only selected extensions, migrates a legacy root entry, and preserves other settings", async (t) => {
  const f = await fixture(t);
  await addExtension(f, "codex-bar");
  await addExtension(f, "skill-manager");
  const source = relative(dirname(f.paths.settingsPath), f.paths.root);
  await f.file(f.paths.settingsPath, JSON.stringify({ theme: "system", packages: ["npm:unrelated", source], skills: ["!private*"] }));
  const runs = [];
  await runSetup({
    paths: f.paths,
    choose: async (options) => {
      assert.ok(options.extensions.every((entry) => entry.status === "installed"));
      return { extensions: ["codex-bar"] };
    },
    run: async (...args) => {
      runs.push(args);
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

test("deselecting extensions disables only this repository and does not touch other skills", async (t) => {
  const f = await fixture(t);
  const extension = await addExtension(f, "codex-bar");
  const unrelated = join(f.paths.legacySkillsDir, "other", "SKILL.md");
  await f.file(unrelated, "User instructions");
  await configureExtensions(f.paths, [extension]);
  await runSetup({ paths: f.paths, choose: async () => ({ extensions: [] }), run: () => assert.fail("No dependencies needed"), log: () => {} });
  assert.deepEqual((await readSettings(f.paths.settingsPath)).packages[0].extensions, []);
  assert.equal(await readFile(unrelated, "utf8"), "User instructions");
});

test("preselects skill-manager for migration and removes only the old repository-owned link after apply", async (t) => {
  const f = await fixture(t);
  await addExtension(f, "skill-manager");
  const link = await legacyLink(f);
  const run = async () => {};
  const choose = async (options) => {
    assert.equal(options.extensions[0].selected, true);
    assert.ok(["migration", "installed"].includes(options.extensions[0].status));
    return { extensions: ["skill-manager"] };
  };
  await runSetup({ paths: f.paths, choose, run, log: () => {} });
  await assert.rejects(readlink(link), { code: "ENOENT" });
  assert.deepEqual((await readSettings(f.paths.settingsPath)).packages[0].extensions, ["packages/skill-manager/index.ts"]);
  const original = await readFile(f.paths.settingsPath, "utf8");
  await runSetup({ paths: f.paths, choose, run, log: () => {} });
  assert.equal(await readFile(f.paths.settingsPath, "utf8"), original);
});

test("migration preserves real skill directories and links belonging to another repository", async (t) => {
  for (const kind of ["directory", "foreign-link"]) {
    const f = await fixture(t);
    await addExtension(f, "skill-manager");
    const target = join(f.paths.legacySkillsDir, "review-fix");
    if (kind === "directory") await f.file(join(target, "SKILL.md"), "Local instructions");
    else await legacyLink(f, join(f.paths.root, "another-repo", "review-fix"));
    await runSetup({ paths: f.paths, choose: async () => ({ extensions: ["skill-manager"] }), run: async () => {}, log: () => {} });
    if (kind === "directory") assert.equal(await readFile(join(target, "SKILL.md"), "utf8"), "Local instructions");
    else assert.equal(await readlink(target), join(f.paths.root, "another-repo", "review-fix"));
  }
});

test("leaves the legacy link intact if skill-manager is not selected", async (t) => {
  const f = await fixture(t);
  await addExtension(f, "skill-manager");
  const link = await legacyLink(f);
  await runSetup({ paths: f.paths, choose: async () => ({ extensions: [] }), run: () => assert.fail("Must not run"), log: () => {} });
  assert.equal(await readlink(link), join(f.paths.root, "skills", "review-fix"));
});

test("dependency failure and malformed settings do not change settings or remove legacy links", async (t) => {
  const f = await fixture(t);
  await addExtension(f, "skill-manager");
  const link = await legacyLink(f);
  const original = '{"theme":"dark"}\n';
  await f.file(f.paths.settingsPath, original);
  await assert.rejects(runSetup({
    paths: f.paths,
    choose: async () => ({ extensions: ["skill-manager"] }),
    run: async () => { throw new Error("Dependency installation failed"); },
    log: () => {},
  }), /Dependency installation failed/);
  assert.equal(await readFile(f.paths.settingsPath, "utf8"), original);
  assert.equal(await readlink(link), join(f.paths.root, "skills", "review-fix"));
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
  const paths = setupPaths({ root: f.paths.root, agentDir: join(f.paths.root, "custom-agent") });
  assert.equal(paths.settingsPath, join(f.paths.root, "custom-agent", "settings.json"));
  await assert.rejects(runSetup({
    paths,
    choose: async () => ({ extensions: ["missing"] }),
    run: () => assert.fail("Must not run"),
    log: () => {},
  }), /Unknown setup selection/);
  await assert.rejects(readFile(paths.settingsPath), { code: "ENOENT" });
});

test("Pi loads only the selected extension and does not expose packaged tasks as native skills", async (t) => {
  const { DefaultPackageManager, SettingsManager } = await import("@earendil-works/pi-coding-agent");
  const f = await fixture(t);
  const extension = await addExtension(f, "skill-manager");
  const other = await addExtension(f, "codex-bar");
  await f.file(join(f.paths.root, "packages", "skill-manager", "tasks", "review", "fix", "TASK.md"), "Task instructions");
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
  assert.ok(!resources.skills.some((entry) => entry.path.startsWith(`${f.paths.root}/`)));
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
