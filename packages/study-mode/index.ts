import { homedir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { GUIDED_STUDY, STUDY_GUIDANCE, STUDY_MODES } from "./src/prompts.ts";
import { createRecord, listRecords, readRecord, saveCheckpoint, type StudyRecord } from "./src/records.ts";

const LINK = "pi-ext-study";
const SECTION = "pi_ext_study";
const TOOL = "study_progress";
const MANUAL = `${STUDY_GUIDANCE}\n\nStudy mode: `;
const RESUME = "Continue my saved study. Read study_progress and pick up at the last unanswered question or the next unfinished step.";
const quietRow = { render: () => [], invalidate: () => undefined };

interface StudyLink {
  readonly v: 1;
  readonly id: string;
  readonly paused?: boolean;
}

/**
 * Reads the current branch's study link.
 * @remarks A session links to a record in ~/.study. A different branch can be outside guided study.
 * @sideEffects none
 */
function studyLink(ctx: ExtensionContext): StudyLink | undefined {
  const entries = ctx.sessionManager.getBranch();
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i];
    if (entry.type !== "custom" || entry.customType !== LINK || !entry.data || typeof entry.data !== "object") continue;
    const data = entry.data as Partial<StudyLink>;
    if (data.v === 1 && typeof data.id === "string" && (data.paused === undefined || typeof data.paused === "boolean")) {
      return { v: 1, id: data.id, paused: data.paused };
    }
  }
  return undefined;
}

const checkpoint = Type.Object({
  topic: Type.Optional(Type.String({ minLength: 1, maxLength: 4000, description: "Short title for this learning topic." })),
  plan: Type.Optional(Type.String({ minLength: 1, maxLength: 24000, description: "Explicitly confirmed roadmap, current level's lessons, and ordered resources." })),
  progress: Type.Optional(Type.String({ minLength: 1, maxLength: 12000, description: "Current level and activity, completed work, scores, and unresolved gaps. Include prior milestones." })),
  next: Type.Optional(Type.String({ minLength: 1, maxLength: 12000, description: "Pending question, unconfirmed proposal, or the next unfinished activity." })),
  paused: Type.Optional(Type.Boolean({ description: "Set true only when the learner asks to pause guided study." })),
}, { additionalProperties: false });

/**
 * Registers one command for guided study and optional direct activities.
 *
 * @remarks Pi remembers the selected topic for this branch. Checkpoints can be resumed in a fresh session.
 * @sideEffects Registers a command, a turn hook, and a tool. Guided study can write to the study directory.
 * @param pi - Pi's extension API.
 * @param directory - The private directory for local study records.
 */
export default function studyMode(pi: ExtensionAPI, directory = join(homedir(), ".study")): void {
  pi.registerTool({
    name: TOOL,
    label: "Study progress",
    description: "Read the current study checkpoint with no arguments, or save fields after a confirmed plan or a learning milestone.",
    defaultActive: false,
    executionMode: "sequential",
    parameters: checkpoint,
    renderShell: "self",
    renderCall: () => quietRow,
    renderResult: (_result, _options, theme, { isError }) => isError
      ? { ...quietRow, render: () => [theme.fg("error", "Could not access study progress.")] }
      : quietRow,
    execute: async (_id, { paused, ...changes }, signal, _update, ctx) => {
      const link = studyLink(ctx);
      if (!link || link.paused) throw new Error("Start or resume guided study with /study first.");
      signal?.throwIfAborted();
      const record = await readRecord(directory, link.id);
      signal?.throwIfAborted();
      const saving = Object.keys(changes).length > 0;
      if (saving) await saveCheckpoint(directory, record.id, changes);
      if (paused) pi.appendEntry(LINK, { ...link, paused: true });
      const text = paused ? "Study paused. Resume with /study."
        : saving ? "Study checkpoint saved."
        : JSON.stringify({ topic: record.topic, plan: record.plan, progress: record.progress, next: record.next });
      return { content: [{ type: "text", text }], details: {} };
    },
  });

  pi.on("before_agent_start", (event, ctx) => {
    const link = studyLink(ctx);
    const manual = event.messageType === "user" && event.prompt.startsWith(MANUAL);
    const options = event.systemPromptOptions;
    const tools = pi.getActiveTools();
    if (!link || link.paused || manual) {
      if (options.sections) delete options.sections[SECTION];
      if (tools.includes(TOOL)) pi.setActiveTools(tools.filter((name) => name !== TOOL));
      if (options.selectedTools?.includes(TOOL)) options.selectedTools = options.selectedTools.filter((name) => name !== TOOL);
      return;
    }

    (options.sections ??= {})[SECTION] = GUIDED_STUDY;
    options.selectedTools = [...new Set([...(options.selectedTools ?? tools), TOOL])];
  });

  pi.registerCommand("study", {
    description: "Start or continue guided study, or open a named activity",
    getArgumentCompletions: (prefix) => STUDY_MODES
      .filter(({ id }) => id.startsWith(prefix.toLowerCase()))
      .map(({ id, description }) => ({ value: id, label: id, description })),
    handler: async (args, ctx) => {
      const topic = args.trim();
      const request = /^(\S+)(?:\s+([\s\S]+))?$/u.exec(topic);
      const mode = STUDY_MODES.find(({ id }) => id === request?.[1].toLowerCase());
      const link = studyLink(ctx);
      if (!ctx.isIdle() && (!mode || (link && !link.paused))) {
        ctx.ui.notify("Wait for the current turn to finish, then run /study.", "info");
        return;
      }

      if (mode) {
        const details = request?.[2];
        const prompt = `${MANUAL}${mode.id}\n${mode.instructions}${details ? `\n\nLearner request:\n${details}` : ""}`;
        if (ctx.isIdle()) pi.sendUserMessage(prompt);
        else {
          pi.sendUserMessage(prompt, { deliverAs: "followUp" });
          ctx.ui.notify(`Queued /study ${mode.id} after the current run.`, "info");
        }
        return;
      }

      if (link) {
        await readRecord(directory, link.id);
        if (link.paused) pi.appendEntry(LINK, { ...link, paused: false });
        pi.sendUserMessage(topic || RESUME);
        return;
      }

      const records = await listRecords(directory);
      let selected: StudyRecord | undefined;
      if (topic) selected = records.find((record) => record.topic.toLowerCase() === topic.toLowerCase());
      else if (!ctx.hasUI || records.length <= 1) selected = records[0];
      else {
        const labels = records.map((record, index) => `${index + 1}. ${record.topic}`);
        const newTopic = "Start a new topic";
        const choice = await ctx.ui.select("Continue a study topic", [...labels, newTopic]);
        if (choice === undefined) return;
        selected = records[labels.indexOf(choice)];
        if (!selected && choice !== newTopic) return;
      }

      const record = selected ?? await createRecord(directory, topic.slice(0, 4000) || "Untitled study");
      pi.appendEntry(LINK, { v: 1, id: record.id } satisfies StudyLink);
      pi.sendUserMessage(selected ? RESUME : topic || "Start a new study topic. Ask me what I want to learn.");
    },
  });
}
