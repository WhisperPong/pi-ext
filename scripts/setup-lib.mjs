import { lstat, mkdir, readFile, readdir, readlink, realpath, rename, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, matchesGlob, relative, resolve, sep } from "node:path";
import { randomUUID } from "node:crypto";

async function statIfPresent(path) {
  try {
    return await lstat(path);
  } catch (error) {
    if (error.code === "ENOENT") return undefined;
    throw error;
  }
}

async function directories(path) {
  try {
    return (await readdir(path, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
      .sort((a, b) => a.name.localeCompare(b.name));
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}

export async function discoverResources(root) {
  const extensions = [];
  for (const entry of await directories(join(root, "packages"))) {
    const source = join(root, "packages", entry.name, "index.ts");
    if (!(await statIfPresent(source))?.isFile()) continue;
    const manifest = JSON.parse(await readFile(join(dirname(source), "package.json"), "utf8"));
    extensions.push({ id: entry.name, source, description: manifest.description ?? "" });
  }
  return { extensions };
}

export function setupPaths({ root, home = homedir(), agentDir = process.env.PI_CODING_AGENT_DIR } = {}) {
  return {
    root: resolve(root),
    settingsPath: join(agentDir ? resolve(agentDir) : join(home, ".pi", "agent"), "settings.json"),
    legacySkillsDir: join(home, ".agents", "skills"),
  };
}

export async function readSettings(path) {
  try {
    const settings = JSON.parse(await readFile(path, "utf8"));
    if (!settings || typeof settings !== "object" || Array.isArray(settings)) {
      throw new Error("Expected a settings object.");
    }
    if (settings.packages !== undefined && !Array.isArray(settings.packages)) {
      throw new Error("Expected settings.packages to be an array.");
    }
    return settings;
  } catch (error) {
    if (error.code === "ENOENT") return {};
    throw new Error(`Cannot read ${path}: ${error.message}`, { cause: error });
  }
}

async function canonical(path) {
  try {
    return await realpath(path);
  } catch (error) {
    if (error.code === "ENOENT") return resolve(path);
    throw error;
  }
}

export async function isRootPackage(entry, paths) {
  const source = typeof entry === "string" ? entry : entry?.source;
  if (typeof source !== "string") return false;
  // Pi package sources with a scheme are not local filesystem paths.
  if (/^[a-z][a-z\d+.-]*:/i.test(source) && !isAbsolute(source)) return false;
  const expanded = source === "~" ? homedir() : source.startsWith("~/") ? join(homedir(), source.slice(2)) : source;
  return await canonical(resolve(dirname(paths.settingsPath), expanded)) === await canonical(paths.root);
}

// One-time migration only: never remove real directories or another source's link.
async function hasLegacyReviewLink(paths) {
  const target = join(paths.legacySkillsDir, "review-fix");
  const stat = await statIfPresent(target);
  return Boolean(stat?.isSymbolicLink()
    && resolve(dirname(target), await readlink(target)) === join(paths.root, "skills", "review-fix"));
}

async function removeLegacyReviewLink(paths) {
  if (await hasLegacyReviewLink(paths)) await unlink(join(paths.legacySkillsDir, "review-fix"));
}

function extensionEnabled(entry, extension, root) {
  if (typeof entry === "string" || entry.extensions === undefined) return true;
  const patterns = entry.extensions;
  if (!patterns.length) return false;
  const relativePath = relative(root, extension.source).split(sep).join("/");
  const normalize = (pattern) => pattern.replaceAll("\\", "/").replace(/^\.\//, "");
  const exact = (pattern) => [relativePath, extension.source.split(sep).join("/")].includes(normalize(pattern));
  const glob = (pattern) => [relativePath, basename(extension.source), extension.source.split(sep).join("/")]
    .some((path) => matchesGlob(path, normalize(pattern)));
  const includes = patterns.filter((pattern) => !/^[!+-]/.test(pattern));
  let enabled = includes.length === 0 || includes.some(glob);
  if (patterns.some((pattern) => pattern.startsWith("!") && glob(pattern.slice(1)))) enabled = false;
  if (patterns.some((pattern) => pattern.startsWith("+") && exact(pattern.slice(1)))) enabled = true;
  if (patterns.some((pattern) => pattern.startsWith("-") && exact(pattern.slice(1)))) enabled = false;
  return enabled;
}

export async function describeResources(resources, paths, settings) {
  const rootEntries = [];
  for (const entry of settings.packages ?? []) {
    if (await isRootPackage(entry, paths)) rootEntries.push(entry);
  }
  const legacyReview = await hasLegacyReviewLink(paths);
  const extensions = resources.extensions.map((extension) => {
    const installed = rootEntries.some((entry) => extensionEnabled(entry, extension, paths.root));
    const migrating = extension.id === "skill-manager" && legacyReview;
    return { ...extension, installed, selected: installed || migrating, status: installed ? "installed" : migrating ? "migration" : "new" };
  });
  return { extensions };
}

export async function configureExtensions(paths, extensions) {
  // Re-read after dependency installation so unrelated intervening changes survive.
  const settings = await readSettings(paths.settingsPath);
  const packages = [];
  let existing;
  for (const entry of settings.packages ?? []) {
    if (await isRootPackage(entry, paths)) {
      if (typeof entry === "object") existing = entry;
    } else {
      packages.push(entry);
    }
  }
  const hadRoot = packages.length !== (settings.packages ?? []).length;
  if (!hadRoot && extensions.length === 0) return;
  packages.push({
    ...existing,
    source: paths.root,
    extensions: extensions.map((extension) => relative(paths.root, extension.source).split(sep).join("/")),
    skills: [],
  });
  const next = { ...settings, packages };
  if (JSON.stringify(next) === JSON.stringify(settings)) return;
  await mkdir(dirname(paths.settingsPath), { recursive: true });
  const temporary = `${paths.settingsPath}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600, flag: "wx" });
    await rename(temporary, paths.settingsPath);
  } finally {
    await unlink(temporary).catch((error) => { if (error.code !== "ENOENT") throw error; });
  }
}

export async function runSetup({ paths, choose, run, log = console.log }) {
  const resources = await discoverResources(paths.root);
  const settings = await readSettings(paths.settingsPath);
  const options = await describeResources(resources, paths, settings);
  const selection = await choose(options);
  if (!selection) {
    log("Setup cancelled. Nothing was changed.");
    return;
  }
  const extensions = options.extensions.filter((entry) => selection.extensions.includes(entry.id));
  const selectedIds = new Set(extensions.map((entry) => entry.id));
  if (selection.extensions.some((id) => !selectedIds.has(id))) {
    throw new Error("Unknown setup selection.");
  }
  if (extensions.length) await run("pnpm", ["install"], paths.root);
  await configureExtensions(paths, extensions);
  if (selectedIds.has("skill-manager")) await removeLegacyReviewLink(paths);
  log(`Enabled ${extensions.length} extension(s). Packaged tasks are managed by skill-manager.`);
  log("Start Pi or run /reload to load your selection.");
}
