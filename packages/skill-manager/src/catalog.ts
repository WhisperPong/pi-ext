import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseFrontmatter } from "@earendil-works/pi-coding-agent";

export interface Task {
  command: string;
  description: string;
  baseDir: string;
  instructions: string;
}

// Only TASK.md creates a command. References and scripts stay local to a task.
export function discoverTasks(root: string): Task[] {
  const tasks: Task[] = [];
  const visit = (directory: string, segments: string[]): void => {
    const entries = readdirSync(directory, { withFileTypes: true });
    const taskFile = entries.find((entry) => entry.name === "TASK.md");
    if (taskFile) {
      if (!taskFile.isFile() || !segments.length
        || segments.some((segment) => !/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(segment))) {
        throw new Error(`Invalid task directory: ${directory}`);
      }
      const { frontmatter, body } = parseFrontmatter<Record<string, unknown>>(readFileSync(join(directory, "TASK.md"), "utf8"));
      if (typeof frontmatter.description !== "string" || !frontmatter.description.trim() || !body.trim()) {
        throw new Error(`Task needs a description and instructions: ${directory}`);
      }
      tasks.push({
        command: segments.join(":"),
        description: frontmatter.description.trim(),
        baseDir: directory,
        instructions: body.trim(),
      });
      return;
    }
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      if (entry.isDirectory() && !entry.name.startsWith(".")) visit(join(directory, entry.name), [...segments, entry.name]);
    }
  };
  visit(root, []);
  return tasks;
}

export function taskPrompt(task: Task, args: string): string {
  return [
    `Execute the packaged task /${task.command}.`,
    `Task directory: ${task.baseDir}`,
    "Resolve relative reference and script paths against the task directory, not the working directory.",
    "",
    task.instructions,
    ...(args.trim() ? ["", "Additional user instructions:", args.trim()] : []),
  ].join("\n");
}
