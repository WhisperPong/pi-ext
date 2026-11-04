import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { runSetup, setupPaths } from "./setup-lib.mjs";
import { chooseResources } from "./setup-picker.mjs";

export { chooseResources };

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
    console.log("Usage: pnpm run setup\nUse ↑/↓ to move and Space to toggle. Enter reviews the selection, then confirms the focused action. Esc goes back or cancels; Ctrl+C or q cancels.");
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
