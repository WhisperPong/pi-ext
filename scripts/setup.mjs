import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { runSetup, setupPaths } from "./setup-lib.mjs";

export async function chooseResources(resources, { input = process.stdin, output = process.stdout } = {}) {
  if (!input.isTTY || !output.isTTY) {
    throw new Error("Setup requires an interactive terminal. Run pnpm run setup in your terminal.");
  }
  const rl = createInterface({ input, output });
  rl.on("SIGINT", () => rl.close());
  const ask = (prompt) => new Promise((resolveAnswer) => {
    if (rl.closed) return resolveAnswer(undefined);
    const onClose = () => resolveAnswer(undefined);
    rl.once("close", onClose);
    rl.question(prompt, (answer) => {
      rl.off("close", onClose);
      resolveAnswer(answer.trim());
    });
  });
  const items = [...resources.extensions, ...resources.skills].map((item) => ({ ...item }));
  try {
    output.write("\nPI-Ext setup\nChoose extensions and skills to install.\n");
    output.write("Unselected extensions from this repository will be disabled. Existing skills will not be removed or overwritten.\n");
    while (true) {
      let index = 0;
      for (const [label, group] of [["Extensions", resources.extensions], ["Skills", resources.skills]]) {
        output.write(`\n${label}\n`);
        if (!group.length) output.write("  (none available)\n");
        for (const _item of group) {
          const item = items[index++];
          const status = item.status === "installed" ? " [installed]" : item.status === "exists" ? " [already exists; will be skipped]" : "";
          output.write(`  ${index}. [${item.selected ? "x" : " "}] ${item.id}${status}${item.description ? ` — ${item.description}` : ""}\n`);
        }
      }
      const answer = await ask("\nNumbers to toggle (e.g. 1,2), a = all, n = none, Enter = continue, q = cancel: ");
      if (answer === undefined || answer.toLowerCase() === "q") return undefined;
      if (answer === "") break;
      if (["a", "n"].includes(answer.toLowerCase())) {
        for (const item of items) item.selected = answer.toLowerCase() === "a";
        continue;
      }
      const tokens = answer.split(/[\s,]+/);
      if (tokens.some((token) => !/^\d+$/.test(token) || Number(token) < 1 || Number(token) > items.length)) {
        output.write("Invalid selection. Enter the numbers shown above.\n");
        continue;
      }
      for (const index of new Set(tokens.map(Number))) items[index - 1].selected = !items[index - 1].selected;
    }
    const extensions = items.slice(0, resources.extensions.length).filter((item) => item.selected).map((item) => item.id);
    const skills = items.slice(resources.extensions.length).filter((item) => item.selected).map((item) => item.id);
    output.write(`\nExtensions: ${extensions.join(", ") || "none"}\nSkills: ${skills.join(", ") || "none"}\n`);
    const confirmation = await ask("Apply this selection? [y/N] ");
    return confirmation?.toLowerCase() === "y" ? { extensions, skills } : undefined;
  } finally {
    rl.close();
  }
}

function runCommand(command, args, cwd) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(command, args, { cwd, stdio: "inherit", shell: false });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) resolveRun();
      else reject(new Error(`${command} failed (${signal ?? `exit ${code}`}).`));
    });
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  if (args.length) {
    console.log("Usage: pnpm run setup\nSelect items by number, then confirm to install. Ctrl+C or q cancels.");
    if (args.some((arg) => !["--help", "-h"].includes(arg))) process.exitCode = 1;
  } else {
    try {
      await runSetup({
        paths: setupPaths({ root: resolve(dirname(fileURLToPath(import.meta.url)), "..") }),
        choose: chooseResources,
        run: runCommand,
      });
    } catch (error) {
      console.error(`Setup failed: ${error.message}`);
      process.exitCode = 1;
    }
  }
}
