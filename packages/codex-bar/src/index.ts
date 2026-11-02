import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { CodexBarPlugin } from "./plugin.ts";

export default function (pi: ExtensionAPI) {
  new CodexBarPlugin(pi).register();
}
