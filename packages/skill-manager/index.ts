import { fileURLToPath } from "node:url";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { discoverTasks } from "./src/catalog.ts";
import { registerTasks } from "./src/plugin.ts";

export default function skillManager(pi: ExtensionAPI): void {
  registerTasks(pi, discoverTasks(fileURLToPath(new URL("./tasks/", import.meta.url))));
}
