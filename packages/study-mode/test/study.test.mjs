import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";
import studyMode from "../index.ts";

const MODES = ["roadmap", "plan", "lesson", "quiz", "feynman", "sheet", "project", "exam"];
const directories = [];

after(() => {
  for (const directory of directories) rmSync(directory, { force: true, recursive: true });
});

function harness({ hasUI = true, idle = true, branch = [], directory, choose = () => undefined } = {}) {
  if (!directory) {
    directory = mkdtempSync(join(tmpdir(), "pi-ext-study-test-"));
    directories.push(directory);
  }
  const commands = new Map();
  const handlers = new Map();
  const tools = new Map();
  const messages = [];
  const notifications = [];
  const pickers = [];
  let entries = [...branch];
  let baseTools = ["read"];
  let activeTools = [...baseTools];
  const ctx = {
    hasUI,
    isIdle: () => idle,
    sessionManager: { getBranch: () => [...entries] },
    ui: {
      notify: (text, level) => notifications.push({ text, level }),
      select: async (_title, choices) => {
        pickers.push(choices);
        return choose(choices);
      },
    },
  };
  studyMode({
    registerCommand: (name, command) => commands.set(name, command),
    on: (name, handler) => handlers.set(name, handler),
    registerTool: (tool) => tools.set(tool.name, tool),
    appendEntry: (customType, data) => entries.push({ type: "custom", customType, data }),
    getActiveTools: () => [...activeTools],
    setActiveTools: (names) => {
      activeTools = [...names];
      baseTools = [...names];
    },
    sendUserMessage: (text, options) => messages.push({ text, options }),
  }, directory);
  const runHook = async (type, fields = {}) => handlers.get(type)?.({ type, ...fields }, ctx);
  return {
    commands, tools, messages, notifications, pickers, directory,
    invoke: (args = "") => commands.get("study").handler(args, ctx),
    branch: () => [...entries],
    setBranch: async (next) => {
      entries = [...next];
      await runHook("session_tree");
    },
    startSession: () => runHook("session_start", { reason: "resume" }),
    beforeTurn: async (prompt) => {
      const initial = [...baseTools];
      const systemPromptOptions = { sections: {}, selectedTools: [...initial] };
      await runHook("before_agent_start", { messageType: "user", prompt, systemPromptOptions });
      // Pi reuses the live tool set when the hook leaves the base selection unchanged.
      if (systemPromptOptions.selectedTools.length === initial.length &&
        systemPromptOptions.selectedTools.every((name, index) => name === initial[index])) {
        systemPromptOptions.selectedTools = [...activeTools];
      }
      activeTools = [...systemPromptOptions.selectedTools];
      return systemPromptOptions;
    },
    progress: (params = {}) => tools.get("study_progress").execute("test-call", params, undefined, undefined, ctx),
  };
}

test("registers a single study command and completes matching modes", async () => {
  const app = harness();
  assert.deepEqual([...app.commands.keys()], ["study"]);
  assert.deepEqual(app.messages, []);
  const command = app.commands.get("study");
  const all = await command.getArgumentCompletions("");
  assert.deepEqual(all.map(({ value }) => value).sort(), [...MODES].sort());
  const prefix = await command.getArgumentCompletions("pr");
  assert.deepEqual(prefix.map(({ value }) => value), ["project"]);
  const unknown = await command.getArgumentCompletions("unknown");
  assert.equal(unknown?.length ?? 0, 0);
});

test("dispatches all modes with distinct prompts and keeps the user's details", async () => {
  const app = harness({ hasUI: false });
  const details = "注意力机制\nUse Python and keep $NOTES literal.";
  for (const mode of MODES) await app.invoke(` ${mode} ${details} `);
  assert.equal(app.messages.length, MODES.length);
  assert.equal(new Set(app.messages.map(({ text }) => text)).size, MODES.length);
  for (const { text } of app.messages) assert.ok(text.includes(details));
  const [roadmap, , lesson] = app.messages;
  assert.match(roadmap.text, /\b(confirm|approve|approval|confirmation)\b/i);
  assert.match(lesson.text, /\b(wait|pause|stop)\b/i);
  assert.deepEqual(app.pickers, []);
});

test("roadmap coaches through intake, evidence-based placement, and a proposal before teaching", async () => {
  const app = harness({ hasUI: false });
  await app.invoke("roadmap Learn LLMs with Python in five hours a week");
  assert.equal(app.messages.length, 1);
  const { text } = app.messages[0];
  const stages = [...text.matchAll(/^(\d+\. (?:Intake|Placement|Proposal|Confirmation))\b/gm)];
  assert.deepEqual(stages.map((match) => match[1]), ["1. Intake", "2. Placement", "3. Proposal", "4. Confirmation"]);
  const [intake, placement, proposal, confirmation] = stages.map((match, index) =>
    text.slice(match.index, stages[index + 1]?.index)
  );

  assert.match(intake, /\bpreambles?\b/i);
  assert.match(intake, /\bgoal is clear\b[^.!?]*\bfirst reply\b/i);
  assert.match(placement, /\bnext token\b/i);
  assert.match(placement, /\bself[- ](?:rating|assessment)s?\b/i);
  assert.match(placement, /\bone\b[^.!?]*\bquestion\b/i);
  assert.match(placement, /\b(?:ungraded|unscored|no score|without scoring|do not (?:grade|score))\b/i);
  assert.match(placement, /\bwait\b/i);
  assert.match(placement, /\banswers?\b/i);
  assert.match(placement, /\bskip(?:ped)?\b/i);

  assert.match(proposal, /\b20[ -]hours?\b/i);
  assert.match(proposal, /\b(?:ten|10)\b[^.!?]*\blessons?\b/i);
  assert.match(proposal, /\btable\b/i);
  assert.match(proposal, /\bexercises?\b/i);
  assert.match(proposal, /\b(?:weekly|per week|each week|weeks)\b/i);
  assert.match(proposal, /\b(?:five|5)\b[^.!?]*\bresources\b/i);
  assert.match(proposal, /\b(?:offline|without web access|if web access is unavailable|unverified|could not verify)\b/i);

  assert.match(confirmation, /\bexplicit\b/i);
  assert.match(confirmation, /\b(?:confirm|confirmation|approval)\b/i);
  assert.match(confirmation, /\b(?:wait|before|until)\b/i);
  assert.match(confirmation, /\bfirst lesson\b/i);
});

test("plan uses the current level and adapts a roughly 20-hour lesson plan to weekly study time", async () => {
  const app = harness({ hasUI: false });
  await app.invoke("plan 4 hours each week");
  assert.equal(app.messages.length, 1);
  const [instructions] = app.messages[0].text.split("Learner request:");
  assert.match(instructions, /\b(?:current|active|selected) level\b/i);
  assert.match(instructions, /\b20[ -]hours?\b/i);
  assert.match(instructions, /\b(?:weekly|per week|each week|weeks)\b/i);
  assert.match(instructions, /\bexercises?\b/i);
});

test("queues study prompts as follow-ups while Pi is busy", async () => {
  const app = harness({ idle: false });
  await app.invoke("quiz Unix permissions");
  assert.equal(app.messages.length, 1);
  assert.match(app.messages[0].text, /Unix permissions/);
  assert.deepEqual(app.messages[0].options, { deliverAs: "followUp" });
  assert.match(app.notifications[0].text, /queue/i);
});

test("starts guided study with an empty command or a topic, including in non-interactive Pi", async () => {
  const blank = harness();
  await blank.invoke("  ");
  assert.equal(blank.messages.length, 1);
  assert.deepEqual(blank.pickers, []);
  const entry = blank.branch().at(-1);
  assert.equal(entry.type, "custom");
  assert.equal(entry.customType, "pi-ext-study");
  assert.equal(entry.data.version ?? entry.data.v, 1);
  assert.equal(typeof entry.data.id, "string");

  const topic = harness({ hasUI: false });
  await topic.invoke("Self-attention with Python");
  assert.equal(topic.messages.length, 1);
  assert.match(topic.messages[0].text, /Self-attention with Python/);
  assert.equal(topic.branch().at(-1).customType, "pi-ext-study");
  assert.deepEqual(topic.pickers, []);
});

test("guidance and progress tools follow the active session branch", async () => {
  const app = harness();
  assert.equal(app.tools.get("study_progress").defaultActive, false);
  assert.deepEqual(await app.beforeTurn("Fix a failing build"), { sections: {}, selectedTools: ["read"] });
  await app.invoke("Graph theory");
  const activeBranch = app.branch();
  const active = await app.beforeTurn("I can use Python");
  assert.ok(active.sections.pi_ext_study);
  assert.match(active.sections.pi_ext_study, /\bold checkpoint\b[^.!?]*\bproduct-use survey\b[^.!?]*\bplacement question\b/i);
  assert.deepEqual(active.selectedTools, ["read", "study_progress"]);

  await app.setBranch([]);
  assert.deepEqual(await app.beforeTurn("Fix a failing build"), { sections: {}, selectedTools: ["read"] });
  await app.setBranch(activeBranch);
  assert.ok((await app.beforeTurn("What is next?")).sections.pi_ext_study);

  const resumed = harness({ branch: activeBranch, directory: app.directory });
  await resumed.startSession();
  assert.ok((await resumed.beforeTurn("What is next?")).sections.pi_ext_study);
  const otherSession = harness({ directory: app.directory });
  await otherSession.startSession();
  assert.deepEqual(await otherSession.beforeTurn("What is next?"), { sections: {}, selectedTools: ["read"] });
});

test("study checkpoint tool hides successful calls in the terminal and surfaces failures", () => {
  const app = harness();
  const tool = app.tools.get("study_progress");
  const theme = { fg: (_color, text) => text };
  assert.equal(tool.renderShell, "self");
  assert.deepEqual(tool.renderCall().render(80), []);
  assert.deepEqual(tool.renderResult({}, {}, theme, { isError: false }).render(80), []);
  assert.match(tool.renderResult({}, {}, theme, { isError: true }).render(80).join("\n"), /study progress/i);
});

test("per-topic checkpoints survive a fresh session and partial writes preserve existing fields", async () => {
  const app = harness();
  await app.invoke("Self-attention");
  await app.beforeTurn(app.messages[0].text);
  const first = await app.progress({ topic: "Self-attention", plan: "Implement scaled dot-product attention", next: "Compare logits" });
  assert.ok(first.content.length > 0);
  await app.progress({ progress: "Passed the masking exercise" });
  assert.equal(app.branch().at(-1).customType, "pi-ext-study");
  assert.deepEqual(Object.keys(app.branch().at(-1).data).filter((key) => ["plan", "progress", "next"].includes(key)), []);
  assert.equal(readdirSync(app.directory).filter((file) => file.endsWith(".jsonl")).length, 1);

  const resumed = harness({ directory: app.directory });
  await resumed.startSession();
  assert.deepEqual(await resumed.beforeTurn("Fix a failing build"), { sections: {}, selectedTools: ["read"] });
  assert.deepEqual(resumed.branch(), []);
  await resumed.invoke();
  assert.equal(resumed.branch().at(-1).data.id, app.branch().at(-1).data.id);
  await resumed.beforeTurn(resumed.messages[0].text);
  const beforeRead = resumed.branch();
  const read = JSON.stringify((await resumed.progress()).content);
  assert.match(read, /Implement scaled dot-product attention/);
  assert.match(read, /Passed the masking exercise/);
  assert.match(read, /Compare logits/);
  assert.deepEqual(resumed.branch(), beforeRead);
});

test("a fresh study session can choose between saved topics", async () => {
  const first = harness();
  await first.invoke("Self-attention");
  const second = harness({ directory: first.directory });
  await second.invoke("Graph theory");

  const cancelled = harness({ directory: first.directory });
  await cancelled.invoke();
  assert.equal(cancelled.pickers.length, 1);
  assert.deepEqual(cancelled.branch(), []);
  assert.deepEqual(cancelled.messages, []);

  const resumed = harness({
    directory: first.directory,
    choose: (choices) => choices.find((label) => label.endsWith("Self-attention")),
  });
  await resumed.invoke();
  assert.equal(resumed.branch().at(-1).data.id, first.branch().at(-1).data.id);
  assert.notEqual(resumed.branch().at(-1).data.id, second.branch().at(-1).data.id);
});

test("pausing clears tutoring for ordinary prompts and bare study resumes the checkpoint", async () => {
  const app = harness();
  await app.invoke("Graph theory");
  await app.beforeTurn(app.messages[0].text);
  await app.progress({ progress: "Practiced directed graphs", paused: true });
  assert.deepEqual(await app.beforeTurn("Fix a failing build"), { sections: {}, selectedTools: ["read"] });

  await app.invoke();
  const active = await app.beforeTurn(app.messages.at(-1).text);
  assert.ok(active.sections.pi_ext_study);
  assert.deepEqual(active.selectedTools, ["read", "study_progress"]);
  assert.match(JSON.stringify((await app.progress()).content), /Practiced directed graphs/);
});

test("manual modes keep their prompt and skip guided instructions for that turn", async () => {
  const app = harness();
  await app.invoke("Graph theory");
  await app.beforeTurn(app.messages[0].text);
  const guided = app.branch();
  await app.invoke("quiz Shortest paths");
  assert.deepEqual(app.branch(), guided);
  const { text } = app.messages.at(-1);
  assert.match(text, /Shortest paths/);
  assert.deepEqual(await app.beforeTurn(text), { sections: {}, selectedTools: ["read"] });
  assert.ok((await app.beforeTurn("Please continue my study")).sections.pi_ext_study);
});

test("a guided command asks the learner to wait while Pi is busy", async () => {
  const app = harness({ idle: false });
  await app.invoke("Graph theory");
  assert.match(app.notifications[0].text, /\b(?:wait|busy|finish|idle)\b/i);
  assert.deepEqual(app.messages, []);
  assert.deepEqual(app.branch(), []);
});
