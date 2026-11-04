import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { CodexBarPlugin } from "./src/plugin.ts";

export default function (pi: ExtensionAPI) {
  new CodexBarPlugin(pi).register();
}
