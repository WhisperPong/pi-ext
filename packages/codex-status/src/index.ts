import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { CodexStatusPlugin } from "./plugin.ts";

export default function (pi: ExtensionAPI) {
  new CodexStatusPlugin(pi).register();
}
