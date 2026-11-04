import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { taskPrompt, type Task } from "./catalog.ts";

export function registerTasks(pi: ExtensionAPI, tasks: readonly Task[]): void {
  const commands = new Map<string, Task>();
  for (const task of tasks) {
    if (task.command === "tasks" || commands.has(task.command)) {
      throw new Error(`Duplicate or reserved task command: ${task.command}`);
    }
    commands.set(task.command, task);
  }
  const run = (task: Task, args: string, ctx: ExtensionCommandContext): void => {
    const prompt = taskPrompt(task, args);
    if (ctx.isIdle()) pi.sendUserMessage(prompt);
    else {
      pi.sendUserMessage(prompt, { deliverAs: "followUp" });
      ctx.ui.notify(`Queued /${task.command} after the current run.`, "info");
    }
  };
  for (const task of tasks) {
    pi.registerCommand(task.command, {
      description: task.description,
      handler: async (args, ctx) => run(task, args, ctx),
    });
  }
  pi.registerCommand("tasks", {
    description: "Choose a packaged task, or run /tasks <command> [instructions]",
    getArgumentCompletions: (prefix) => tasks
      .filter((task) => task.command.startsWith(prefix))
      .map((task) => ({ value: task.command, label: task.command, description: task.description })),
    handler: async (args, ctx) => {
      if (!tasks.length) {
        ctx.ui.notify("No packaged tasks are available.", "info");
        return;
      }
      const request = args.trim();
      if (request) {
        const match = /^\/?(\S+)(?:\s+([\s\S]*))?$/.exec(request)!;
        const task = commands.get(match[1]);
        if (!task) {
          ctx.ui.notify(`Unknown task: ${match[1]}. Available: ${[...commands.keys()].join(", ")}`, "warning");
          return;
        }
        run(task, match[2] ?? "", ctx);
        return;
      }
      if (!ctx.hasUI) {
        ctx.ui.notify(`Use /tasks <command> [instructions]. Available: ${[...commands.keys()].join(", ")}`, "warning");
        return;
      }
      const labels = tasks.map((task) => `/${task.command} — ${task.description}`);
      const choice = await ctx.ui.select("Packaged tasks", labels);
      if (choice === undefined) return;
      const task = tasks[labels.indexOf(choice)];
      if (task) run(task, "", ctx);
    },
  });
}
